//runs stripe CLI listen (keyed to STRIPE_SECRET_KEY via the STRIPE_API_KEY env — never argv, so the
//secret can't leak into `ps` or spawn-error dumps) and forwards to the local URL, then writes the
//resulting signing secret into the app's env/.env as STRIPE_WEBHOOK_SECRET. because the listener is
//bound to STRIPE_SECRET_KEY, changing that key auto-updates the matching webhook secret on the next
//`dev` run — no manual paste. runs in the dev preflight before wrangler boots, so the worker starts
//with the fresh secret (no restart).
//blocks until whsec_ appears in stripe CLI output and the local readiness probe returns 200; then leaves stripe running detached, writes its pid for dev teardown, and exits 0 so the parent can spawnSync and continue
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import {
  closeSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { resolveEnvFile } from "@repo/env-validation/parser"
import tryCatch from "@repo/shared/try-catch"

//deterministic filesystem-safe id for tmp files keyed to an app root (absolute path)
export function serviceSlug(appDir: string): string {
  const abs = resolve(appDir)
  return createHash("sha256").update(abs).digest("hex").slice(0, 24)
}

export function stripeListenLogPath(
  appDir: string,
  devPort: number,
): string {
  return join(
    tmpdir(),
    `${serviceSlug(appDir)}-stripe-listen-${devPort}.log`,
  )
}

export function stripeListenPidPath(
  appDir: string,
  devPort: number,
): string {
  return join(
    tmpdir(),
    `${serviceSlug(appDir)}-stripe-listen-${devPort}.pid`,
  )
}

function resolveAppDir(usage: string): string {
  const arg = process.argv[2]
  if (!arg) {
    console.error(usage)
    process.exit(1)
  }
  return resolve(process.cwd(), arg)
}

//upsert KEY=value in an env file, preserving every other line and comment: replaces the first
//matching line (active OR commented-out), drops any duplicates, appends when absent. returns true
//only when the file actually changed, so the caller can skip logging a no-op.
function upsertEnvVar(
  envFilePath: string,
  key: string,
  value: string,
): boolean {
  const assignment = `${key}=${value}`
  const matchesKey = new RegExp(`^#?\\s*${key}\\s*=`)
  const activeKey = new RegExp(`^\\s*${key}\\s*=`)

  let raw = ""
  try {
    raw = readFileSync(envFilePath, "utf8")
  } catch {
    //no env file yet — it gets created with just this line
  }
  const lines = raw.length > 0 ? raw.split("\n") : []

  //no-op if an active (uncommented) line already holds this exact value
  const activeLine = lines.find((line) => activeKey.test(line))
  const activeValue = activeLine
    ? activeLine.slice(activeLine.indexOf("=") + 1).trim()
    : undefined
  if (activeValue === value) return false

  let replaced = false
  const next: string[] = []
  for (const line of lines) {
    if (!matchesKey.test(line)) {
      next.push(line)
      continue
    }
    //replace the first match, drop any further duplicate lines for this key
    if (!replaced) {
      next.push(assignment)
      replaced = true
    }
  }
  if (!replaced) {
    while (next.length > 0 && next[next.length - 1].trim() === "")
      next.pop()
    next.push(assignment)
  }

  writeFileSync(
    envFilePath,
    `${next.join("\n").replace(/\n*$/, "")}\n`,
    "utf8",
  )
  return true
}

const WAIT_MS = 30_000
const POLL_MS = 200

async function runStripeRedirectWebhookCli(): Promise<void> {
  const usageMain =
    "Usage: pnpm exec tsx packages/dev/src/redirect-stripe-webhook.ts <app-dir> <webhook-path> <local-http-port> <readiness-port>"

  const appDir = resolveAppDir(usageMain)

  const webhookPath = process.argv[3]?.trim()
  const devPortRaw = process.argv[4]?.trim()
  const readinessPortRaw = process.argv[5]?.trim()
  if (!webhookPath || !devPortRaw || !readinessPortRaw) {
    console.error("missing args.", usageMain)
    process.exit(1)
  }

  const devPort = Number.parseInt(devPortRaw, 10)
  if (Number.isNaN(devPort) || devPort < 1) {
    console.error("local-http-port must be a positive integer")
    process.exit(1)
  }

  const readinessPort = Number.parseInt(readinessPortRaw, 10)
  if (
    Number.isNaN(readinessPort) ||
    readinessPort < 1 ||
    readinessPort > 65535
  ) {
    console.error("readiness-port must be an integer 1–65535")
    process.exit(1)
  }

  const logPath = stripeListenLogPath(appDir, devPort)
  try {
    unlinkSync(logPath)
  } catch {
    //no prior log
  }

  //env lives in the app's env/ dir (matches runEnvCheck: join(appDir, "env") -> env/.env),
  //not the app root — a single env file per app, no separate .dev.vars.
  const envFilePath = join(appDir, "env", ".env")
  const { record: merged } = await resolveEnvFile(join(appDir, "env"))
  const stripeSecretKey = String(merged.STRIPE_SECRET_KEY ?? "").trim()
  if (!stripeSecretKey) {
    //no key → can't bind the listener. exit non-zero; the dev preflight treats this as non-fatal and
    //lets check:env report the missing var authoritatively (don't duplicate that error here).
    console.warn("Stripe listener skipped: STRIPE_SECRET_KEY is not set.")
    process.exit(1)
  }

  const forwardUrl = `http://127.0.0.1:${devPort}${webhookPath.startsWith("/") ? webhookPath : `/${webhookPath}`}`

  let secretHandled = false
  const readyServer = createServer((req, res) => {
    if (req.url === "/" || req.url === "/ready") {
      res.statusCode = secretHandled ? 200 : 503
      res.end()
      return
    }
    res.statusCode = 404
    res.end()
  })
  readyServer.listen(readinessPort, "127.0.0.1", () => {})

  const logFd = openSync(logPath, "a")
  //pass the key via STRIPE_API_KEY env, NOT a --api-key argv: argv is visible in `ps` and leaks into
  //spawn-error dumps (err.spawnargs). the Stripe CLI reads STRIPE_API_KEY, so the listener stays bound
  //to it without the secret ever touching the command line.
  const stripeListen = spawn(
    "stripe",
    ["listen", "--forward-to", forwardUrl],
    {
      cwd: appDir,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, STRIPE_API_KEY: stripeSecretKey },
    },
  )

  closeSync(logFd)

  function scanLogForSecret(): void {
    if (secretHandled) return
    try {
      const text = readFileSync(logPath, "utf8")
      const match = text.match(/whsec_\S+/)
      if (!match) return
      secretHandled = true
      const secret = match[0]
      upsertEnvVar(envFilePath, "STRIPE_WEBHOOK_SECRET", secret)
      console.info(`✓ Stripe webhooks → ${forwardUrl}`)
    } catch {
      //log not readable yet
    }
  }

  stripeListen.on("error", () => {
    //don't dump the raw error — its spawnargs/message can echo secrets. the guidance is enough.
    console.error(
      "Stripe CLI not found. Install it (e.g. brew install stripe/stripe-cli/stripe) and ensure 'stripe' is on PATH.",
    )
    readyServer.close()
    process.exit(1)
  })

  stripeListen.on("exit", (code) => {
    readyServer.close()
    process.exit(code ?? 1)
  })

  async function waitUntilRedirectReady(): Promise<void> {
    const deadline = Date.now() + WAIT_MS
    const url = `http://127.0.0.1:${readinessPort}/`
    while (Date.now() < deadline) {
      if (
        stripeListen.exitCode !== null &&
        stripeListen.exitCode !== 0 &&
        !secretHandled
      ) {
        console.error("stripe listen exited before redirect became ready")
        process.exit(1)
      }
      scanLogForSecret()
      const [response, fetchErr] = await tryCatch(() => fetch(url))
      if (!fetchErr && response?.status === 200) return
      await new Promise((resolveWait) => setTimeout(resolveWait, POLL_MS))
    }
    console.warn(
      "Stripe listener timed out becoming ready (is the Stripe CLI installed and 'stripe login' done?).",
    )
    process.exit(1)
  }

  await waitUntilRedirectReady()

  const pid = stripeListen.pid
  if (!pid) {
    console.error("stripe listen missing pid after redirect became ready")
    process.exit(1)
  }

  writeFileSync(stripeListenPidPath(appDir, devPort), `${pid}\n`, "utf-8")

  stripeListen.removeAllListeners("exit")
  stripeListen.unref()

  await new Promise<void>((resolveClose, reject) => {
    readyServer.close((err) => (err ? reject(err) : resolveClose()))
  })

  process.exit(0)
}

if (import.meta.main) {
  await runStripeRedirectWebhookCli()
}

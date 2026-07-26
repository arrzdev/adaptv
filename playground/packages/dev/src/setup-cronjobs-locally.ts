//after your Worker is listening on <dev-port>, hits /__scheduled on the schedule derived from wrangler.toml [triggers].crons (cron discovery only — does not start wrangler). Pair with your own wrangler dev / miniflare / etc.
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import tryCatch from "@repo/shared/try-catch"
import { CronExpressionParser } from "cron-parser"

const FIRST_CRON_DELAY_MS = 5 * 1000
//setTimeout overflows past ~24.8 days and fires immediately — hop in chunks instead
const MAX_TIMEOUT_MS = 2_147_483_647

//---- cron schedule ----------------

//ms until the next occurrence of `cron` after `from`, or null when the
//expression cannot be parsed. UTC because that is what Cloudflare cron
//triggers run on, so local dev fires at the same wall-clock instants.
export function nextFireDelayMs(cron: string, from: Date): number | null {
  //cron-parser reads "" as "* * * * *" — treat a blank entry as unusable
  //rather than silently firing every minute
  if (!cron.trim()) return null

  const [expression, parseError] = tryCatch(() =>
    CronExpressionParser.parse(cron, { currentDate: from, tz: "UTC" }),
  )
  if (parseError) return null

  const [nextFireAt, nextError] = tryCatch(() =>
    expression.next().getTime(),
  )
  if (nextError) return null

  return Math.max(nextFireAt - from.getTime(), 0)
}

//self-rescheduling chain: fire at the next occurrence, then recompute from
//the new "now" for the one after it. A cron is a set of instants, not a period.
function scheduleNextFire(cron: string, trigger: () => void): void {
  const delayMs = nextFireDelayMs(cron, new Date())
  if (delayMs === null) return

  if (delayMs > MAX_TIMEOUT_MS) {
    setTimeout(() => scheduleNextFire(cron, trigger), MAX_TIMEOUT_MS)
    return
  }

  setTimeout(() => {
    trigger()
    scheduleNextFire(cron, trigger)
  }, delayMs)
}

//---- wrangler.toml ----------------

//quote-aware so a '#' inside a value survives — `5#3` (nth weekday) is a
//legal cron field, and stripping it would silently corrupt the expression.
function stripTomlComment(line: string): string {
  let openQuote: string | null = null

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (openQuote) {
      if (char === openQuote) openQuote = null
      continue
    }
    if (char === '"' || char === "'") {
      openQuote = char
      continue
    }
    if (char === "#") return line.slice(0, i)
  }

  return line
}

//one pass over both quote styles so entries keep their source order
function collectQuoted(line: string, output: Set<string>): void {
  for (const quoted of line.matchAll(/"([^"]*)"|'([^']*)'/g))
    output.add((quoted[1] ?? quoted[2]).trim())
}

//reads crons from the TOP-LEVEL [triggers] table only. Named envs
//([env.staging.triggers], [env.prod.triggers]) describe deployed workers and
//may diverge from local config, so the dev runner must never pick them up.
export function getCrons(toml: string): string[] {
  const output = new Set<string>()
  let table = ""
  let isInsideCronsArray = false

  for (const rawLine of toml.split("\n")) {
    const line = stripTomlComment(rawLine).trim()
    if (!line) continue

    //table header — `[x]` or array-of-tables `[[x]]`
    const header = line.match(/^\[\[?\s*([^[\]]+?)\s*\]\]?$/)
    if (header) {
      table = header[1].replace(/\s/g, "")
      isInsideCronsArray = false
      continue
    }

    if (!isInsideCronsArray) {
      if (table !== "triggers") continue
      if (!/^crons\s*=\s*\[/.test(line)) continue
      isInsideCronsArray = true
    }

    collectQuoted(line, output)
    //the array may span lines; the closing bracket ends it
    if (line.includes("]")) isInsideCronsArray = false
  }

  return [...output].filter(Boolean)
}

//---- cli ----------------

function resolveAppDir(usage: string): string {
  const arg = process.argv[2]
  if (!arg) {
    console.error(usage)
    process.exit(1)
  }
  return resolve(process.cwd(), arg)
}

async function runSetupCronjobsLocallyCli(): Promise<void> {
  const appDir = resolveAppDir(
    "Usage: pnpm exec tsx packages/dev/src/setup-cronjobs-locally.ts <app-dir> <dev-port>",
  )

  const devPortRaw = process.argv[3]?.trim()
  if (!devPortRaw) {
    console.error(
      "missing required arg: <dev-port> (port where the Worker HTTP server listens)",
    )
    process.exit(1)
  }

  const port = Number.parseInt(devPortRaw, 10)
  if (Number.isNaN(port) || port < 1) {
    console.error("dev-port must be a positive integer")
    process.exit(1)
  }

  const cronScheduleTomlPath = join(appDir, "wrangler.toml")
  const SERVER_READY_WAIT_MS = 60_000
  const SERVER_POLL_MS = 300

  async function waitForServer(targetPort: number): Promise<void> {
    const deadline = Date.now() + SERVER_READY_WAIT_MS
    const url = `http://127.0.0.1:${targetPort}/`
    while (Date.now() < deadline) {
      const [response, fetchErr] = await tryCatch(() => fetch(url))
      if (!fetchErr && response?.ok) return
      await new Promise((resolveWait) =>
        setTimeout(resolveWait, SERVER_POLL_MS),
      )
    }
    throw new Error(`Server at ${url} did not become ready in time`)
  }

  function scheduleTriggers(targetPort: number, crons: string[]): void {
    const base = `http://127.0.0.1:${targetPort}/__scheduled`
    for (const cron of crons) {
      //one malformed expression must not take the other crons down with it
      if (nextFireDelayMs(cron, new Date()) === null) {
        console.warn("⚠ Cron skipped — cannot parse expression", cron)
        continue
      }

      const url = `${base}?cron=${encodeURIComponent(cron)}`
      const trigger = () =>
        fetch(url).then(
          (response) => {
            if (response.ok) console.log("✓ Cron triggered", cron)
            else console.warn("✗ Cron failed", cron, response.status)
          },
          (error) => console.warn("✗ Cron failed", cron, String(error)),
        )
      setTimeout(() => {
        trigger()
        scheduleNextFire(cron, trigger)
      }, FIRST_CRON_DELAY_MS)
    }
  }

  const toml = readFileSync(cronScheduleTomlPath, "utf8")
  const crons = getCrons(toml)

  if (crons.length === 0) process.exit(0)

  await waitForServer(port)
  scheduleTriggers(port, crons)
}

if (import.meta.main) {
  await runSetupCronjobsLocallyCli()
}

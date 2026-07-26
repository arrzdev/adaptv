/**
 * `pnpm playground:setup` — make this worktree's playground runnable.
 *
 * Framework-development only; nothing here ships. Run automatically on the first
 * `pnpm dev:*` in a worktree that has no `playground/node_modules`, so the intended
 * experience is `git worktree add` → `pnpm dev:ios` and nothing in between.
 *
 * Three steps, all idempotent:
 *
 *   1. env — each app's `env/.env` is git-ignored (they hold secrets), so a fresh worktree has
 *      none. They're copied from the MAIN checkout's playground, the same trick the app's
 *      own worktree bootstrap uses. Nothing to copy is not an error on a machine that has
 *      never had them; `check:env` will say exactly which key is missing when you run.
 *   2. install — the playground's own `pnpm install`. Its `link:../../..` dependency then
 *      resolves to THIS worktree, which is the whole point of vendoring it in-repo.
 *   3. migrate — local D1 for the backend, so the API answers instead of 500ing on first
 *      query. A failure here is a warning, not a stop: the app still boots, and the
 *      migration can be re-run once wrangler is happy.
 */
import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { networkInterfaces } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { c, log, spacer } from "../bin/lib/render.mjs"

const WORKTREE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const PLAYGROUND = path.join(WORKTREE, "playground")

/** The main checkout, from any worktree: parent of the common (non-worktree) `.git` dir. */
function mainCheckout() {
  const r = spawnSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: WORKTREE, encoding: "utf8" },
  )
  if (r.status !== 0) return WORKTREE
  return path.dirname(r.stdout.trim())
}

function run(args, { cwd, label, fatal = true }) {
  const r = spawnSync("pnpm", args, { cwd, stdio: "inherit" })
  if (r.status === 0) return true
  if (fatal) {
    log.error(`${label} failed (exit ${r.status ?? "signal"}).`)
    process.exit(r.status ?? 1)
  }
  log.warn(`${label} failed — continuing (re-run it once it's fixed).`)
  return false
}

// ── 1. env ──────────────────────────────────────────────────────────────────
const source = path.join(mainCheckout(), "playground", "apps")
const target = path.join(PLAYGROUND, "apps")
let copied = 0
if (existsSync(source) && path.resolve(source) !== path.resolve(target)) {
  for (const app of readdirSync(source, { withFileTypes: true })) {
    if (!app.isDirectory()) continue
    const from = path.join(source, app.name, "env", ".env")
    const to = path.join(target, app.name, "env", ".env")
    if (!existsSync(from) || existsSync(to)) continue
    mkdirSync(path.dirname(to), { recursive: true })
    copyFileSync(from, to)
    copied++
  }
}
if (copied)
  log.info(`env  ${copied} file(s) copied from the main checkout`)

// The env URLs name this machine by LAN IP, because a native WebView on a device can't
// reach `localhost` — and a LAN IP is a DHCP lease, not a constant. When it moves, every
// request from the app goes to an address nobody answers on, which looks exactly like a
// backend that's down. Cheap to re-stamp on every setup; the port half of the same problem
// is guarded by the frontend's env schema.
const lanIp = Object.values(networkInterfaces())
  .flat()
  .find((i) => i && i.family === "IPv4" && !i.internal)?.address
if (lanIp) {
  let restamped = 0
  for (const app of existsSync(target) ? readdirSync(target) : []) {
    const file = path.join(target, app, "env", ".env")
    if (!existsSync(file)) continue
    const before = readFileSync(file, "utf8")
    const after = before.replace(
      /(https?:\/\/)\d+\.\d+\.\d+\.\d+/g,
      (_m, scheme) => `${scheme}${lanIp}`,
    )
    if (after !== before) {
      writeFileSync(file, after)
      restamped++
    }
  }
  if (restamped)
    log.info(`env  ${restamped} file(s) re-stamped to ${lanIp}`)
}

// ── 2. install ──────────────────────────────────────────────────────────────
// The framework's own deps first: the playground links it, and the CLI it runs from `bin/`
// resolves capacitor, sharp and workbox out of THIS worktree's node_modules.
if (!existsSync(path.join(WORKTREE, "node_modules"))) {
  log.info("installing framework deps…")
  run(["install"], { cwd: WORKTREE, label: "pnpm install (framework)" })
}
log.info("installing playground deps…")
run(["install"], { cwd: PLAYGROUND, label: "pnpm install (playground)" })

// ── 3. local database ───────────────────────────────────────────────────────
run(["run", "migrate:local"], {
  cwd: PLAYGROUND,
  label: "migrate:local",
  fatal: false,
})

spacer()
log.success("playground ready")
log.info(
  `${c.dim("run it with")} pnpm dev:ios ${c.dim("| dev:web | dev:all | preview:ios | build:ios")}`,
)

// Single-instance lock for `adaptv dev`. Exactly one long-lived dev server may run per
// app: two would collide on the Vite port (7171), the cloudflare inspector port (9220),
// and — worst — the GLOBAL `adb reverse` mapping, where either run's teardown silently
// wipes the route for both. A pidfile in `.adaptv/` makes a second `dev` fail fast with a
// clear message instead of a cryptic port error, lets teardown remove only the adb
// mapping THIS run owns, and lets `preview`/`build` refuse while a dev run holds the
// (mutated) capacitor.config.json.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { ADAPTV_DIR } from "./native.mjs"

const lockFile = (appRoot) => path.join(appRoot, ADAPTV_DIR, "dev.lock")

/** Is a process with this pid alive? (signal 0 = existence check, sends nothing.) */
function pidAlive(pid) {
  if (typeof pid !== "number" || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // ESRCH → no such process (stale). EPERM → alive but owned by another user.
    return err.code === "EPERM"
  }
}

/** Read the raw lock, or null if absent/unreadable. */
export function readDevLock(appRoot) {
  try {
    return JSON.parse(readFileSync(lockFile(appRoot), "utf8"))
  } catch {
    return null
  }
}

/** The lock, but only if a DIFFERENT, still-alive process holds it (else it's stale/ours). */
export function activeDevLock(appRoot) {
  const lock = readDevLock(appRoot)
  if (lock && lock.pid !== process.pid && pidAlive(lock.pid)) return lock
  return null
}

function writeDevLock(appRoot, data) {
  mkdirSync(path.join(appRoot, ADAPTV_DIR), { recursive: true })
  writeFileSync(lockFile(appRoot), `${JSON.stringify(data, null, 2)}\n`)
}

/**
 * Claim the dev lock for this process. Throws (with a `.tail` recovery hint) if another
 * LIVE dev run holds it; silently reclaims a STALE lock left by a previous run that was
 * SIGKILL'd before it could release. Port/url are filled in later by `updateDevLock` once
 * the server binds — they're what the error message reports to the next run.
 */
export function acquireDevLock(appRoot) {
  const held = activeDevLock(appRoot)
  if (held) {
    const where = held.url
      ? ` on ${held.url}`
      : held.port
        ? ` on port ${held.port}`
        : ""
    const err = new Error(
      `another \`adaptv dev\` is already running (pid ${held.pid})${where} — one dev server per app. Stop it first.`,
    )
    err.tail = `If that process is gone, remove the stale lock: rm ${path.join(ADAPTV_DIR, "dev.lock")}`
    throw err
  }
  writeDevLock(appRoot, { pid: process.pid, startedAt: Date.now() })
}

/** Fill in the bound port + url once the dev server is up (best-effort). */
export function updateDevLock(appRoot, { port, url }) {
  const lock = readDevLock(appRoot) ?? {
    pid: process.pid,
    startedAt: Date.now(),
  }
  if (lock.pid !== process.pid) return // not ours — don't clobber another run's lock
  writeDevLock(appRoot, { ...lock, port, url })
}

/** Release the lock — but only if it's still ours (never delete another run's lock). */
export function releaseDevLock(appRoot) {
  const lock = readDevLock(appRoot)
  if (lock && lock.pid !== process.pid) return
  try {
    rmSync(lockFile(appRoot))
  } catch {}
}

/**
 * Guard a config-mutating one-shot command (`preview`/`build`) against a live `dev` run.
 * Both regenerate capacitor.config.json from scratch, which would strip the running dev
 * server's `server.url` out from under it. Throws with a clear message if `dev` is active.
 */
export function assertNoActiveDevLock(appRoot, command) {
  const held = activeDevLock(appRoot)
  if (!held) return
  const where = held.url ? ` (${held.url})` : ""
  const err = new Error(
    `an \`adaptv dev\` run is active (pid ${held.pid})${where} — stop it before \`${command}\`. It rewrites capacitor.config.json, which would break the running dev server.`,
  )
  err.tail = `If that process is gone, remove the stale lock: rm ${path.join(ADAPTV_DIR, "dev.lock")}`
  throw err
}

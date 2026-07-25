// Single-instance guard for `adaptv dev`. Exactly one long-lived dev server may run per
// app: two would collide on the Vite port (7171), the cloudflare inspector port (9220),
// and — worst — the GLOBAL `adb reverse` mapping, where either run's teardown silently
// wipes the route for both. A pidfile in `.adaptv/` (hidden, git-ignored) makes a second
// `dev` fail fast, lets teardown remove only the adb mapping THIS run owns, and lets
// `preview`/`build` refuse while a dev run holds the (mutated) capacitor.config.json.
//
// It is fully self-managing: a lock left by a killed run is reclaimed automatically (dead
// pid, OR a live pid the OS reused for some unrelated program), so the dev never touches
// the file.
import { spawnSync } from "node:child_process"
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
    return err.code === "EPERM" // EPERM → alive but another user's; ESRCH → gone
  }
}

/**
 * Is this pid a REAL running adaptv dev? Alive AND its command is actually adaptv — the
 * command check guards against a reused pid (the OS handing this number to an unrelated
 * program later), so a stale lock always auto-reclaims and no one ever edits the file.
 */
function isLiveDev(pid) {
  if (!pidAlive(pid)) return false
  try {
    const r = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
    })
    if (r.status !== 0) return false
    return /adaptv/i.test(r.stdout ?? "")
  } catch {
    return true // can't check → assume live (safer than launching a second server)
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

/** The lock, but only if a DIFFERENT, genuinely-running adaptv dev holds it. */
/** Is the dev server this lock claims actually still serving? A lock records the port once
 * the server binds; if that port has no listener, the run behind it is defunct even though
 * its process lingers. */
function stillServing(rawPort) {
  //the lock records whatever the CLI had — which is a STRING when it came from a flag.
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port <= 0) return true //pre-bind / old lock: trust the pid
  try {
    const r = spawnSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8" },
    )
    return Boolean((r.stdout ?? "").trim())
  } catch {
    return true //can't check → assume it is (safer than starting a second server)
  }
}

export function activeDevLock(appRoot) {
  const lock = readDevLock(appRoot)
  if (!lock || lock.pid === process.pid) return null
  if (!isLiveDev(lock.pid)) return null //dead pid → stale, reclaim
  // The pid is alive but its dev server is NOT listening. That happens when something took
  // the port away — a `kill-and-takeover` (chopchop's `clearPorts`) kills the LISTENER, which
  // is the Vite child, while the adaptv parent survives holding this lock. Refusing then
  // would let a defunct process block every later run, and "kill the ports and take over"
  // would silently stop working. Treat it as stale and stop the husk.
  if (!stillServing(lock.port)) {
    try {
      process.kill(lock.pid, "SIGTERM")
    } catch {}
    return null
  }
  return lock
}

function writeDevLock(appRoot, data) {
  mkdirSync(path.join(appRoot, ADAPTV_DIR), { recursive: true })
  writeFileSync(lockFile(appRoot), `${JSON.stringify(data, null, 2)}\n`)
}

/**
 * Claim the dev lock. Throws a terse error if another dev is genuinely running; silently
 * reclaims a stale one. Port/url are filled in by `updateDevLock` once the server binds.
 */
export function acquireDevLock(appRoot) {
  const held = activeDevLock(appRoot)
  if (held) {
    throw new Error(
      `another dev server is already running (pid ${held.pid})`,
    )
  }
  writeDevLock(appRoot, { pid: process.pid, startedAt: Date.now() })
}

/** Fill in the bound port + url once the dev server is up (best-effort). */
export function updateDevLock(appRoot, { port, url }) {
  const lock = readDevLock(appRoot) ?? {
    pid: process.pid,
    startedAt: Date.now(),
  }
  if (lock.pid !== process.pid) return
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
 * Guard a config-mutating one-shot command (`preview`/`build`) against a live `dev` run —
 * both regenerate capacitor.config.json, which would break the running server.
 */
export function assertNoActiveDevLock(appRoot, command) {
  const held = activeDevLock(appRoot)
  if (!held) return
  throw new Error(
    `a dev server is running (pid ${held.pid}); stop it before ${command}`,
  )
}

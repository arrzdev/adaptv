// @vitest-environment node
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ADAPTV_DIR } from "./adaptv-dir.mjs"
import {
  acquireDevLock,
  activeDevLock,
  assertNoActiveDevLock,
  readDevLock,
  releaseDevLock,
  updateDevLock,
} from "./lock.mjs"

/**
 * The single-instance lock is what keeps two `dev` runs off one port and one `adb reverse`,
 * and it is "fully self-managing": nobody ever edits `.adaptv/dev.lock` by hand, because a
 * lock left behind by a killed run is reclaimed on the next one. That promise rests on
 * three judgements about the pid in the file — dead, alive-but-not-adaptv, alive-but-no-
 * longer-serving — and until now none of them had a test. Every one of them decides whether
 * a dev sees `another dev server is already running` for a process that is not.
 *
 * Real processes and real sockets, because the judgements are made with `ps` and `lsof`
 * and a fake would only prove that the fake agrees with itself.
 */

const dirs = []
const children = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL")
  }
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

function appRoot() {
  const dir = mkdtempSync(path.join(tmpdir(), "adaptv-lock-"))
  dirs.push(dir)
  return dir
}

const lockFile = (root) => path.join(root, ADAPTV_DIR, "dev.lock")

/**
 * A long-lived child. `marker` lands in its argv, which is what `ps -o command=` shows — so
 * `"adaptv"` makes it read as a real dev run and anything else as a stranger the OS handed
 * a recycled pid to. Resolves once the child has written a byte, so it has exec'd and `ps`
 * can see its command line.
 */
function liveProcess(marker) {
  const child = spawn(
    process.execPath,
    [
      "-e",
      'process.stdout.write("up"); setInterval(() => {}, 1000)',
      marker,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  )
  children.push(child)
  return new Promise((resolve) => {
    child.stdout.once("data", () => resolve(child))
  })
}

/** A pid nothing has: past every pid the kernel hands out. */
const DEAD_PID = 2 ** 30

/** A TCP port with a listener on it, held until `close()`. */
function listening() {
  return new Promise((resolve) => {
    const server = createServer()
    server.listen(0, "127.0.0.1", () =>
      resolve({
        port: server.address().port,
        close: () => new Promise((r) => server.close(() => r())),
      }),
    )
  })
}

/** A TCP port that was free a moment ago and has nothing on it now. */
async function freePort() {
  const held = await listening()
  await held.close()
  return held.port
}

describe("the dev lock's own lifecycle", () => {
  it("is claimed by this process, filled in when the server binds, and released", () => {
    const root = appRoot()
    acquireDevLock(root)
    expect(readDevLock(root)).toMatchObject({ pid: process.pid })
    expect(readDevLock(root).startedAt).toBeTypeOf("number")

    //the flag hands the port over as a STRING; the lock keeps whatever it was given
    updateDevLock(root, { port: "41730", url: "http://localhost:41730" })
    expect(readDevLock(root)).toMatchObject({
      pid: process.pid,
      port: "41730",
      url: "http://localhost:41730",
    })

    releaseDevLock(root)
    expect(existsSync(lockFile(root))).toBe(false)
  })

  it("a release never deletes another run's lock", async () => {
    const root = appRoot()
    const other = await liveProcess("adaptv")
    const held = await listening()
    try {
      acquireDevLock(root)
      //hand the file to the other run, the way a lock read back from disk would be
      const { writeFileSync } = await import("node:fs")
      writeFileSync(
        lockFile(root),
        JSON.stringify({ pid: other.pid, port: held.port }),
      )
      releaseDevLock(root)
      expect(existsSync(lockFile(root))).toBe(true)
    } finally {
      await held.close()
    }
  })

  it("is not its own obstacle: the process holding the lock sees no other run", () => {
    const root = appRoot()
    acquireDevLock(root)
    expect(activeDevLock(root)).toBe(null)
    expect(() => assertNoActiveDevLock(root, "build")).not.toThrow()
  })
})

describe("reclaiming a lock a killed run left behind", () => {
  it("a dead pid is stale — the next run simply takes over", async () => {
    const root = appRoot()
    const { mkdirSync, writeFileSync } = await import("node:fs")
    mkdirSync(path.dirname(lockFile(root)), { recursive: true })
    writeFileSync(
      lockFile(root),
      JSON.stringify({ pid: DEAD_PID, port: 41730, startedAt: 1 }),
    )
    expect(activeDevLock(root)).toBe(null)
    expect(() => acquireDevLock(root)).not.toThrow()
    expect(readDevLock(root).pid).toBe(process.pid)
  })

  it("a live pid the OS recycled for something that is not adaptv is stale too", async () => {
    const root = appRoot()
    const stranger = await liveProcess("nothing-of-the-sort")
    const held = await listening()
    try {
      const { mkdirSync, writeFileSync } = await import("node:fs")
      mkdirSync(path.dirname(lockFile(root)), { recursive: true })
      writeFileSync(
        lockFile(root),
        JSON.stringify({ pid: stranger.pid, port: held.port }),
      )
      expect(activeDevLock(root)).toBe(null)
      expect(() => acquireDevLock(root)).not.toThrow()
      //and the stranger is left alone — it was never ours to stop
      expect(stranger.exitCode).toBe(null)
      expect(stranger.signalCode).toBe(null)
    } finally {
      await held.close()
    }
  })
})

describe("refusing a second run while the first is genuinely serving", () => {
  it("names the pid, and stops `build` with the same fact", async () => {
    const root = appRoot()
    const dev = await liveProcess("adaptv")
    const held = await listening()
    try {
      const { mkdirSync, writeFileSync } = await import("node:fs")
      mkdirSync(path.dirname(lockFile(root)), { recursive: true })
      //a string port, exactly as a `--port` flag records it
      writeFileSync(
        lockFile(root),
        JSON.stringify({ pid: dev.pid, port: String(held.port) }),
      )
      expect(activeDevLock(root)).toMatchObject({ pid: dev.pid })
      expect(() => acquireDevLock(root)).toThrow(
        `another dev server is already running (pid ${dev.pid})`,
      )
      expect(() => assertNoActiveDevLock(root, "build")).toThrow(
        `a dev server is running (pid ${dev.pid}); stop it before build`,
      )
      expect(existsSync(lockFile(root))).toBe(true)
    } finally {
      await held.close()
    }
  })

  it("trusts the pid alone before the server has bound a port", async () => {
    //no `port` yet: the run is between claiming the lock and Vite coming up, which is
    //exactly when a second `dev` in another terminal has to be turned away
    const root = appRoot()
    const dev = await liveProcess("adaptv")
    const { mkdirSync, writeFileSync } = await import("node:fs")
    mkdirSync(path.dirname(lockFile(root)), { recursive: true })
    writeFileSync(lockFile(root), JSON.stringify({ pid: dev.pid }))
    expect(activeDevLock(root)).toMatchObject({ pid: dev.pid })
  })
})

describe("a husk — alive, adaptv, and no longer listening", () => {
  it("is stopped and reclaimed, so a killed listener cannot block every later run", async () => {
    //The case: something killed the Vite child (a port takeover) and the adaptv parent
    //survived, still holding the lock. Refusing on that pid would be permanent.
    const root = appRoot()
    const husk = await liveProcess("adaptv")
    const port = await freePort()
    const { mkdirSync, writeFileSync } = await import("node:fs")
    mkdirSync(path.dirname(lockFile(root)), { recursive: true })
    writeFileSync(lockFile(root), JSON.stringify({ pid: husk.pid, port }))

    const gone = new Promise((resolve) => husk.once("exit", resolve))
    expect(activeDevLock(root)).toBe(null)
    await gone
    expect(husk.signalCode).toBe("SIGTERM")
    expect(() => acquireDevLock(root)).not.toThrow()
    expect(readDevLock(root).pid).toBe(process.pid)
  })
})

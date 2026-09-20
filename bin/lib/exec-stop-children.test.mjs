// @vitest-environment node
import { spawn } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { capture, exec, stopChildren } from "./exec.mjs"

// A step's tools, and the tools THEY start, stop when adaptv stops the step (R73).
//
// The grandchild is what matters. A rebuild's child is `cap`, a Node process; Node's default
// SIGINT exits without passing it on, so the `xcodebuild` or gradle it launched ran on after
// adaptv had quit. The fixture is that shape: a Node parent that spawns `sleep`. Not
// `sh -c 'sleep 30 & wait'`, whose background `sleep` a non-interactive shell starts with SIGINT
// ignored, so no SIGINT stops it, from a terminal or from anyone.

/**
 * Every pid a case started and has not yet seen gone, killed by pid after the case, whether it
 * passed or not. A pid leaves the list the moment it is confirmed gone (`goneWithin`, the
 * stand-in's `exit`), so the kill never lands on a pid that has since been handed to someone
 * else.
 */
const strays = new Set()

const exists = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code !== "ESRCH"
  }
}

/** Resolve whether `pid` is gone within `ms`, polling; a pid that is gone stops being a stray. */
async function goneWithin(pid, ms) {
  const until = Date.now() + ms
  while (exists(pid)) {
    if (Date.now() > until) return false
    await new Promise((r) => setTimeout(r, 25))
  }
  strays.delete(pid)
  return true
}

/** Wait for the tool's pid file. Both pids become strays: a failing case must not leave a tool
 * behind, and the tool waits forever. */
async function waitForPids(file, ms = 5000) {
  const until = Date.now() + ms
  while (!existsSync(file) || !readFileSync(file, "utf8").includes(" ")) {
    if (Date.now() > until) throw new Error(`${file} never appeared`)
    await new Promise((r) => setTimeout(r, 25))
  }
  const [tool, grandchild] = readFileSync(file, "utf8")
    .split(" ")
    .map(Number)
  strays.add(tool)
  strays.add(grandchild)
  return { tool, grandchild }
}

/** `node -e` that starts a `sleep 30`, writes both pids, and waits like `cap` on xcodebuild. */
const toolWithGrandchild = (pidFile) => [
  "-e",
  `const c = require("node:child_process").spawn("sleep", ["30"], { stdio: "ignore" })
   require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, process.pid + " " + c.pid)
   setInterval(() => {}, 1e6)`,
]

let dir
afterEach(() => {
  stopChildren()
  //by PID, and only the ones these tests started
  for (const pid of strays) {
    if (exists(pid)) process.kill(pid, "SIGKILL")
  }
  strays.clear()
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

//Every wait below is bounded, and all of them together stay inside this: a real failure reports
//as the assertion that failed, not as a timeout.
const BUDGET = { timeout: 15_000 }

describe(
  "stopChildren stops a step's tools and whatever they started",
  BUDGET,
  () => {
    it.each([
      ["exec", (args) => exec(process.execPath, args)],
      ["capture", (args) => capture(process.execPath, args)],
    ])(
      "a tool run through %s takes its grandchild with it",
      async (_, run) => {
        dir = mkdtempSync(path.join(tmpdir(), "adaptv-stop-"))
        const pidFile = path.join(dir, "gc.pid")
        const step = run(toolWithGrandchild(pidFile))
        step.catch(() => {})
        const { tool, grandchild } = await waitForPids(pidFile)
        expect(exists(grandchild)).toBe(true)

        stopChildren()

        await step.catch(() => {})
        expect(await goneWithin(tool, 2000)).toBe(true)
        expect(await goneWithin(grandchild, 2000)).toBe(true)
      },
    )
  },
)

// The other way in: a REAL signal. A step's tools lead their own process groups now, so the
// SIGINT a terminal sends its foreground group reaches adaptv and not them. Each case runs a
// stand-in for adaptv in its own group, the way a shell runs a command, and sends the signal to
// that whole group, exactly as ctrl-c in a cooked terminal does.
describe(
  "a terminal's SIGINT, or any exit, still stops a step's tools",
  BUDGET,
  () => {
    const execUrl = pathToFileURL(path.resolve("bin/lib/exec.mjs")).href
    //Ink's own exit hook, from the copy Ink really loads
    const signalExit = createRequire(
      createRequire(path.resolve("bin/ui/watch.mjs")).resolve("ink"),
    ).resolve("signal-exit")

    /**
     * Start the stand-in, wait for its step's grandchild, SIGINT the group (unless `signal` is
     * false), and report how the stand-in ended and whether its tool and that tool's child are
     * both gone.
     * @param {string} setup code that runs before the step starts
     * @param {{ signal?: boolean }} [opts]
     */
    async function endMidStep(setup, { signal = true } = {}) {
      dir = mkdtempSync(path.join(tmpdir(), "adaptv-sigint-"))
      const pidFile = path.join(dir, "gc.pid")
      const script = path.join(dir, "cli.mjs")
      writeFileSync(
        script,
        `import { createRequire } from "node:module"
       import { existsSync } from "node:fs"
       import { exec } from ${JSON.stringify(execUrl)}
       const require = createRequire(import.meta.url)
       const pidFile = ${JSON.stringify(pidFile)}
       ${setup}
       await exec(process.execPath, ${JSON.stringify(toolWithGrandchild(pidFile))}).catch(() => {})
       //a step whose tool was stopped rejects; the stand-in must not simply run on and exit 0
       setInterval(() => {}, 1e6)`,
      )
      const cli = spawn(process.execPath, [script], {
        detached: true,
        stdio: "ignore",
      })
      strays.add(cli.pid)
      const ended = new Promise((resolve) =>
        cli.once("exit", (code, signal) => {
          strays.delete(cli.pid)
          resolve({ code, signal })
        }),
      )
      const { tool, grandchild } = await waitForPids(pidFile)

      if (signal) process.kill(-cli.pid, "SIGINT")

      const how = await Promise.race([
        ended,
        new Promise((r) => setTimeout(() => r("still running"), 4000)),
      ])
      //the tool the step ran, and the tool that tool started
      const toolGone = await goneWithin(tool, 2000)
      return {
        how,
        gone: toolGone && (await goneWithin(grandchild, 2000)),
      }
    }

    it("with no handler of its own (a build, a doctor), adaptv ends by the signal", async () => {
      const { how, gone } = await endMidStep("")
      expect(how).toEqual({ code: null, signal: "SIGINT" })
      expect(gone).toBe(true)
    })

    it("with a handler that exits (the dev session's onSigint, preview's quit)", async () => {
      const { how, gone } = await endMidStep(
        `process.on("SIGINT", () => process.exit(0))`,
      )
      expect(how).toEqual({ code: 0, signal: null })
      expect(gone).toBe(true)
    })

    it("with Ink's exit hook, which ends the process only when it listens alone", async () => {
      const { how, gone } = await endMidStep(
        `require(${JSON.stringify(signalExit)})(() => {})`,
      )
      expect(how).toEqual({ code: null, signal: "SIGINT" })
      expect(gone).toBe(true)
    })

    //No signal at all: another lane failed and the command exits while this step still runs.
    it("with no signal, an exit mid-step (a failed lane's exit) stops them too", async () => {
      const { how, gone } = await endMidStep(
        `setInterval(() => {
         if (existsSync(pidFile)) process.exit(1)
       }, 25)`,
        { signal: false },
      )
      expect(how).toEqual({ code: 1, signal: null })
      expect(gone).toBe(true)
    })
  },
)

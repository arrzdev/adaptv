// @vitest-environment node
import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { capture, exec, stopChildren } from "./exec.mjs"
import { quitSession, sessionKeys } from "./session-keys.mjs"

// The keys of a `dev` session and the quit they share (R73). The wiring half is pinned by the
// TEXT of `bin/adaptv.mjs` at the bottom, because that file runs the CLI on import.

/** A TTY stdin `onKeys` can put in raw mode and read keys from. */
class FakeStdin extends EventEmitter {
  isTTY = true
  setRawMode() {
    return this
  }
  resume() {
    return this
  }
  pause() {
    return this
  }
  setEncoding() {
    return this
  }
}

const realStdin = Object.getOwnPropertyDescriptor(process, "stdin")
afterEach(() => {
  Object.defineProperty(process, "stdin", realStdin)
  stopChildren()
})

describe("a quit stops the step, then the session", () => {
  it("stops the children BEFORE the teardown, which exits", () => {
    const order = []
    const quit = quitSession(
      () => order.push("onSigint"),
      () => order.push("stopChildren"),
    )
    quit()
    expect(order).toEqual(["stopChildren", "onSigint"])
  })

  it("idle: nothing is running, and the quit is the teardown alone", () => {
    const onSigint = vi.fn()
    let keys
    sessionKeys({
      onReload: vi.fn(),
      onRebuild: vi.fn(),
      onSigint,
      listen: (handlers) => {
        keys = handlers
        return () => {}
      },
    })
    keys.onQuit()
    expect(onSigint).toHaveBeenCalledTimes(1)
  })

  //The busy case, with REAL children: a relaunch's `simctl` goes through `capture`/`probe` and
  //a rebuild's tools through `exec`. Raw mode means no terminal SIGINT reaches them any more,
  //so the quit has to — and it has to before `onSigint` exits, or they outlive adaptv.
  it("busy: a step's running tools get SIGINT before the teardown runs", async () => {
    const tool = exec("sleep", ["30"])
    const query = capture("sleep", ["30"])
    let stopped = false
    let stoppedBeforeTeardown = null
    const onSigint = vi.fn()
    let keys
    sessionKeys({
      onReload: vi.fn(),
      onRebuild: vi.fn(),
      onSigint: () => {
        onSigint()
        stoppedBeforeTeardown = stopped
      },
      stopChildren: () => {
        stopChildren()
        stopped = true
      },
      listen: (handlers) => {
        keys = handlers
        return () => {}
      },
    })
    const started = Date.now()
    keys.onQuit()
    expect(onSigint).toHaveBeenCalledTimes(1)
    expect(stoppedBeforeTeardown).toBe(true)
    await expect(tool).rejects.toThrow()
    expect((await query).code).not.toBe(0)
    //stopped, not finished: `sleep 30` came back at once
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it("q and ctrl-c through the real key listener both take that quit", () => {
    const stdin = new FakeStdin()
    Object.defineProperty(process, "stdin", {
      value: stdin,
      configurable: true,
    })
    const order = []
    const dispose = sessionKeys({
      onReload: vi.fn(),
      onRebuild: vi.fn(),
      onSigint: () => order.push("onSigint"),
      stopChildren: () => order.push("stopChildren"),
    })
    stdin.emit("data", "q")
    stdin.emit("data", String.fromCharCode(3))
    dispose()
    expect(order).toEqual([
      "stopChildren",
      "onSigint",
      "stopChildren",
      "onSigint",
    ])
  })
})

describe("dev wires the session's keys for every renderer", () => {
  const src = (rel) =>
    readFileSync(path.join(process.cwd(), rel), "utf8").split("\n")
  const code = (line) =>
    line.trim() !== "" && !line.trim().startsWith("//")

  //The regression the watch-block test cannot see on its own: `dev` used to register the key
  //listener only `if (!useInk)`, leaving the Ink run with nothing but the block's `useInput`.
  it("registers `sessionKeys` exactly once, unconditionally", () => {
    const lines = src("bin/adaptv.mjs")
    const calls = lines
      .map((l, i) => [l, i])
      .filter(([l]) => /\bsessionKeys\(/.test(l) && code(l))
    expect(calls).toHaveLength(1)
    const [, at] = calls[0]
    //The statement the call belongs to starts at `cleanups.push(`, on its line or the one above.
    const start = lines[at].includes("cleanups.push(") ? at : at - 1
    expect(lines[start]).toContain("cleanups.push(")
    const before = lines.slice(0, start).filter(code).at(-1) ?? ""
    expect(before.trim()).not.toMatch(/^(if|else)\b|^\}\s*else\b/)
    expect(lines.join("\n")).not.toMatch(
      /if\s*\(\s*!?useInk\s*\)\s*\n?\s*cleanups/,
    )
  })

  it("leaves the watch block reading no keys of its own", () => {
    const watch = src("bin/ui/watch.mjs").filter(code).join("\n")
    expect(watch).not.toMatch(/\buseInput\b/)
  })
})

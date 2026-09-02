// @vitest-environment node
import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"
import { onKeys } from "./render.mjs"

// The keys a `dev` run listens for, and what each one costs (dev-loop debt §I). Expo's `r`
// reloads the JS bundle in a beat; ours once meant a full native rebuild + reinstall (~15s,
// and the app's state with it). The cheap action is the one a dev wants most often, so the two
// are separate keys: `r` reloads the running app's JS, `b` rebuilds the native app. `R` is
// deliberately NOTHING — a shift typo must not turn a 0.4s reload into a 15s reinstall — and
// `q` / ctrl-c quit, forwarded by hand because raw mode stops the terminal doing it.
//
// `onKeys` reads `process.stdin` when it is CALLED, so a fake stdin swapped in before the call
// is enough; nothing has to be re-imported.

class FakeStdin extends EventEmitter {
  constructor(isTTY = true) {
    super()
    this.isTTY = isTTY
    /** @type {boolean | null} what `setRawMode` was last given; null = never called */
    this.raw = null
    this.encoding = null
    this.flowing = false
  }
  setRawMode(on) {
    this.raw = on
    return this
  }
  resume() {
    this.flowing = true
    return this
  }
  pause() {
    this.flowing = false
    return this
  }
  setEncoding(enc) {
    this.encoding = enc
    return this
  }
}

const real = Object.getOwnPropertyDescriptor(process, "stdin")
afterEach(() => {
  Object.defineProperty(process, "stdin", real)
})

/** Swap in a fake stdin, wire `onKeys` to three spies, return everything the tests poke. */
function listen({ isTTY = true } = {}) {
  const stdin = new FakeStdin(isTTY)
  Object.defineProperty(process, "stdin", {
    value: stdin,
    configurable: true,
  })
  const onReload = vi.fn()
  const onRebuild = vi.fn()
  const onQuit = vi.fn()
  const dispose = onKeys({ onReload, onRebuild, onQuit })
  return { stdin, onReload, onRebuild, onQuit, dispose }
}

const CTRL_C = "\u0003"

describe("the run-loop keys", () => {
  it("puts the terminal in raw mode and reads utf8 while listening", () => {
    const { stdin } = listen()
    expect(stdin.raw).toBe(true)
    expect(stdin.encoding).toBe("utf8")
    expect(stdin.flowing).toBe(true)
    expect(stdin.listenerCount("data")).toBe(1)
  })

  it("'r' reloads the JS and nothing else", () => {
    const { stdin, onReload, onRebuild, onQuit } = listen()
    stdin.emit("data", "r")
    expect(onReload).toHaveBeenCalledTimes(1)
    expect(onRebuild).not.toHaveBeenCalled()
    expect(onQuit).not.toHaveBeenCalled()
  })

  it("'b' rebuilds the native app and nothing else", () => {
    const { stdin, onReload, onRebuild, onQuit } = listen()
    stdin.emit("data", "b")
    expect(onRebuild).toHaveBeenCalledTimes(1)
    expect(onReload).not.toHaveBeenCalled()
    expect(onQuit).not.toHaveBeenCalled()
  })

  //The shift typo. If `R` ever maps to anything, a dev reaching for the 0.4s reload gets
  //the 15s reinstall instead — and loses the app state they were looking at.
  it("'R' does nothing — a shift typo never swaps a reload for a reinstall", () => {
    const { stdin, onReload, onRebuild, onQuit } = listen()
    stdin.emit("data", "R")
    stdin.emit("data", "B")
    expect(onReload).not.toHaveBeenCalled()
    expect(onRebuild).not.toHaveBeenCalled()
    expect(onQuit).not.toHaveBeenCalled()
  })

  it("'q' and ctrl-c both quit — raw mode means ctrl-c is a byte, not a SIGINT", () => {
    const { stdin, onReload, onRebuild, onQuit } = listen()
    stdin.emit("data", "q")
    expect(onQuit).toHaveBeenCalledTimes(1)
    stdin.emit("data", CTRL_C)
    expect(onQuit).toHaveBeenCalledTimes(2)
    expect(onReload).not.toHaveBeenCalled()
    expect(onRebuild).not.toHaveBeenCalled()
  })

  it("the disposer removes the listener and leaves raw mode off", () => {
    const { stdin, onReload, onRebuild, onQuit, dispose } = listen()
    dispose()
    expect(stdin.listenerCount("data")).toBe(0)
    expect(stdin.raw).toBe(false)
    expect(stdin.flowing).toBe(false)
    //A key after teardown reaches nobody.
    stdin.emit("data", "r")
    stdin.emit("data", "b")
    stdin.emit("data", "q")
    expect(onReload).not.toHaveBeenCalled()
    expect(onRebuild).not.toHaveBeenCalled()
    expect(onQuit).not.toHaveBeenCalled()
  })

  //CI, a piped runner, an editor's task pane: there is nothing to put in raw mode and nobody
  //to press anything. The keys are simply off, and the disposer is a no-op.
  it("off a TTY it listens to nothing and never touches raw mode", () => {
    const { stdin, dispose } = listen({ isTTY: false })
    expect(stdin.raw).toBeNull()
    expect(stdin.listenerCount("data")).toBe(0)
    expect(() => dispose()).not.toThrow()
    expect(stdin.raw).toBeNull()
  })
})

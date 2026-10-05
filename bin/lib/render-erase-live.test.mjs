// @vitest-environment node
import { EventEmitter } from "node:events"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

// A run can end in the middle of a step: `q` or ctrl-c while `r` is relaunching the app or `b` is
// rebuilding it. The step's live row is still mounted then, and Ink's exit hook unmounts it on
// the way out, which leaves its last frame on screen by design. The session ended on
//
//     ⠸ ios  reloading device
//
// a spinner that had stopped spinning and read as work still going. `eraseLive` is what the
// quit calls first. These drive the REAL `runLine` through Ink against a fake TTY and replay
// the frames into the screen the dev is left with.

class FakeStdout extends EventEmitter {
  constructor(columns = 100) {
    super()
    this.columns = columns
    this.rows = 30
    this.isTTY = true
    this.frames = []
  }
  write(s) {
    this.frames.push(s)
    return true
  }
}

const ESC = String.fromCharCode(27)
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, "g")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Replay Ink's `eraseLines(n) + output` frames into what is left on screen (see live.test). */
const ERASE = new RegExp(`^(?:${ESC}\\[2K(?:${ESC}\\[1A)?)+${ESC}\\[G`)
function screen(frames) {
  let lines = []
  for (const frame of frames) {
    let rest = frame
    const erase = rest.match(ERASE)
    if (erase) {
      const n = erase[0].split(`${ESC}[2K`).length - 1
      lines = lines.slice(0, Math.max(0, lines.length - n))
      rest = rest.slice(erase[0].length)
    }
    //A frame that is only a control sequence (Ink hiding the cursor) draws no row.
    const text = rest.replace(ANSI, "")
    if (text) lines = lines.concat(text.split("\n"))
  }
  return lines.join("\n")
}

let restore = null
afterEach(() => {
  restore?.()
  restore = null
})

/** `render.mjs` reads `isTTY` once at load, so the fake goes in BEFORE a fresh import. */
async function liveRender() {
  const fake = new FakeStdout()
  const real = Object.getOwnPropertyDescriptor(process, "stdout")
  //DELETE `CI`: Ink asks whether the key exists, and in CI mode it never animates.
  const ci = process.env.CI
  delete process.env.CI
  Object.defineProperty(process, "stdout", {
    value: fake,
    configurable: true,
  })
  restore = () => {
    Object.defineProperty(process, "stdout", real)
    if (ci === undefined) delete process.env.CI
    else process.env.CI = ci
  }
  vi.resetModules()
  return { render: await import("./render.mjs"), fake }
}

/** Waits on the frame itself: the test's own timeout is the only deadline. */
async function until(check) {
  while (!check()) await sleep(20)
}

describe("a quit mid-step leaves no live row behind", () => {
  //`runLine` loads Ink on its first step, and the first load transforms it: seconds on a loaded
  //host. Done here, under the hook's budget, the tests' steps load it from the transform cache.
  //Ink's `is-in-ci` reads `CI` once, at load, and survives `resetModules`: the load that caches
  //it runs without `CI` too, or every later step renders in CI mode and never animates.
  beforeAll(async () => {
    const ci = process.env.CI
    delete process.env.CI
    try {
      await import("../ui/live.mjs")
    } finally {
      if (ci !== undefined) process.env.CI = ci
    }
  }, 30_000)

  it("erases a step that is still running", async () => {
    const { render, fake } = await liveRender()
    //A relaunch that never comes back: the quit lands while it is in flight.
    void render.runLine("ios", (report) => {
      report("reloading device")
      return new Promise(() => {})
    })
    await until(() => screen(fake.frames).includes("reloading device"))
    expect(screen(fake.frames)).toContain("reloading device")

    //Asserted with NO wait: the quit calls this and exits on the next line, so an erase that
    //needed a tick would never reach the terminal.
    render.eraseLive()
    expect(screen(fake.frames)).not.toContain("reloading device")
    //…and the step's own phase timer, still ticking, does not paint it back.
    await sleep(200)
    expect(screen(fake.frames)).not.toContain("reloading device")
  })

  it("erases every lane of a multi-platform step", async () => {
    const { render, fake } = await liveRender()
    void render.runLanes([
      { label: "ios", run: () => new Promise(() => {}) },
      { label: "android", run: () => new Promise(() => {}) },
    ])
    await until(() => screen(fake.frames).includes("android"))

    render.eraseLive()
    const left = screen(fake.frames)
    expect(left).not.toContain("ios")
    expect(left).not.toContain("android")
  })

  it("is a no-op when nothing is animating, and after a step settled normally", async () => {
    const { render, fake } = await liveRender()
    await render.runLine("ios", async () => "iPhone 16 Pro")
    const before = fake.frames.length
    render.eraseLive()
    expect(fake.frames.length).toBe(before)
  })
})

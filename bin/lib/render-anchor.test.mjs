// @vitest-environment node
import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"

// What a live row says when the tool it is watching STOPS talking.
//
// A native build is loud in bursts and silent in between, so a row that has heard nothing for
// `IDLE_MS` falls back to an anchor. The anchor used to be a constant per lane, and `dev`
// showed the same one twice for a single build — once in the pause before xcodebuild speaks,
// once during the silent install at the end, with the real build phases in between. The second
// was a lie: the app was being installed, not built.
//
// These tests drive the REAL `runLine` through Ink against a fake TTY and read the frames, so
// they assert what the row says rather than how the fallback is computed.

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

const ANSI = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;?]*[a-zA-Z]`,
  "g",
)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let restore = null
afterEach(() => {
  restore?.()
  restore = null
})

/**
 * Import `render.mjs` fresh against a fake TTY — `isTTY` is read once at module load, so the
 * stdout has to be in place BEFORE the import or the live path is never taken.
 */
async function withLiveStdout(fn) {
  const fake = new FakeStdout()
  const real = Object.getOwnPropertyDescriptor(process, "stdout")
  //DELETE `CI`, don't blank it. `render.mjs` only asks whether it is truthy, but Ink asks
  //whether the key EXISTS — and in CI mode Ink writes one frame at unmount instead of
  //animating, so `CI=""` produced a live row that never drew and every assertion read "".
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
  const render = await import("./render.mjs")
  const out = await fn(render, fake)
  restore()
  restore = null
  return out
}

/** The row as the dev sees it, from the most recent frame. */
const row = (fake) => (fake.frames.at(-1) ?? "").replace(ANSI, "").trim()

// The dwell is 700ms and `IDLE_MS` is 1200, so a stage takes ~1.5s to observe: long enough for
// the tool line to be adopted, then long enough for the row to fall back off it.
//
// The tool lines here are all TWO words on purpose. `prettyLine` drops a lone verb — that rule
// is what keeps gradle from strobing a row — so `compiling` never reaches the row at all, and a
// first draft of this test passed without the fallback ever running.
const TOOL_ADOPTED = 800
const THEN_QUIET = 800

describe("a quiet row falls back to the STAGE it is in", () => {
  it("holds the phase adaptv announced, not the tool line that went quiet", async () => {
    const seen = {}
    /** Announce a stage, let a tool line take the row, then let the row go quiet. */
    const stage = async (report, fake, own, toolLine, key) => {
      report(own)
      report(toolLine)
      await sleep(TOOL_ADOPTED)
      seen[`${key}Loud`] = row(fake)
      await sleep(THEN_QUIET)
      seen[`${key}Quiet`] = row(fake)
    }
    await withLiveStdout(async ({ runLine }, fake) => {
      await runLine(
        "ios",
        async (report) => {
          await stage(
            report,
            fake,
            "syncing",
            "installing dependencies",
            "sync",
          )
          await stage(
            report,
            fake,
            "building app",
            "compiling sources",
            "build",
          )
          //THE REGRESSION. The build is done and the device's turn starts; with a constant
          //anchor the row dropped back to `building app` a second time here, while the app
          //was being installed. Same words as the previous stage, in the wrong stage.
          await stage(
            report,
            fake,
            "launching device",
            "installing bundle",
            "launch",
          )
          return "iPhone 16 Pro"
        },
        { idle: "building app" },
      )
    })

    //The tool line really did reach the row — otherwise the fallback below proves nothing.
    expect(seen.syncLoud).toContain("installing dependencies")
    expect(seen.buildLoud).toContain("compiling sources")
    expect(seen.launchLoud).toContain("installing bundle")

    //…and when it goes quiet the row names its stage, which moves with the run.
    expect(seen.syncQuiet).toContain("syncing")
    expect(seen.buildQuiet).toContain("building app")
    expect(seen.launchQuiet).toContain("launching device")
    expect(seen.launchQuiet).not.toContain("building app")
  }, 30000)

  it("uses the seeded idle label until adaptv has announced anything", async () => {
    //A lane that has only ever heard the tool still needs somewhere to fall back to.
    let quiet = ""
    await withLiveStdout(async ({ runLine }, fake) => {
      await runLine(
        "android",
        async (report) => {
          report("installing dependencies")
          await sleep(TOOL_ADOPTED + THEN_QUIET)
          quiet = row(fake)
          return "Pixel 10"
        },
        { idle: "building app" },
      )
    })
    expect(quiet).toContain("building app")
  }, 30000)
})

// @vitest-environment node
import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"

// A live row only ever moves FORWARD.
//
// It shows the last phase reported, and silence changes nothing. There used to be an idle
// fallback: after `IDLE_MS` of quiet the row dropped back to a per-lane label so it would not
// freeze on a stale tool line. It read as the build restarting —
//
//     building app → compiling → building app → processing resources → building app
//
// — and making that label track the current stage instead of a constant fixed only the case
// where it was an outright lie, not the repetition, which was the actual complaint.
//
// These drive the REAL `runLine` through Ink against a fake TTY and SAMPLE the frames, so they
// assert the sequence the dev watches rather than how a phase is chosen.

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
const SPINNER = /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+\S+\s+/
//The holds below are virtual: the clock, the row's 80ms tick and the recorder's 40ms sample
//all run on fake timers, so a 1400ms hold costs a few ms of real time and every timer fires
//in the same order it would on the wall clock. `setImmediate`, which Ink and React schedule
//through, stays real. The clock is faked only after the import, so loading Ink costs what it did.
const sleep = (ms) => vi.advanceTimersByTimeAsync(ms)

let restore = null
afterEach(() => {
  restore?.()
  restore = null
  vi.useRealTimers()
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
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  })
  const out = await fn(render, fake)
  restore()
  restore = null
  return out
}

/** The phase the row is showing right now — the last frame, minus the spinner and the label. */
const phaseNow = (fake) => {
  const line = (fake.frames.at(-1) ?? "").replace(ANSI, "").trim()
  return SPINNER.test(line) ? line.replace(SPINNER, "") : ""
}

/** Watch the row for a whole run and collect every phase it displayed, in order. */
function recorder(fake) {
  const seq = []
  const t = setInterval(() => {
    const p = phaseNow(fake)
    if (p && p !== seq.at(-1)) seq.push(p)
  }, 40)
  return { seq, stop: () => clearInterval(t) }
}

// The dwell is 700ms, so a phase needs longer than that to be adopted — and longer than the
// 1200ms the old fallback fired at, so a run that still had one would visibly rewind between
// every pair of phases. That is what makes the sequence below a regression test and not just a
// transcript.
const HOLD = 1400

describe("a live row only moves forward", () => {
  it("never returns to a phase it has already left", async () => {
    let seq = []
    await withLiveStdout(async ({ runLine }, fake) => {
      const rec = recorder(fake)
      await runLine("ios", async (report) => {
        //A full native launch, in the order `launchOne` announces it. The two-word tool lines
        //are deliberate: `prettyLine` drops a lone verb, so `compiling` never reaches the row.
        for (const p of [
          "syncing",
          "installing dependencies",
          "building app",
          "compiling sources",
          "launching device",
        ]) {
          report(p)
          await sleep(HOLD)
        }
        return "iPhone 16 Pro"
      })
      rec.stop()
      seq = rec.seq
    })

    //No `preparing` — the row paints its FIRST phase the moment it is announced rather than
    //waiting for a tick, so the placeholder is never on screen when work starts immediately.
    expect(seq).toEqual([
      "syncing",
      "installing dependencies",
      "building app",
      "compiling sources",
      "launching device",
    ])
    //The property, stated directly: no phase is ever shown, left, and shown again.
    expect(new Set(seq).size).toBe(seq.length)
  }, 30000)

  it("HOLDS its last phase when the tool goes quiet", async () => {
    //What the removed fallback used to override. A frozen `compiling sources` is not
    //misleading — it is the most specific true thing the tool said, and the spinner is what
    //says the row is alive.
    let late = ""
    await withLiveStdout(async ({ runLine }, fake) => {
      await runLine("android", async (report) => {
        report("building app")
        await sleep(HOLD)
        report("compiling sources")
        //Well past the 1200ms the old fallback fired at.
        await sleep(2200)
        late = phaseNow(fake)
        return "Pixel 10"
      })
    })
    expect(late).toBe("compiling sources")
  }, 30000)
})

import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"

// The watch block is where a cursor-arithmetic bug actually shipped: the string renderer grows
// it to two rows for a notice and shrinks it back, by hand, and getting that off by one walked
// the block up the screen and erased the settled lines above it.
//
// Ink writes WHOLE FRAMES, so the last frame it wrote is the screen. That makes these
// assertions about what the dev sees, not about escape sequences — which is exactly the kind of
// check the old renderer could not have.

/** A stdout Ink will happily render into, keeping every frame. */
class FakeStdout extends EventEmitter {
  constructor(columns = 100) {
    super()
    this.columns = columns
    this.rows = 30
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

let restore = null
afterEach(() => {
  restore?.()
  restore = null
})

/*
 * Wait for Ink to STOP writing, rather than sleeping a guessed number of milliseconds.
 *
 * Ink renders asynchronously, so a fixed wait is a bet on how loaded the machine is. At
 * 120ms these passed on a laptop and failed on CI, where the last frame had not been
 * written yet — so `clearNotice()` looked like it had not cleared, which reads as a
 * cursor-arithmetic bug in the very code these tests exist to pin. Settling on "no new
 * frame for two ticks" asserts the same thing without the bet.
 */
async function settled(fake, deadlineMs = 3000) {
  const stop = Date.now() + deadlineMs
  let seen = -1
  let quiet = 0
  while (Date.now() < stop) {
    await new Promise((r) => setTimeout(r, 20))
    if (fake.frames.length === seen) {
      if (++quiet >= 2 && seen > 0) return
    } else {
      seen = fake.frames.length
      quiet = 0
    }
  }
}

/*
 * Ink must be imported with `CI` ABSENT, and imported fresh.
 *
 * In CI mode Ink skips the animation entirely and writes one frame at unmount, so
 * `fake.frames` stays empty and every assertion about "what the dev sees" reads "".
 * That is why these passed on a laptop and failed the first time CI ever ran on this
 * branch — nine tests across this file and live.test.mjs, none about anything that
 * had changed. `CI=true pnpm test bin/ui/` reproduces it.
 *
 * DELETE the key, do not blank it: Ink asks whether it EXISTS, so `CI=""` still counts.
 * And `vi.resetModules()` before the import, because the check runs once at module load
 * — the same shape `render-phase-order.test.mjs` already uses for `render.mjs`.
 */
function withInteractiveInk() {
  const ci = process.env.CI
  delete process.env.CI
  return () => {
    if (ci === undefined) delete process.env.CI
    else process.env.CI = ci
  }
}

/** Mount the block, drive it, and return the final screen as trimmed lines. */
async function screen(drive, columns = 100) {
  const fake = new FakeStdout(columns)
  const real = Object.getOwnPropertyDescriptor(process, "stdout")
  Object.defineProperty(process, "stdout", {
    value: fake,
    configurable: true,
  })
  const restoreCi = withInteractiveInk()
  restore = () => {
    restoreCi()
    Object.defineProperty(process, "stdout", real)
  }
  vi.resetModules()
  const { inkWatcher } = await import("./watch.mjs")
  //`keys: false` — no raw-mode stdin to set up, and the keys row is asserted separately.
  const w = inkWatcher({ keys: false })
  drive(w)
  await settled(fake)
  const last = fake.frames.at(-1) ?? ""
  w.stop()
  restore()
  restore = null
  return last
    .replace(ANSI, "")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "")
}

describe("the watch block — a notice is ADDED, never swapped in", () => {
  it("is just the keys when there is nothing to say", async () => {
    const rows = await screen(() => {})
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain("ctrl-c")
  })

  it("puts a notice on its own row and KEEPS the keys underneath (R41)", async () => {
    const rows = await screen((w) => w.notice("config change"))
    //The regression this exists for: the notice used to REPLACE the keys row, so the moment
    //adaptv had something to say the dev lost the very key it was telling them to press.
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain("! config change")
    expect(rows[0]).toContain("press b to rebuild")
    expect(rows[1]).toContain("ctrl-c")
  })

  it("holds the notice while an HMR flash animates below it", async () => {
    const rows = await screen((w) => {
      w.notice("config + native change · ios, android")
      w.hmr("app.tsx, main.css")
    })
    expect(rows[0]).toContain("config + native change")
    //The bottom row is the spinner now, not the keys — and the notice above is untouched.
    expect(rows.at(-1)).toContain("watching")
    expect(rows.at(-1)).toContain("app.tsx, main.css")
  })

  it("shrinks back to one row when the notice clears, leaving nothing behind", async () => {
    const rows = await screen((w) => {
      w.notice("config change")
      w.clearNotice()
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain("ctrl-c")
    expect(rows.join("\n")).not.toContain("config change")
  })

  it("indents to the body grid rather than prefixing spaces per line", async () => {
    const rows = await screen((w) => w.notice("config change"))
    for (const r of rows) expect(r.startsWith("  ")).toBe(true)
  })

  it("stays inside a narrow terminal", async () => {
    const rows = await screen((w) => w.notice("config change"), 40)
    for (const r of rows) expect(r.length).toBeLessThanOrEqual(40)
  })

  it("ERASES itself on stop, so `rewindLines` counts from the right row", async () => {
    //The bug: `stop()` unmounted and THEN cleared, and after unmounting there is nothing
    //left to clear — Ink keeps its last frame on screen by design. The block survived, which
    //pushed everything below it down by its own height, and `r`/`b` walk the cursor back a
    //FIXED number of rows (the blank separator + one per platform) to redraw the platform
    //lines in place. Landing short, they rebuilt underneath their own history:
    //
    //    ✓ ios  iPhone 16 Pro (simulator) · cached · 366ms
    //    ✓ ios  iPhone 16 Pro (simulator) · reloaded · 369ms
    //    ✓ ios  iPhone 16 Pro (simulator) · 21.4s
    //
    //Two rows, so a one-row clear would also pass — the notice makes the height matter.
    const fake = new FakeStdout(100)
    const real = Object.getOwnPropertyDescriptor(process, "stdout")
    Object.defineProperty(process, "stdout", {
      value: fake,
      configurable: true,
    })
    const restoreCi = withInteractiveInk()
    restore = () => {
      restoreCi()
      Object.defineProperty(process, "stdout", real)
    }
    vi.resetModules()
    const { inkWatcher } = await import("./watch.mjs")
    const w = inkWatcher({ keys: false })
    w.notice("config change")
    await settled(fake)
    const before = fake.frames.length
    w.stop()
    restore()
    restore = null
    //Everything written from `stop()` onwards. Nothing may re-state the block.
    const after = fake.frames.slice(before).join("")
    expect(after).not.toContain("config change")
    expect(after).not.toContain("ctrl-c")
    //And it must actually erase: two rows up, not one.
    const esc = String.fromCharCode(27)
    expect(after).toContain(`${esc}[2K`)
    expect(after).toContain(`${esc}[1A`)
  })
})

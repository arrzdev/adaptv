import { EventEmitter } from "node:events"
import { act } from "react"
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

/**
 * Make a change the block reacts to, and resolve once React has finished everything it caused,
 * the frame Ink writes included.
 *
 * Ink paints the block's FIRST frame inside `render()`. Every frame after it, the notice's
 * included, is painted by a React scheduler task, a macrotask after the `notice()` that caused
 * it. A fixed 120ms wait was a bet on that task and lost on CI. The clock that replaced it waited
 * for "no new frame for two ticks", but the first frame already counted as seen, so about 60ms
 * of quiet before the task ran was enough to return and read the keys row alone. Holding every
 * scheduler slice back 100ms fails the notice test every time it runs alone.
 *
 * `act()` runs the queued work itself before it returns, and `REGION`'s `maxFps: 0` makes Ink
 * write the frame in the same commit, so a test reads it without waiting on a clock.
 */
async function settled(change) {
  const was = globalThis.IS_REACT_ACT_ENVIRONMENT
  //without it React logs "not configured to support act(...)" on every change
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  try {
    await act(async () => {
      change()
    })
  } finally {
    globalThis.IS_REACT_ACT_ENVIRONMENT = was
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

/**
 * Mount the block, drive it, and return the final screen as trimmed lines — **blank rows
 * dropped**, because most assertions here are about which rows exist and in what order.
 * `screenRaw` keeps them, for the one thing that IS a blank row.
 */
async function screen(drive, columns = 100) {
  return (await screenRaw(drive, columns)).filter((l) => l.trim() !== "")
}

/** The same, with every row the block drew — blanks included. */
async function screenRaw(drive, columns = 100) {
  const block = await mount(columns)
  await settled(() => drive(block.w))
  const rows = block.rows()
  block.unmount()
  return rows
}

/**
 * Mount the block into a fake stdout, for a test that reads the screen more than once.
 * `rows()` is the last frame as trimmed lines, blanks included; `unmount()` stops the block and
 * gives the real stdout back.
 */
async function mount(columns = 100) {
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
  const rows = () =>
    (fake.frames.at(-1) ?? "")
      .replace(ANSI, "")
      .split("\n")
      .map((l) => l.trimEnd())
      //a trailing "" is the frame's own closing newline, not a row the block drew
      .slice(0, -1)
  const unmount = () => {
    w.stop()
    restore()
    restore = null
  }
  return { fake, w, rows, unmount }
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
    //Two separate changes, each painted: made together they batch into ONE commit, the block
    //never grows, and the shrink under test never happens.
    const block = await mount()
    const drawn = () => block.rows().filter((l) => l.trim() !== "")
    try {
      await settled(() => block.w.notice("config change"))
      expect(drawn()).toHaveLength(2)
      const grown = block.fake.frames.length
      await settled(() => block.w.clearNotice())
      //a NEW frame: the one-row screen must be the shrink, not the frame from before the notice
      expect(block.fake.frames.length).toBeGreaterThan(grown)
      const rows = drawn()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toContain("ctrl-c")
      expect(rows.join("\n")).not.toContain("config change")
    } finally {
      block.unmount()
    }
  })

  it("indents to the body grid rather than prefixing spaces per line", async () => {
    const rows = await screen((w) => w.notice("config change"))
    //the keys row alone would pass the loop below without a notice ever drawn
    expect(rows[0]).toContain("config change")
    for (const r of rows) expect(r.startsWith("  ")).toBe(true)
  })

  //The widths: 40 is the narrowest the visual language asks a command to be looked at in
  //(`docs/design/cli-visual.md` §6), and 80 is where the longest notice `dev` really raises
  //already did not fit.
  it.each([
    ["config change", 40, {}],
    ["config + native change · ios, android", 40, {}],
    ["config + native change · ios, android", 80, {}],
    ["adaptv source change", 40, { restart: true }],
  ])(
    "keeps the notice %j to ONE row at %i columns (R10, R44) %o",
    async (label, columns, options) => {
      //A length bound alone passed while the notice wrapped: every flex item shrank and wrapped
      //inside its own sliver, so each row stayed short and the block grew a row instead, glyph
      //gone and words split down columns:
      //
      //     config     ·   b to rebuild and see
      //     change   press  the changes
      const rows = await screenRaw(
        (w) => w.notice(label, options),
        columns,
      )
      for (const r of rows) expect(r.length).toBeLessThanOrEqual(columns)
      //notice, blank, keys: a wrapped notice makes this four or five
      expect(rows).toHaveLength(3)
      expect(rows[2]).toContain("ctrl-c")
      expect(rows[0].startsWith("  ! ")).toBe(true)
      //The notice CLIPS at its end, like every live row: the glyph and cause come first, and
      //whatever is cut is cut from the tail, marked, rather than carried to a second row.
      //`full` is the same notice with room to spare, so the copy lives in one place and this
      //test is about the clip, not the wording.
      const [full] = await screenRaw((w) => w.notice(label, options), 200)
      expect(full.startsWith(`  ! ${label}  · `)).toBe(true)
      //the premise: at this width the full notice does not fit, or nothing here was clipped
      expect(full.length).toBeGreaterThan(columns)
      expect(rows[0]).toBe(`${full.slice(0, columns - 1)}…`)
      //a clipped restart notice still must not start offering the key it has no use for (R54)
      if (options.restart) expect(rows[0]).not.toContain("press")
    },
  )

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
    await settled(() => w.notice("config change"))
    //the premise: the notice is ON screen, or the erase below proves nothing about height
    expect(fake.frames.at(-1)).toContain("config change")
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

describe("a notice whose fix is a RESTART (R54)", () => {
  const REBUILD =
    "  ! config change  · press b to rebuild and see the changes"
  const RESTART = "  ! adaptv source change  · restart to apply"

  it("says restart to apply, and never offers b", async () => {
    //`b` reruns the build with the modules THIS process already loaded, so it cannot apply an
    //edit to adaptv's own source. The Ink block used to drop the `restart` option and tell the
    //dev to press it anyway — a key that does nothing, the lie the keys guard exists to prevent.
    const rows = await screenRaw((w) =>
      w.notice("adaptv source change", { restart: true }),
    )
    expect(rows).toHaveLength(3)
    expect(rows[0]).toBe(RESTART)
    expect(rows[0]).not.toContain("press b")
    expect(rows[0]).not.toContain("rebuild")
    //the keys row is untouched (R41): the notice changes its own action, not the block
    expect(rows[2]).toContain("ctrl-c")
  })

  //Each notice carries its own action, exactly as `liveWatcher` does: a later notice replaces
  //the text AND the action, in either order, and nothing is sticky in the renderer. Which cause
  //wins the row is decided where the causes are known, in the `dev` poll.
  it.each([
    [
      "restart, then a rebuild notice",
      ["adaptv source change", { restart: true }],
      ["config change"],
      REBUILD,
    ],
    [
      "a rebuild notice, then restart",
      ["config change"],
      ["adaptv source change", { restart: true }],
      RESTART,
    ],
  ])(
    "the later notice decides the action: %s",
    async (_, first, second, want) => {
      const block = await mount()
      try {
        await settled(() => block.w.notice(...first))
        const painted = block.fake.frames.length
        await settled(() => block.w.notice(...second))
        //a NEW frame, or the row below is still the first notice
        expect(block.fake.frames.length).toBeGreaterThan(painted)
        expect(block.rows()[0]).toBe(want)
      } finally {
        block.unmount()
      }
    },
  )

  it("forgets the restart when the notice clears", async () => {
    const block = await mount()
    try {
      await settled(() =>
        block.w.notice("adaptv source change", { restart: true }),
      )
      await settled(() => block.w.clearNotice())
      await settled(() => block.w.notice("config change"))
      expect(block.rows()[0]).toBe(REBUILD)
    } finally {
      block.unmount()
    }
  })

  //the string renderer and Ink each draw this block, so the two must say the same thing or the
  //renderers drift apart unnoticed. 200 columns, so neither clip is in play — the two renderers
  //mark a clip differently, and that is not this test.
  it.each([
    ["config change", {}],
    ["adaptv source change", { restart: true }],
  ])(
    "draws %j %o the same as the string renderer",
    async (label, options) => {
      const ink = await screenRaw((w) => w.notice(label, options), 200)

      const fake = new FakeStdout(200)
      fake.isTTY = true
      const real = Object.getOwnPropertyDescriptor(process, "stdout")
      Object.defineProperty(process, "stdout", {
        value: fake,
        configurable: true,
      })
      const restoreCi = withInteractiveInk()
      restore = () => {
        vi.useRealTimers()
        restoreCi()
        Object.defineProperty(process, "stdout", real)
      }
      //`isTTY` is read once at module load, so the fake is in place BEFORE the fresh import
      vi.resetModules()
      const { liveWatcher } = await import("../lib/render.mjs")
      vi.useFakeTimers()
      const w = liveWatcher({ keys: false })
      w.notice(label, options)
      vi.advanceTimersByTime(80)
      //Every draw begins by wiping from the top of the block; the last one is the screen.
      const drawn = fake.frames.join("").split("\r\x1b[0J").at(-1)
      w.stop()
      restore()
      restore = null
      const text = drawn
        .replace(ANSI, "")
        .replaceAll("\r", "")
        .split("\n")
        .map((l) => l.trimEnd())
      expect(text[0]).toContain(label)
      expect(ink).toEqual(text)
    },
  )
})

describe("the watch block's own breathing room (R64)", () => {
  it("keeps a blank row between the notice and the keys", async () => {
    //It always MEANT to: the blank was `h(Text, null, "")`, which Ink measures as no rows at
    //all, so nothing reached the terminal and the two rows sat flat against each other —
    //`! adaptv source change …` with `r reload js   b rebuild app   ctrl-c stop` right under
    //it. Reported from a screenshot; the assertions here filtered blanks, so nothing caught
    //it. A single space is a row.
    const rows = await screenRaw((w) => w.notice("adaptv source change"))
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain("! adaptv source change")
    expect(rows[1].trim()).toBe("")
    expect(rows[2]).toContain("ctrl-c")
  })

  it("draws no blank at all when there is no notice", async () => {
    const rows = await screenRaw(() => {})
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain("ctrl-c")
  })
})

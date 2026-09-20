import { EventEmitter } from "node:events"
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FRAMES } from "./theme.mjs"

// Ink writes whole frames, so the last frame it wrote IS the screen. That makes these
// assertions about what the dev actually sees.

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

/**
 * A TTY stdin the picker can read keys from — enough of one for Ink's raw mode.
 *
 * Ink drains keys with `read()` on a `readable` event (not a `data` listener), so a fake that
 * only emits `data` looks like a terminal nobody is typing at, and every key test times out.
 */
class FakeStdin extends EventEmitter {
  isTTY = true
  keys = []
  setRawMode() {}
  setEncoding() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
  read() {
    return this.keys.shift() ?? null
  }
  /** Deliver a keypress the way the terminal would. */
  press(seq) {
    this.keys.push(seq)
    this.emit("readable")
  }
}

const ESC = String.fromCharCode(27)
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, "g")
const strip = (s) => s.replace(ANSI, "")

/**
 * Replay the frames into the text a terminal would be showing.
 *
 * "The last frame IS the screen" holds only while something is still being drawn. An ERASE is
 * a frame with no text in it, so `frames.at(-1)` reads empty whether the region went away or
 * is still sitting there — which is exactly how a picker that erased nothing passed a test
 * asserting it was gone. Ink writes `eraseLines(n) + output`, so replaying both is all it
 * takes to ask the honest question: after everything, what is left on screen?
 */
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
    if (rest) lines = lines.concat(strip(rest).split("\n"))
  }
  return lines.join("\n")
}

/**
 * Make a change the screen reacts to, and resolve once React has finished everything it caused,
 * the frame Ink writes included.
 *
 * Ink paints a region's FIRST frame and starts reading keys inside `render()`, so a test needs
 * no wait before either. Every frame after that is painted by a React scheduler task, a
 * macrotask after the keypress or `phase()` that caused it, and a test that reads the screen a
 * fixed time later is betting that task has run by then. A starved worker loses the bet: under
 * a gate at load 25 the picker read its cursor on row 7 of a list that had already moved to
 * row 8, and answered `id-8`. Holding that one scheduler slice back 60ms fails it every time.
 * `act()` runs the queued work itself before it returns, so a test reads a frame without
 * waiting on a clock. Only the stop race below keeps its timers, because those gaps are what
 * it tests.
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

let restore = null
/** Bound by `withFakeStdout`, which imports them fresh with `CI` absent. */
let liveRows = null
let inkSelect = null
afterEach(() => {
  restore?.()
  restore = null
})

async function withFakeStdout(fn, columns = 100) {
  const fake = new FakeStdout(columns)
  const stdin = new FakeStdin()
  const real = Object.getOwnPropertyDescriptor(process, "stdout")
  const realIn = Object.getOwnPropertyDescriptor(process, "stdin")
  Object.defineProperty(process, "stdout", {
    value: fake,
    configurable: true,
  })
  Object.defineProperty(process, "stdin", {
    value: stdin,
    configurable: true,
  })
  const restoreCi = withInteractiveInk()
  restore = () => {
    restoreCi()
    Object.defineProperty(process, "stdout", real)
    Object.defineProperty(process, "stdin", realIn)
  }
  vi.resetModules()
  //module-scoped, because the test bodies call it inside `fn` and the fresh import
  //has to happen in here — after `CI` is gone and the fake stdout is in place
  ;({ liveRows, inkSelect } = await import("./live.mjs"))
  const out = await fn(fake, stdin)
  restore()
  restore = null
  return out
}

describe("the live block", () => {
  it("ERASES itself on stop, so the settled rows replace it", async () => {
    //The regression: Ink deliberately leaves its last frame on screen when it unmounts —
    //correct for a UI that IS the output, wrong for a transient block. `stop()` called
    //unmount before clear, so the spinner rows stayed and the settled rows printed
    //underneath them. Every step appeared twice.
    const fake = await withFakeStdout(async (f) => {
      const b = liveRows(["web", "ios"])
      await settled(() => b.phase("web", "syncing"))
      b.stop()
      return f
    })
    //Whatever the intermediate frames were, nothing may be left on screen.
    const left = screen(fake.frames)
    expect(left).not.toContain("syncing")
    expect(left).not.toContain("web")
    expect(left.trim()).toBe("")
  })

  it("shows no running clock — elapsed belongs to the settled row", async () => {
    //A number ticking in place is motion carrying no new information: the spinner already
    //says "alive", and the total lands on `✓ ios  … · 20.0s` when the row settles.
    const fake = await withFakeStdout(async (f) => {
      const b = liveRows(["ios"])
      await settled(() => b.phase("ios", "compiling"))
      //long enough for a clock to tick: the time IS the premise here, not a wait for a frame
      await new Promise((r) => setTimeout(r, 400))
      const frames = f.frames.map(strip)
      b.stop()
      return { frames }
    })
    const all = fake.frames.join("\n")
    expect(all).toContain("compiling")
    //No `· 1.2s`-shaped metadata anywhere in the live frames.
    expect(all).not.toMatch(/·\s*\d+(\.\d+)?\s*(ms|s)\b/)
  })

  it("keeps one row per label, in the order given", async () => {
    const fake = await withFakeStdout(async (f) => {
      const b = liveRows(["web", "ios", "android"])
      const frame = strip(f.frames.at(-1) ?? "")
      b.stop()
      return { frame }
    })
    const rows = fake.frame.split("\n").filter((l) => l.trim())
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain("web")
    expect(rows[1]).toContain("ios")
    expect(rows[2]).toContain("android")
  })

  it("erases even when the last phase lands just before the stop", async () => {
    //Two updates inside one of Ink's frames leave a paint PENDING, and `unmount()` re-renders
    //— so the pending frame was painted back over the screen the erase had just cleared, and
    //then forgotten. An ordinary sequence: a tool's last line arrives a few ms before its step
    //returns. It leaked 20 runs out of 20 through a pty; see `REGION` in `live.mjs`.
    const fake = await withFakeStdout(async (f) => {
      const b = liveRows(["ios"])
      await new Promise((r) => setTimeout(r, 120))
      b.phase("ios", "packaging")
      await new Promise((r) => setTimeout(r, 5))
      b.phase("ios", "linking")
      await new Promise((r) => setTimeout(r, 5))
      b.stop()
      return f
    })
    expect(screen(fake.frames).trim()).toBe("")
  })

  it("updates a row in place rather than adding one", async () => {
    const fake = await withFakeStdout(async (f) => {
      const b = liveRows(["ios"])
      await settled(() => b.phase("ios", "syncing"))
      await settled(() => b.phase("ios", "compiling"))
      const frame = strip(f.frames.at(-1) ?? "")
      b.stop()
      return { frame }
    })
    const rows = fake.frame.split("\n").filter((l) => l.trim())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain("compiling")
    expect(rows[0]).not.toContain("syncing")
  })
})

/*
 * A phase row is ONE physical line at any width (R10, R44), and what yields on a narrow terminal
 * is the phase's TAIL. The spinner and the label used to be `Text`s Yoga was free to shrink, so a
 * real phase at 40 columns took the spinner off the front of the row, and at 30 the label wrapped
 * inside its own sliver and the block grew rows:
 *
 *        android  reading the published mani…
 *
 * Every expected row is derived from the same block drawn at 200 columns.
 */
describe("a phase row holds ONE line on a narrow terminal (R10, R44)", () => {
  //the spinner advances on its own clock, so two renders may catch different frames of it
  const SPIN = new RegExp(`^( {2})[${FRAMES.join("")}] `)
  const still = (row) => row.replace(SPIN, "$1* ")
  const LANES = {
    web: "starting server",
    ios: "processing resources",
    //the longest phase adaptv chooses for itself (`OWN_PHASES`), on the longest label
    android: "reading the published manifest",
  }

  /** Mount the lanes at `columns`, set every phase, and return the painted rows. */
  const paint = (columns) =>
    withFakeStdout(async (f) => {
      const b = liveRows(Object.keys(LANES))
      try {
        await settled(() => {
          for (const [label, phase] of Object.entries(LANES))
            b.phase(label, phase)
        })
        return strip(f.frames.at(-1) ?? "")
          .split("\n")
          .map((l) => l.trimEnd())
          .slice(0, -1)
      } finally {
        b.stop()
      }
    }, columns)

  it.each([40, 30, 80])(
    "keeps the spinner and the label, and clips the phase, at %i columns",
    async (columns) => {
      const rows = await paint(columns)
      const full = await paint(200)
      expect(full.map(still)).toEqual(
        Object.entries(LANES).map(([l, p]) => `  * ${l}  ${p}`),
      )
      //the premise, at the narrow widths: the android row does not fit, or nothing yielded here
      if (columns < 80) expect(full[2].length).toBeGreaterThan(columns)
      //one row per lane: a wrapped label makes the block taller
      expect(rows).toHaveLength(3)
      rows.forEach((row, i) => {
        expect(row.length).toBeLessThanOrEqual(columns)
        expect(row).toMatch(SPIN)
        const want =
          full[i].length > columns
            ? `${still(full[i]).slice(0, columns - 1)}…`
            : still(full[i])
        expect(still(row)).toBe(want)
      })
    },
  )
})

describe("the device picker", () => {
  it("ERASES itself once it is answered, leaving no question on screen", async () => {
    //The regression: the picker answered itself with Ink's `exit()`, which unmounts — and
    //Ink's unmount forgets the frame it just left behind, so the erase that followed erased
    //nothing. Both device pickers and their hints stayed above the running lanes:
    //
    //  Choose a ios device / … / ↑↓ move · ↵ select · esc cancel
    //  Choose a android device / … / ↑↓ move · ↵ select · esc cancel
    //  ⠏ ios  linking plugins
    const out = await withFakeStdout(async (f, stdin) => {
      const answer = inkSelect("Choose a ios device", [
        { value: "sim-a", label: "iPhone 16 Pro" },
        { value: "sim-b", label: "iPhone 16 Plus" },
      ])
      await settled(() => stdin.press(`${ESC}[B`)) // ↓
      stdin.press("\r") // ↵
      return { chosen: await answer, frames: f.frames }
    })
    expect(out.chosen).toBe("sim-b")
    const left = screen(out.frames)
    expect(left).not.toContain("Choose a ios device")
    expect(left).not.toContain("iPhone 16")
    expect(left).not.toContain("select")
    expect(left.trim()).toBe("")
  })

  it("draws the hint, which is all that separates two identical device names", async () => {
    //R60. With two iOS runtimes installed the list is pairs of exact duplicates — the same
    //`iPhone 16 Pro (simulator)` on 18.0 and on 26.1 — so choosing was a coin toss. `select`
    //always accepted a `hint` and `devices.mjs` always passed one; the picker never drew it.
    const out = await withFakeStdout(async (f, stdin) => {
      const answer = inkSelect("Choose a ios device", [
        {
          value: "sim-18",
          label: "iPhone 16 Pro (simulator)",
          hint: "iOS 18.0",
        },
        {
          value: "sim-26",
          label: "iPhone 16 Pro (simulator)",
          hint: "iOS 26.1",
        },
        { value: "phone", label: "Andre's iPhone" },
      ])
      //the frame WHILE the question is up — after the answer it is erased on purpose
      const asked = screen(f.frames)
      stdin.press("\r")
      return { asked, chosen: await answer }
    })
    expect(out.chosen).toBe("sim-18")
    expect(out.asked).toContain("iOS 18.0")
    expect(out.asked).toContain("iOS 26.1")
    //a device with nothing to disambiguate it gets no hint, not a filler one
    expect(out.asked).toContain("Andre's iPhone")
    expect(out.asked).not.toMatch(/Andre's iPhone\s+·/)
  })

  it("returns null when the picker is cancelled, and still erases", async () => {
    const out = await withFakeStdout(async (f, stdin) => {
      const answer = inkSelect("Choose a ios device", [
        { value: "sim-a", label: "iPhone 16 Pro" },
      ])
      stdin.press(ESC) // esc
      return { chosen: await answer, frames: f.frames }
    })
    expect(out.chosen).toBe(null)
    expect(screen(out.frames).trim()).toBe("")
  })
})

describe("hintColumn — a list's right-hand side lines up (R65)", () => {
  const col = async () => (await import("./live.mjs")).hintColumn

  it("pads every label to the longest, so the hints share a column", async () => {
    const hintColumn = await col()
    expect(
      hintColumn(
        [
          { label: "iPad (A16) (simulator)", hint: "iOS 26.1" },
          { label: "iPad Air 11-inch (M2) (simulator)", hint: "iOS 18.0" },
        ],
        100,
      ),
    ).toBe("iPad Air 11-inch (M2) (simulator)".length)
  })

  it("pads nothing when no row has a hint", async () => {
    //`confirm()` is a two-option `select` — padding it would trail invisible spaces after
    //`replace them` for no reason at all.
    const hintColumn = await col()
    expect(
      hintColumn([{ label: "replace them" }, { label: "cancel" }], 100),
    ).toBe(0)
  })

  it("gives up and goes ragged rather than wrapping a row", async () => {
    //A wrapped picker row costs the window a line, and the block stops being six rows tall.
    const hintColumn = await col()
    const wide = [
      { label: "x".repeat(70), hint: "iOS 26.1" },
      { label: "y", hint: "iOS 18.0" },
    ]
    //2 indent + 2 cursor + 70 label + 4 separator + 8 hint = 86 columns
    expect(hintColumn(wide, 80)).toBe(0)
    expect(hintColumn(wide, 86)).toBe(70)
  })
})

describe("scrollTo — where the six-row window sits", () => {
  //Pure arithmetic, so it is imported directly rather than through the fake-stdout harness;
  //nothing in it touches Ink, stdout or the CI gate.
  const pure = async () => (await import("./live.mjs")).scrollTo

  it("holds still while the cursor moves inside it", async () => {
    const scrollTo = await pure()
    //The point of a sticky window: rows the dev is reading do not move under them.
    expect(scrollTo(0, 0, 20, 6)).toBe(0)
    expect(scrollTo(3, 0, 20, 6)).toBe(0)
    expect(scrollTo(5, 0, 20, 6)).toBe(0)
  })

  it("follows only once the cursor would leave it", async () => {
    const scrollTo = await pure()
    expect(scrollTo(6, 0, 20, 6)).toBe(1)
    expect(scrollTo(7, 1, 20, 6)).toBe(2)
  })

  it("follows upward the same way", async () => {
    const scrollTo = await pure()
    expect(scrollTo(4, 5, 20, 6)).toBe(4)
    expect(scrollTo(9, 5, 20, 6)).toBe(5)
  })

  it("snaps to the far end when the cursor wraps", async () => {
    const scrollTo = await pure()
    //`↓` off the last row is index 0, `↑` off the first is the last one.
    expect(scrollTo(0, 14, 20, 6)).toBe(0)
    expect(scrollTo(19, 0, 20, 6)).toBe(14)
  })

  it("never scrolls a list that fits", async () => {
    const scrollTo = await pure()
    expect(scrollTo(0, 0, 6, 6)).toBe(0)
    expect(scrollTo(3, 0, 4, 6)).toBe(0)
  })

  it("clamps a start that no longer fits the list", async () => {
    const scrollTo = await pure()
    expect(scrollTo(2, 99, 20, 6)).toBe(2)
    expect(scrollTo(19, -5, 20, 6)).toBe(14)
  })
})

/** 14 simulators, the shape of a machine with two runtimes installed. */
const MANY = Array.from({ length: 14 }, (_, i) => ({
  value: `id-${i}`,
  label: `device ${i} (simulator)`,
  hint: i < 8 ? "iOS 18.0" : "iOS 26.1",
}))

describe("the picker's window (R63)", () => {
  it("shows six rows and counts what is hidden, instead of the whole list", async () => {
    const out = await withFakeStdout(async (f, stdin) => {
      const answer = inkSelect("Choose a ios device", MANY)
      const asked = screen(f.frames)
      stdin.press("\r")
      await answer
      return asked
    })
    //the question is still on screen, which a 14-row block is what took away
    expect(out).toContain("Choose a ios device")
    expect(out).toContain("device 0 (simulator)")
    expect(out).toContain("device 5 (simulator)")
    expect(out).not.toContain("device 6 (simulator)")
    expect(out).not.toContain("device 13 (simulator)")
    //nothing above the first row, eight below it
    expect(out).toContain("8 more")
    //the marker line is BLANK rather than absent, so the rows do not jump a line when the
    //dev scrolls past either end. `↑` still appears in the key hint below the list.
    expect(out).not.toMatch(/↑ \d+ more/)
  })

  it("scrolls the window under the cursor and re-counts both ends", async () => {
    const out = await withFakeStdout(async (f, stdin) => {
      const answer = inkSelect("Choose a ios device", MANY)
      for (let i = 0; i < 8; i++)
        await settled(() => stdin.press(`${ESC}[B`))
      const asked = screen(f.frames)
      stdin.press("\r")
      return { asked, chosen: await answer }
    })
    expect(out.chosen).toBe("id-8")
    //cursor on row 8 → window holds 3..8
    expect(out.asked).toContain("device 8 (simulator)")
    expect(out.asked).not.toContain("device 2 (simulator)")
    expect(out.asked).not.toContain("device 9 (simulator)")
    expect(out.asked).toContain("3 more")
    expect(out.asked).toContain("5 more")
  })

  it("leaves a short list exactly as it was — no window, no counts", async () => {
    //`confirm()` is a two-option `select`, so a marker line here would put a blank row
    //under every yes/no adaptv asks.
    const out = await withFakeStdout(async (f, stdin) => {
      const answer = inkSelect("Choose a ios device", MANY.slice(0, 3))
      const asked = screen(f.frames)
      stdin.press("\r")
      await answer
      return asked
    })
    expect(out).toContain("device 2 (simulator)")
    expect(out).not.toContain("more")
  })
})

describe("the picker sits on the body grid (R65)", () => {
  it("puts the cursor in the glyph column and the label where labels go", async () => {
    const out = await withFakeStdout(async (f, stdin) => {
      const answer = inkSelect("which ios device?", [
        {
          value: "a",
          label: "iPhone 16 Pro (simulator)",
          hint: "iOS 18.0",
        },
        {
          value: "b",
          label: "iPhone 17 Pro (simulator)",
          hint: "iOS 26.1",
        },
      ])
      const asked = screen(f.frames)
      stdin.press("\r")
      await answer
      return asked
    })
    const rows = out.split("\n")
    //`  › label` and `    label` — the same columns `  ✓ web` uses for its glyph and label.
    expect(rows).toContain("  › iPhone 16 Pro (simulator)  · iOS 18.0")
    expect(rows).toContain("    iPhone 17 Pro (simulator)  · iOS 26.1")
  })

  it("draws the keys the way the watch block draws them", async () => {
    const out = await withFakeStdout(async (f, stdin) => {
      const answer = inkSelect("which ios device?", [
        { value: "a", label: "iPhone 16 Pro" },
      ])
      const asked = screen(f.frames)
      stdin.press("\r")
      await answer
      return asked
    })
    //three spaces between offers, not a `·` — same shape as `r reload js   b rebuild app`
    expect(out).toContain("↑↓ move   ↵ select   esc cancel")
  })
})

/*
 * Every row of the picker holds ONE line on a narrow terminal (R10, R44). A picker row that wraps
 * costs the window a line, so the block stops being the height `WINDOW` promises and the list
 * jumps under the cursor. Every row was a paragraph that Ink wrapped, and at 40 columns:
 *
 *       › iPhone 16 Pro Max (simulator)  · iOS
 *        26.1
 *
 * What yields is the label's TAIL: the cursor and the hint stay whole, because with two runtimes
 * installed the hint is the only thing telling a pair of rows apart. The keys row gives up whole
 * offers from the right, `esc cancel` first. Every expected row is derived from the same picker
 * drawn at 200 columns.
 */
describe("every row of the picker holds ONE line on a narrow terminal (R10, R44)", () => {
  const DOWN = `${ESC}[B`
  /** Two runtimes, so every name is listed twice: the hint is all that tells a pair apart. */
  const PAIRS = [
    "iPhone 17 Pro Max (simulator)",
    "iPad Pro 13-inch (M5) (simulator)",
    "iPad Air 11-inch (M3) (simulator)",
    "iPhone Air (simulator)",
    "iPad mini (A17 Pro) (simulator)",
    "iPhone 16e (simulator)",
    "iPad (A16) (simulator)",
  ].flatMap((label, i) => [
    { value: `${i}-26`, label, hint: "iOS 26.1" },
    { value: `${i}-18`, label, hint: "iOS 18.6" },
  ])

  /** Mount the picker at `columns`, press ↓ `downs` times, and return the painted rows. */
  const paint = (message, options, columns, downs = 0) =>
    withFakeStdout(async (f, stdin) => {
      let answer
      await settled(() => {
        answer = inkSelect(message, options)
      })
      try {
        for (let i = 0; i < downs; i++)
          await settled(() => stdin.press(DOWN))
        return strip(f.frames.at(-1) ?? "")
          .split("\n")
          .map((l) => l.trimEnd())
          .slice(0, -1)
      } finally {
        stdin.press("\r")
        await answer
      }
    }, columns)

  /** Ink's clip of a prose row: the head, marked with `…` in the last column. */
  const clipped = (full, columns) =>
    full.length > columns ? `${full.slice(0, columns - 1)}…` : full
  /**
   * A device row as it must read at `columns`: the cursor and the whole hint, and the label
   * clipped to what is left. Narrow, nothing is padded (`hintColumn` gives 0 when the aligned row
   * does not fit), so the 200-column row loses its padding first.
   */
  const device = (full, columns) => {
    const at = full.lastIndexOf("  · ")
    const head = (at < 0 ? full : full.slice(0, at)).trimEnd()
    const hint = at < 0 ? "" : full.slice(at)
    if (head.length + hint.length <= columns) return head + hint
    return `${head.slice(0, columns - hint.length - 1)}…${hint}`
  }

  it.each([40, 30])(
    "keeps the block's height, the cursor and every hint at %i columns",
    async (columns) => {
      //seven presses: the cursor on row 7, the window on rows 2..7, counts at both ends
      const rows = await paint("which ios device?", PAIRS, columns, 7)
      const full = await paint("which ios device?", PAIRS, 200, 7)
      expect(full[0]).toBe("  which ios device?")
      expect(full[1]).toBe("    ↑ 2 more")
      expect(full.at(-2)).toBe("    ↓ 6 more")
      //the premise: every device row is wider than the terminal, or nothing yielded here
      for (const row of full.slice(2, 8))
        expect(row.length).toBeGreaterThan(columns)
      //message + both markers + the window + keys: a wrapped row makes this taller
      expect(rows).toHaveLength(1 + 2 + 6 + 1)
      for (const row of rows)
        expect(row.length).toBeLessThanOrEqual(columns)
      expect(rows[0]).toBe(clipped(full[0], columns))
      expect(rows[1]).toBe(clipped(full[1], columns))
      expect(rows[8]).toBe(clipped(full[8], columns))
      const devices = rows.slice(2, 8)
      devices.forEach((row, i) => {
        expect(row).toBe(device(full[2 + i], columns))
        expect(row).toMatch(/ {2}· iOS (26\.1|18\.6)$/)
      })
      //the cursor is on row 7, the sixth row of the window, and on no other
      expect(devices[5].startsWith("  › iPhone Air")).toBe(true)
      expect(devices.filter((r) => r.includes("›"))).toHaveLength(1)
      //and the pairs are still pairs: no two rows on screen read the same
      expect(new Set(devices).size).toBe(devices.length)
    },
  )

  it.each([40, 30])(
    "clips the question and drops whole keys from the right at %i columns",
    async (columns) => {
      const message =
        "replace the 11 icons adaptv generated in public/icons?"
      const options = [
        { value: true, label: "replace them" },
        { value: false, label: "cancel" },
      ]
      const rows = await paint(message, options, columns, 1)
      const full = await paint(message, options, 200, 1)
      expect(full).toEqual([
        `  ${message}`,
        "    replace them",
        "  › cancel",
        "  ↑↓ move   ↵ select   esc cancel",
      ])
      //the premise: the question does not fit, and at 30 neither do the keys
      expect(full[0].length).toBeGreaterThan(columns)
      if (columns === 30) expect(full[3].length).toBeGreaterThan(columns)
      //no window, so no markers: message + two rows + keys
      expect(rows).toHaveLength(4)
      for (const row of rows)
        expect(row.length).toBeLessThanOrEqual(columns)
      expect(rows[0]).toBe(clipped(full[0], columns))
      expect(rows[1]).toBe(full[1])
      expect(rows[2]).toBe(full[2])
      //as many whole offers as the row has room for, from the left
      const offers = full[3].trim().split("   ")
      let want = full[3]
      for (let n = offers.length; n > 0; n--) {
        want = `  ${offers.slice(0, n).join("   ")}`
        if (want.length <= columns) break
      }
      expect(rows[3]).toBe(want)
      for (const shown of rows[3].trim().split("   "))
        expect(offers).toContain(shown)
      //nobody can answer without these two, and `q` and ctrl-c still cancel
      expect(rows[3]).toContain("↑↓ move   ↵ select")
      if (columns === 30) expect(rows[3]).not.toContain("esc")
    },
  )

  it("clips a scroll marker that outgrows a very narrow terminal", async () => {
    //120 rows: `  ↓ 114 more` is 12 columns, and the indent makes it 14
    const options = Array.from({ length: 120 }, (_, i) => ({
      value: i,
      label: `device ${i}`,
    }))
    const rows = await paint("pick", options, 12)
    const full = await paint("pick", options, 200)
    expect(full[8]).toBe("    ↓ 114 more")
    expect(rows).toHaveLength(1 + 2 + 6 + 1)
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(12)
    expect(rows[8]).toBe(clipped(full[8], 12))
  })

  it("re-fits its rows when the terminal is resized, with no keypress", async () => {
    //The hint column is chosen for the width the picker was DRAWN at, and Ink's own resize
    //only re-lays the old rows out. Mounted at 60 (padded) and narrowed to 42 (too narrow to
    //pad), a label that fits came out whole and marked cut, `iPad (A16) (simulator)   …  · iOS
    //18.0`, and widening again left the rows ragged until the dev pressed a key.
    const options = [
      {
        value: "a",
        label: "iPhone 16 Pro Max (simulator)",
        hint: "iOS 26.1",
      },
      { value: "b", label: "iPad (A16) (simulator)", hint: "iOS 18.0" },
      { value: "c", label: "iPhone 16e (simulator)", hint: "iOS 26.1" },
    ]
    const read = (f) =>
      strip(f.frames.at(-1) ?? "")
        .split("\n")
        .map((l) => l.trimEnd())
        .slice(0, -1)
    const [wide, narrowed, widened] = await withFakeStdout(
      async (f, stdin) => {
        let answer
        await settled(() => {
          answer = inkSelect("which ios device?", options)
        })
        try {
          const wide = read(f)
          f.columns = 42
          await settled(() => f.emit("resize"))
          const narrowed = read(f)
          f.columns = 60
          await settled(() => f.emit("resize"))
          return [wide, narrowed, read(f)]
        } finally {
          stdin.press("\r")
          await answer
        }
      },
      60,
    )
    //the premise: at 60 the hints line up, so the shorter labels carry padding
    expect(wide[2]).toBe("    iPad (A16) (simulator)         · iOS 18.0")
    //narrowed, the picker reads exactly as one drawn at 42 in the first place
    expect(narrowed).toEqual(await paint("which ios device?", options, 42))
    expect(narrowed[2]).toBe("    iPad (A16) (simulator)  · iOS 18.0")
    expect(narrowed[3]).toBe("    iPhone 16e (simulator)  · iOS 26.1")
    //only the label that does not fit is marked cut
    expect(narrowed.filter((r) => r.includes("…"))).toEqual([
      "  › iPhone 16 Pro Max (simula…  · iOS 26.1",
    ])
    //and widened, it lines up again
    expect(widened).toEqual(wide)
  })
})

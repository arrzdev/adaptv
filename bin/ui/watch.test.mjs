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
  return (
    last
      .replace(ANSI, "")
      .split("\n")
      .map((l) => l.trimEnd())
      //a trailing "" is the frame's own closing newline, not a row the block drew
      .slice(0, -1)
  )
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

/**
 * A terminal's stdin, down to the one property this bug lives in: the LINE DISCIPLINE.
 *
 * In raw mode a keypress is a byte the process reads at once. In cooked mode the terminal
 * echoes it and holds it for a newline that a dev pressing `q` never types, so it is never a
 * key at all. A fake whose `setRawMode` is a no-op cannot see that, so this one keeps what
 * cooked mode swallowed in `echoed`.
 *
 * Both of Node's reading styles are modelled, because both have been in play: `onKeys` listens
 * for `data`, and Ink drains `read()` on `readable` (a `read()` also emits `data`, as Node's
 * does).
 */
class TerminalStdin extends EventEmitter {
  isTTY = true
  isRaw = false
  flowing = false
  echoed = ""
  queued = []
  setRawMode(on) {
    this.isRaw = on
    return this
  }
  setEncoding() {
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
  ref() {}
  unref() {}
  read() {
    const chunk = this.queued.shift() ?? null
    if (chunk !== null) this.emit("data", chunk)
    return chunk
  }
  /** A keypress, as the terminal delivers it in whichever mode it is in right now. */
  type(key) {
    if (!this.isRaw) {
      this.echoed += key
      return
    }
    if (this.listenerCount("readable") > 0) {
      this.queued.push(key)
      this.emit("readable")
    } else if (this.flowing) this.emit("data", key)
  }
}

describe("the session's keys outlive the watch block", () => {
  //`r` and `b` take the watch block DOWN for as long as they run (the rewind needs its rows
  //back), and the block's own `useInput` was the only key listener a native `dev` had. So for
  //the whole relaunch the terminal sat in cooked mode with nobody reading it:
  //
  //    1789315629.764 KEY r
  //    1789315630.093 KEY q
  //    1789315630.093 out: 'q'
  //    1789315630.190 out: '  ✓ ios  night-a-ios26 (simulator) · reloaded · 426ms'
  //    1789315630.192 out: '  r reload js   b rebuild app   ctrl-c stop'
  //    ... nothing for 601 s, until a manual SIGINT
  //
  //The listener belongs to the SESSION, and the block only draws the keys row.
  it.each([
    ["q", "q"],
    ["ctrl-c", String.fromCharCode(3)],
  ])(
    "%s pressed while a reload has the block down still quits",
    async (_, key) => {
      const fake = new FakeStdout(100)
      const stdin = new TerminalStdin()
      const realOut = Object.getOwnPropertyDescriptor(process, "stdout")
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
      let dispose = () => {}
      restore = () => {
        dispose()
        restoreCi()
        Object.defineProperty(process, "stdout", realOut)
        Object.defineProperty(process, "stdin", realIn)
      }
      vi.resetModules()
      const { inkWatcher } = await import("./watch.mjs")
      const { onKeys } = await import("../lib/render.mjs")

      //The order `dev` uses: the block goes up, then the session starts listening.
      let w = inkWatcher({ keys: true })
      await settled(fake)
      const onQuit = vi.fn()
      let reloadDone = () => {}
      const onReload = vi.fn(() => {
        //What `reload()` does first; then it waits on the device.
        w.stop()
        return new Promise((r) => {
          reloadDone = r
        })
      })
      dispose = onKeys({ onReload, onRebuild: vi.fn(), onQuit })

      stdin.type("r")
      expect(onReload).toHaveBeenCalledTimes(1)
      await settled(fake)

      //Mid-reload: the block is gone and the device is still relaunching.
      stdin.type(key)
      expect(stdin.echoed).toBe("")
      expect(onQuit).toHaveBeenCalledTimes(1)

      //When the block comes back it is not a second reader: one key, one quit.
      reloadDone()
      w = inkWatcher({ keys: true })
      await settled(fake)
      stdin.type(key)
      expect(onQuit).toHaveBeenCalledTimes(2)
      expect(stdin.echoed).toBe("")
      w.stop()
    },
  )
})

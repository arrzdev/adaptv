import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"

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

async function withFakeStdout(fn) {
  const fake = new FakeStdout()
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
      b.phase("web", "syncing")
      await new Promise((r) => setTimeout(r, 120))
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
      b.phase("ios", "compiling")
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
      await new Promise((r) => setTimeout(r, 120))
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
      b.phase("ios", "syncing")
      await new Promise((r) => setTimeout(r, 120))
      b.phase("ios", "compiling")
      await new Promise((r) => setTimeout(r, 120))
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
      await new Promise((r) => setTimeout(r, 120))
      stdin.press(`${ESC}[B`) // ↓
      await new Promise((r) => setTimeout(r, 120))
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

  it("returns null when the picker is cancelled, and still erases", async () => {
    const out = await withFakeStdout(async (f, stdin) => {
      const answer = inkSelect("Choose a ios device", [
        { value: "sim-a", label: "iPhone 16 Pro" },
      ])
      await new Promise((r) => setTimeout(r, 120))
      stdin.press(ESC) // esc
      return { chosen: await answer, frames: f.frames }
    })
    expect(out.chosen).toBe(null)
    expect(screen(out.frames).trim()).toBe("")
  })
})

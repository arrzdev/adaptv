import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it } from "vitest"
import { liveRows } from "./live.mjs"

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

const ANSI = new RegExp(
  `${String.fromCharCode(27)}\\[[0-9;?]*[a-zA-Z]`,
  "g",
)
const strip = (s) => s.replace(ANSI, "")

let restore = null
afterEach(() => {
  restore?.()
  restore = null
})

async function withFakeStdout(fn) {
  const fake = new FakeStdout()
  const real = Object.getOwnPropertyDescriptor(process, "stdout")
  Object.defineProperty(process, "stdout", {
    value: fake,
    configurable: true,
  })
  restore = () => Object.defineProperty(process, "stdout", real)
  const out = await fn(fake)
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
    //Whatever the intermediate frames were, the LAST thing written must not leave a row.
    const final = strip(fake.frames.at(-1) ?? "")
    expect(final).not.toContain("syncing")
    expect(final).not.toContain("web")
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

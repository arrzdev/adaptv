// @vitest-environment node
import { EventEmitter } from "node:events"
import { afterEach, describe, expect, it, vi } from "vitest"

// What a `dev web` session leaves on screen once it has ended.
//
// The watch row is transient (R41): it is erased as a whole when the session stops, so the
// terminal is not left advertising `ctrl-c stop` to a process that no longer exists. `dev`'s
// quit breathes BEFORE it tears down — `onSigint` is `spacer()`, then `teardown()`, whose first
// act is `watcher.stop()` — and the string watcher parks its cursor at the top of its row. So
// the spacer's newline stepped the cursor OFF the row, the erase cleared the blank line under
// it, and the last frame of every `q` and ctrl-c was:
//
//     ✓ web  · 1.1s
//       local  http://localhost:43160
//
//     ctrl-c stop
//
// The Ink block `dev ios` mounts never had this: its frames do not pass through the engine's
// memory of the last bytes written, so that same spacer found a blank line already there and
// wrote nothing. These replay the bytes into a screen and assert on what is LEFT.

class FakeStdout extends EventEmitter {
  constructor(columns = 100) {
    super()
    this.columns = columns
    this.rows = 30
    this.isTTY = true
    this.bytes = ""
  }
  write(s) {
    this.bytes += s
    return true
  }
}

const ESC = String.fromCharCode(27)

/**
 * Replay what was written into the rows a terminal would show, and where its cursor ended.
 * Only what the string watcher and the static rows emit: CR, LF, `CSI n A`, `CSI 0 J`,
 * `CSI 2K`; colour is dropped.
 */
function replay(bytes) {
  const rows = [""]
  let row = 0
  let col = 0
  const csi = new RegExp(`^${ESC}\\[([0-9;?]*)([A-Za-z])`)
  for (let i = 0; i < bytes.length; ) {
    const m = bytes.slice(i).match(csi)
    if (m) {
      const n = Number(m[1]) || 1
      if (m[2] === "A") row = Math.max(0, row - n)
      else if (m[2] === "J") {
        rows[row] = rows[row].slice(0, col)
        rows.length = row + 1
      } else if (m[2] === "K" && m[1] === "2") rows[row] = ""
      i += m[0].length
      continue
    }
    const ch = bytes[i++]
    if (ch === "\r") col = 0
    else if (ch === "\n") {
      row++
      col = 0
      while (rows.length <= row) rows.push("")
    } else {
      rows[row] =
        rows[row].padEnd(col).slice(0, col) + ch + rows[row].slice(col + 1)
      col++
    }
  }
  return { rows: rows.map((r) => r.trimEnd()), row }
}

let restore = null
afterEach(() => {
  restore?.()
  restore = null
  vi.useRealTimers()
})

/** Import `render.mjs` fresh against a fake TTY (`isTTY` is read once, at module load). */
async function withLiveStdout(fn) {
  const fake = new FakeStdout()
  const real = Object.getOwnPropertyDescriptor(process, "stdout")
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
  try {
    await fn(render)
  } finally {
    restore()
    restore = null
  }
  return fake.bytes
}

/** `dev web` up to its watch row: the banner, the address block, the spacer, the watcher. */
function session({ header, addresses, spacer, liveWatcher }) {
  header("dev web")
  addresses({ local: "http://localhost:43160", network: "" })
  spacer()
  return liveWatcher({ keys: false })
}

/** One tick of the watcher's redraw clock. */
const FRAME = 80

/** Where the screen ends: the rows after `last`, and where the shell's prompt will land. */
function endsOn(bytes, last) {
  const { rows, row } = replay(bytes)
  const at = rows.findLastIndex((r) => r.includes(last))
  return { at, rows, row, text: rows.join("\n") }
}

describe("a dev session that ends leaves no keys row behind", () => {
  it("erases the row when the quit breathes before it tears down", async () => {
    //`onSigint`'s order, byte for byte: `spacer()`, then `teardown()` → `watcher.stop()`.
    const bytes = await withLiveStdout(async (render) => {
      const w = session(render)
      render.spacer()
      w.stop()
    })
    const { rows } = replay(bytes)
    expect(rows.join("\n")).toContain("http://localhost:43160")
    expect(rows.join("\n")).not.toContain("ctrl-c")
  })

  it("erases a notice with it, the whole block at once", async () => {
    const bytes = await withLiveStdout(async (render) => {
      vi.useFakeTimers()
      const w = session(render)
      w.notice("config change")
      //one frame, so the three-row block is what is on screen when the quit lands
      vi.advanceTimersByTime(FRAME)
      render.spacer()
      w.stop()
    })
    const text = replay(bytes).rows.join("\n")
    expect(text).not.toContain("config change")
    expect(text).not.toContain("ctrl-c")
  })

  it("hands the shell the row the block started on, the way the Ink block does", async () => {
    //One blank line under the address, then the prompt — not two. The block was opened after a
    //spacer, so a spacer after it is gone has nothing to add.
    const bytes = await withLiveStdout(async (render) => {
      const w = session(render)
      render.spacer()
      w.stop()
      render.spacer()
    })
    const { rows, row } = replay(bytes)
    const address = rows.findIndex((r) =>
      r.includes("http://localhost:43160"),
    )
    expect(rows[address + 1]).toBe("")
    expect(row).toBe(address + 2)
  })
})

describe("a line printed while the watch row is up", () => {
  //The row is not the only thing on screen for a whole session: `dev web --verbose` prints every
  //dev-server line under it (`detail("vite │ …")`), and a notice can arrive at any time. Each one
  //is written where the row is parked and the next frame redraws the row beneath it. Whatever
  //was written last is what the quit's spacer has to see — not what was there when the row
  //first opened, which put the prompt flat against the last `vite │` line.

  it("ends a verbose session on that line and one blank row", async () => {
    const bytes = await withLiveStdout(async (render) => {
      vi.useFakeTimers()
      const w = session(render)
      render.detail("vite │ page reload src/a.tsx")
      vi.advanceTimersByTime(FRAME)
      render.spacer()
      w.stop()
    })
    const { at, rows, row, text } = endsOn(bytes, "vite │ page reload")
    expect(text).not.toContain("ctrl-c")
    expect(rows[at + 1]).toBe("")
    expect(row).toBe(at + 2)
    expect(rows.slice(at + 2).join("")).toBe("")
  })

  it("ends on a notice printed while live, and one blank row", async () => {
    const bytes = await withLiveStdout(async (render) => {
      vi.useFakeTimers()
      const w = session(render)
      render.log.warn("something")
      vi.advanceTimersByTime(FRAME)
      render.spacer()
      w.stop()
    })
    const { at, rows, row, text } = endsOn(bytes, "! something")
    expect(text).not.toContain("ctrl-c")
    expect(rows[at + 1]).toBe("")
    expect(row).toBe(at + 2)
  })

  it("keeps the blank a closed group asks for, and no copy of the row", async () => {
    //A `vite │` detail leaves its group open, so the notice after it opens with a spacer (R64).
    //That spacer lands while the row is parked: it must step over a CLEARED row, or the row it
    //stepped over stays on screen for good, above everything the next frame draws.
    const bytes = await withLiveStdout(async (render) => {
      vi.useFakeTimers()
      const w = session(render)
      render.detail("vite │ page reload src/a.tsx")
      vi.advanceTimersByTime(FRAME)
      render.log.warn("something")
      vi.advanceTimersByTime(FRAME)
      render.spacer()
      w.stop()
    })
    const { rows, row, text } = endsOn(bytes, "! something")
    const vite = rows.findIndex((r) => r.includes("vite │"))
    expect(text).not.toContain("ctrl-c")
    expect(rows[vite + 1]).toBe("")
    expect(rows[vite + 2]).toContain("! something")
    expect(rows[vite + 3]).toBe("")
    expect(row).toBe(vite + 4)
  })
})

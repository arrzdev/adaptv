import { afterEach, describe, expect, it, vi } from "vitest"
import {
  check,
  fail,
  flushNotices,
  header,
  nextPhase,
  prettyLine,
  skip,
  spacer,
} from "./render.mjs"

//Built rather than written as a literal: a raw ESC inside a regex trips
//lint/suspicious/noControlCharactersInRegex.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")

/** Capture what the CLI actually wrote, minus colour. */
function captureOut(fn) {
  const lines = []
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((s) => {
    lines.push(String(s).replace(ANSI, "").trimEnd())
    return true
  })
  try {
    fn()
  } finally {
    spy.mockRestore()
  }
  return lines
}

/** The notices themselves, without the blank line that closes the block. */
const said = (lines) => lines.filter(Boolean)

afterEach(() => vi.restoreAllMocks())

describe("flushNotices — severity and repetition", () => {
  it("gives every notice the `!` — there is no glyphless severity", () => {
    //R5: a line the CLI meant to say carries the mark. A notice with no glyph read as
    //stray output and left the dev deciding whether an unmarked sentence was a problem;
    //anything that doesn't earn a `!` isn't printed at all (R4).
    const out = captureOut(() =>
      flushNotices([
        "ios launcher icon upscaled from 512px — add a 1024px icon",
        {
          note: "no icons in ./public/favicons — add one to brand the launcher icon",
        },
      ]),
    )
    expect(out[0]).toContain("!")
    expect(out[1]).toContain("!")
    expect(out[1]).toContain("no icons in ./public/favicons")
  })

  it("prints an app-level fact once, not once per platform", () => {
    //Regression: asset config is discovered per platform, so `build all` printed the
    //same sentence twice — reading as two separate problems when it is one.
    const same = {
      note: "no icons in ./public/favicons — add one to brand the launcher icon",
    }
    const out = captureOut(() => flushNotices([{ ...same }, { ...same }]))
    expect(said(out)).toHaveLength(1)
  })

  it("dedupes warnings and notes independently of each other", () => {
    const out = captureOut(() =>
      flushNotices([
        "same text",
        "same text",
        { note: "other" },
        { note: "other" },
      ]),
    )
    expect(said(out)).toHaveLength(2)
  })

  it("empties the list so a later flush cannot reprint it", () => {
    //Notices surface next to the step that produced them; a second flush at the end
    //of the run must not repeat them.
    const notices = [{ note: "a" }, "b"]
    captureOut(() => flushNotices(notices))
    expect(notices).toHaveLength(0)
    expect(captureOut(() => flushNotices(notices))).toHaveLength(0)
  })

  it("closes the notices with a blank line, and says nothing when there are none", () => {
    //R33: the `!`s are a BLOCK between the banner and the first step, not loose lines
    //leaning against the run. A flush with nothing to say prints nothing at all —
    //including the gap, which would otherwise push every step down a row on a good app.
    expect(captureOut(() => flushNotices(["one"])).at(-1)).toBe("")
    expect(captureOut(() => flushNotices([]))).toHaveLength(0)
  })
})

describe("spacer — breathing room is asked for, not counted", () => {
  it("does not open a second gap where there is already one", () => {
    //Every block closes with a blank line and the next opens after one, so at each seam
    //two of them ask for the same gap. Counting both put `preview all` two rows below
    //its banner on an app with nothing to warn about.
    captureOut(() => header("preview all"))
    expect(captureOut(() => spacer())).toHaveLength(0)
    //…and after real output it still separates.
    captureOut(() => skip("web", "cached"))
    expect(captureOut(() => spacer())).toHaveLength(1)
  })
})

describe("fail — the timeless ✖ opens with the same `·` every other row does", () => {
  it("puts a `·` between the label and the reason", () => {
    //R25/R31: `·` introduces a row's right-hand side when nothing precedes it — the same
    //dot `✓ web  · 3.9s` and `✓ ios  · cached` open with. Without it the ✖ started one
    //column left of every neighbour, and settling a surface then failing it read ragged.
    const out = captureOut(() =>
      fail(
        "web",
        "listen EADDRINUSE: address already in use 127.0.0.1:41720",
      ),
    )
    expect(out[0]).toMatch(
      /✖ web {2}· listen EADDRINUSE: address already in use 127\.0\.0\.1:41720$/,
    )
  })

  it("lines its reason up with a settled row's metadata", () => {
    //The point of the dot is alignment: both right-hand sides must start at the same column.
    const [ok] = captureOut(() => skip("web", "cached"))
    const [bad] = captureOut(() => fail("web", "the bundle did not build"))
    expect(bad.indexOf("·")).toBe(ok.indexOf("·"))
  })

  it("gives a doctor row the same dot — one CLI, not two", () => {
    //`doctor` is the command a dev runs when something is already wrong; it must not be
    //the one that looks like a different program (the reason it shares this glyph set).
    const [row] = captureOut(() => check(true, "node", "v26.0.0"))
    expect(row).toBe("  ✓ node  · v26.0.0")
    //…and a row with nothing to report still says only its label.
    expect(captureOut(() => check(true, "@capacitor/app"))[0]).toBe(
      "  ✓ @capacitor/app",
    )
  })
})

describe("nextPhase — the live line samples the stream, it does not follow it", () => {
  it("shows the first phase immediately", () => {
    expect(
      nextPhase({ detail: "", pending: "compiling", shownAt: 0 }, 0),
    ).toEqual({
      detail: "compiling",
      shownAt: 0,
    })
  })

  it("holds a phase for its dwell before another may replace it", () => {
    const row = { detail: "compiling", pending: "linking", shownAt: 1000 }
    //too soon — the row keeps what it has
    expect(nextPhase(row, 1300).detail).toBe("compiling")
    //dwell elapsed — the newest phase takes the row
    expect(nextPhase(row, 1700).detail).toBe("linking")
  })

  it("adopts whatever is newest at the window boundary, not what queued first", () => {
    //xcodebuild alternates compiling↔processing resources per pod; sampling means the row
    //takes the current phase when its turn comes, never replays a backlog.
    let row = {
      detail: "compiling",
      pending: "processing resources",
      shownAt: 0,
    }
    row = { ...row, ...nextPhase(row, 800), pending: "linking" }
    expect(row.detail).toBe("processing resources")
    expect(nextPhase(row, 1000).detail).toBe("processing resources") //still its turn
    expect(nextPhase(row, 1600).detail).toBe("linking")
  })

  it("never rewrites the row for a phase that has not changed", () => {
    const row = { detail: "compiling", pending: "compiling", shownAt: 0 }
    expect(nextPhase(row, 99999)).toEqual({
      detail: "compiling",
      shownAt: 0,
    })
  })
})

describe("prettyLine — the vocabulary is closed (R24)", () => {
  it("drops a bundle listing", () => {
    //Reached the live line during every web build: a filename, a hash and two sizes.
    expect(
      prettyLine(
        "dist/client/assets/preload-helper-rov5cbgt.js  1.19 kB │ gzip: 0.68 kB",
      ),
    ).toBe("")
  })

  it("drops a line of the dev's own source quoted by a compiler warning", () => {
    //xcodebuild echoes the offending source under a warning, so `self?.tmpWindow = nil`
    //became the phase — the build appearing to narrate the app's internals.
    expect(prettyLine("self?.tmpWindow = nil")).toBe("")
    expect(prettyLine("2576 modules transformed.")).toBe("")
  })

  it("drops every line of a crash dump (R33)", () => {
    //`adaptv build android` with the port ports.ts pins already taken. Only the last line
    //ever reached the row (`⠴ web  node.js v26.0.0`); assert the WHOLE dump renders nothing,
    //so no future reshuffle of these filters lets a different line of it through.
    const dump = `node:events:487
      throw er; // Unhandled 'error' event
      ^

Error: listen EADDRINUSE: address already in use 127.0.0.1:41740
    at Server.setupListenHandle [as _listen2] (node:net:2008:16)
    at listenInCluster (node:net:2065:12)
    at node:net:2274:7
    at process.processTicksAndRejections (node:internal/process/task_queues:90:21)
Emitted 'error' event on WebSocketServer instance at:
    at Server.emit (node:events:521:24)
    at Server.emit (node:domain:473:12)
    at emitErrorNT (node:net:2044:8) {
  code: 'EADDRINUSE',
  errno: -48,
  syscall: 'listen',
  address: '127.0.0.1',
  port: 41740
}

Node.js v26.0.0`
    for (const line of dump.split("\n")) expect(prettyLine(line)).toBe("")
  })

  it("keeps a line that already reads like a phase", () => {
    expect(prettyLine("rendering chunks...")).toBe("rendering chunks")
    expect(prettyLine("computing gzip size...")).toBe(
      "computing gzip size",
    )
    expect(prettyLine("launching device")).toBe("launching device")
  })
})

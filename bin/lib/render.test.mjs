import { afterEach, describe, expect, it, vi } from "vitest"
import { flushNotices, nextPhase, prettyLine } from "./render.mjs"

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

afterEach(() => vi.restoreAllMocks())

describe("flushNotices — severity and repetition", () => {
  it("gives a `!` only to notices the dev must act on", () => {
    //R5: a string is a real warning; `{ note }` is something adaptv already handled,
    //so it informs without implying anything is wrong.
    const out = captureOut(() =>
      flushNotices([
        "logo.png is present but @capacitor/assets is not installed",
        {
          note: "no ./assets/logo.png — using the launcher icons already there",
        },
      ]),
    )
    expect(out[0]).toContain("!")
    expect(out[1]).not.toContain("!")
    expect(out[1]).toContain("no ./assets/logo.png")
  })

  it("prints an app-level fact once, not once per platform", () => {
    //Regression: asset config is discovered per platform, so `build all` printed the
    //same sentence twice — reading as two separate problems when it is one.
    const same = {
      note: "no ./assets/logo.png — using the launcher icons already there",
    }
    const out = captureOut(() => flushNotices([{ ...same }, { ...same }]))
    expect(out).toHaveLength(1)
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
    expect(out).toHaveLength(2)
  })

  it("empties the list so a later flush cannot reprint it", () => {
    //Notices surface next to the step that produced them; a second flush at the end
    //of the run must not repeat them.
    const notices = [{ note: "a" }, "b"]
    captureOut(() => flushNotices(notices))
    expect(notices).toHaveLength(0)
    expect(captureOut(() => flushNotices(notices))).toHaveLength(0)
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

  it("keeps a line that already reads like a phase", () => {
    expect(prettyLine("rendering chunks...")).toBe("rendering chunks")
    expect(prettyLine("computing gzip size...")).toBe(
      "computing gzip size",
    )
    expect(prettyLine("launching device")).toBe("launching device")
  })
})

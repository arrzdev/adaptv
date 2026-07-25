import { afterEach, describe, expect, it, vi } from "vitest"
import { flushNotices } from "./render.mjs"

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

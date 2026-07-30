// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import { renderFault, renderHelp, renderVersion } from "./cli-help.mjs"
import { SPEC } from "./cli-spec.mjs"

// The sentences the dev actually READS — every help page and every failure.
//
// This file did not exist until the `--host` change needed it, which was a hole in exactly the
// wrong place: the whole point of the parser work was that a failed command should name the
// offender and the fix, and nothing checked the wording. `cli-parse.test.mjs` covers what argv
// turns into and `cli-spec.test.mjs` covers the spec's own consistency; neither renders a byte.
//
// These are pure functions of `(input, COLUMNS, NO_COLOR)`, so they need no terminal — the only
// setup is capturing the writes, because a page is printed rather than returned.

/** Everything the renderer wrote, across both streams, escapes stripped. */
function captured(fn, columns = 100) {
  const chunks = []
  const grab = (s) => {
    chunks.push(s)
    return true
  }
  const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(grab)
  const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(grab)
  const realCols = process.stdout.columns
  Object.defineProperty(process.stdout, "columns", {
    value: columns,
    configurable: true,
  })
  try {
    fn()
  } finally {
    outSpy.mockRestore()
    errSpy.mockRestore()
    Object.defineProperty(process.stdout, "columns", {
      value: realCols,
      configurable: true,
    })
  }
  const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")
  return chunks.join("").replace(ANSI, "")
}

afterEach(() => vi.restoreAllMocks())

describe("a failure names the offender and the fix", () => {
  it("suggests the command you meant, and does not dump the whole help page", () => {
    //The old parser printed `✖ unknown command: buld` followed by all 40 lines of help, with
    //no suggestion anywhere in them.
    const out = captured(() =>
      renderFault({
        kind: "unknown-command",
        token: "buld",
        suggestions: ["build"],
      }),
    )
    expect(out).toContain("unknown command 'buld'")
    expect(out).toContain("did you mean 'build'?")
    expect(out.split("\n").filter((l) => l.trim()).length).toBeLessThan(5)
  })

  it("names the flag AND the command it was wrong for", () => {
    const out = captured(() =>
      renderFault({
        kind: "unknown-flag",
        token: "--forse",
        suggestions: ["--force"],
        path: ["dev"],
      }),
    )
    expect(out).toContain("unknown flag '--forse' for 'dev'")
    expect(out).toContain("did you mean '--force'?")
  })

  it("says nothing about a suggestion when nothing is close", () => {
    //Suggest, never invent: a wrong guess costs more than no guess.
    const out = captured(() =>
      renderFault({
        kind: "unknown-command",
        token: "xyzzy",
        suggestions: [],
      }),
    )
    expect(out).toContain("unknown command 'xyzzy'")
    expect(out).not.toContain("did you mean")
  })

  it("reads as a sentence when a stray argument is given", () => {
    //It did not: `where` is a TRAILING clause (" for 'dev'") and was being used to OPEN the
    //sentence, which printed `for 'dev' does not take '192.168.1.5'`.
    const out = captured(() =>
      renderFault({
        kind: "excess-args",
        received: ["wat"],
        path: ["dev"],
      }),
    )
    expect(out).toContain("'dev' does not take 'wat'")
    expect(out).not.toContain("for 'dev' does not take")
  })

  it("tells you '--host' stopped taking an ip, rather than just refusing it", () => {
    //`--host <ip>` is what muscle memory and any existing script will type, and the ip lands
    //here as a stray operand — so the generic sentence would be true and useless.
    const out = captured(() =>
      renderFault({
        kind: "excess-args",
        received: ["192.168.1.5"],
        path: ["dev"],
      }),
    )
    expect(out).toContain("'--host' takes no address")
    expect(out).toContain("adaptv dev --host")
  })
})

describe("a help page fits the terminal it is printed in", () => {
  //R10/R31. The OLD `usage()` was one template literal with 27 lines over 80 columns, the
  //longest 119 — the single biggest violator of the rule the rest of the CLI is held to.
  const PAGES = [[], ["dev"], ["build"], ["gen", "icons"], ["doctor"]]
  for (const columns of [100, 80, 48, 40]) {
    it(`wraps to ${columns} columns`, () => {
      for (const path of PAGES) {
        const out = captured(() => renderHelp(path), columns)
        for (const line of out.split("\n"))
          expect({
            path: path.join(" ") || "<root>",
            columns,
            line,
          }).toSatisfy(({ line: l }) => l.length <= columns)
      }
    })
  }

  it("describes every flag it lists", () => {
    //`--verbose`, `--target`, `--output` and `--yes` were explained nowhere at all.
    const out = captured(() => renderHelp(["dev"]))
    for (const flag of [
      "--target",
      "--latest",
      "--force",
      "--host",
      "--verbose",
    ])
      expect(out).toContain(flag)
    //Each flag row carries prose, not just the flag.
    const row = out.split("\n").find((l) => l.includes("--verbose"))
    expect(row.replace("--verbose", "").trim().length).toBeGreaterThan(11)
  })

  it("uses only the closed glyph set", () => {
    const out =
      captured(() => renderHelp([])) +
      captured(() => renderHelp(["dev"])) +
      captured(() =>
        renderFault({
          kind: "unknown-command",
          token: "x",
          suggestions: [],
        }),
      )
    for (const banned of ["✔", "✗", "⚠"]) expect(out).not.toContain(banned)
  })

  it("prints a bare version, so a script can read it", () => {
    expect(captured(() => renderVersion("1.2.3")).trim()).toBe("1.2.3")
  })
})

describe("the pages are built from the spec, not written out", () => {
  it("puts every command on the root page, so a new one cannot be forgotten", () => {
    //The drift this guards is the one the spec exists to end: the flag list used to live in
    //four places and the file-header copy had already lost all seven `gen icons` flags.
    const out = captured(() => renderHelp([]))
    for (const cmd of SPEC.commands)
      expect(out).toContain(cmd.path.join(" "))
  })

  it("puts every flag the spec declares on its command's page", () => {
    for (const cmd of SPEC.commands) {
      const out = captured(() => renderHelp(cmd.path))
      for (const f of cmd.flags ?? []) expect(out).toContain(`--${f.long}`)
    }
  })
})

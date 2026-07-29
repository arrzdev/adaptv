import { describe, expect, it } from "vitest"
import {
  commandAt,
  commandNames,
  distance,
  flagsFor,
  matchCommand,
  orList,
  SPEC,
  suggest,
  usageLines,
} from "./cli-spec.mjs"

// The spec is the one description of the command surface. These tests hold it to the two
// promises that make it worth having: every flag is EXPLAINED (the owner's complaint), and a
// correction is only ever offered when it is likely to be right.

describe("every flag is explained — the whole reason this file exists", () => {
  const everyFlag = SPEC.commands.flatMap((c) =>
    flagsFor(c).map((f) => [`${c.path.join(" ")} --${f.long}`, f]),
  )

  it.each(everyFlag)("%s says what it is for", (_label, f) => {
    expect(f.describe, `--${f.long} has no description`).toBeTruthy()
    //A description that just restates the name teaches nothing — "--force: force" is the
    //shape this is guarding against.
    expect(f.describe.toLowerCase()).not.toBe(f.long.toLowerCase())
    expect(f.describe.length).toBeGreaterThan(12)
  })

  it("gives every flag a usable shape", () => {
    for (const [label, f] of everyFlag) {
      expect(f.long, label).toMatch(/^[a-z][a-z-]*$/)
      if (f.short) expect(f.short, label).toMatch(/^[a-z]$/)
      if (f.value) expect(f.value, label).toMatch(/^[<[].+[>\]]$/)
      expect(["common", "advanced"], label).toContain(f.group)
    }
  })
})

describe("suggest — offer a correction only when it is probably right", () => {
  const FLAGS = ["--force", "--host", "--latest", "--target", "--verbose"]

  it("catches a transposition (this is why it is Damerau, not plain Levenshtein)", () => {
    expect(suggest("--forse", FLAGS)).toEqual(["--force"])
    expect(suggest("biuld", commandNames())).toEqual(["build"])
  })

  it("catches a missing letter, an extra letter, and a wrong letter", () => {
    expect(suggest("--frce", FLAGS)).toEqual(["--force"])
    expect(suggest("--forcee", FLAGS)).toEqual(["--force"])
    expect(suggest("--forcw", FLAGS)).toEqual(["--force"])
  })

  it("catches a short surface typo", () => {
    expect(suggest("is", ["web", "ios", "android", "all"])).toEqual([
      "ios",
    ])
    expect(suggest("androi", ["web", "ios", "android", "all"])).toEqual([
      "android",
    ])
  })

  it("treats a prefix as close — someone who typed --mono meant --monochrome", () => {
    expect(suggest("--mono", ["--monochrome", "--margin"])).toEqual([
      "--monochrome",
    ])
  })

  it("says NOTHING for a token that resembles nothing", () => {
    //The important case. A wrong suggestion sends the dev to try something that was never
    //going to work, and costs more than an honest "no idea".
    expect(suggest("--xyzzy", FLAGS)).toEqual([])
    expect(suggest("--wibble", FLAGS)).toEqual([])
    expect(suggest("frobnicate", commandNames())).toEqual([])
  })

  it("never offers a retired command as a correction", () => {
    expect(suggest("run", commandNames())).toEqual([])
  })

  it("returns at most two, best first", () => {
    const out = suggest("--forcx", [
      "--force",
      "--forck",
      "--forcy",
      "--zzz",
    ])
    expect(out.length).toBeLessThanOrEqual(2)
  })
})

describe("distance", () => {
  it("scores an adjacent transposition as one edit", () => {
    expect(distance("forse", "force")).toBe(1)
    expect(distance("biuld", "build")).toBe(1)
  })
  it("is zero for a match and symmetric otherwise", () => {
    expect(distance("build", "build")).toBe(0)
    expect(distance("abc", "abd")).toBe(distance("abd", "abc"))
  })
})

describe("the shape of the surface", () => {
  it("matches the two-word command before the one-word one", () => {
    expect(
      matchCommand(["gen", "icons", "--input", "x"]).cmd.path,
    ).toEqual(["gen", "icons"])
    expect(matchCommand(["dev", "ios"]).rest).toEqual(["ios"])
    expect(matchCommand(["nope"]).cmd).toBeNull()
  })

  it("writes a synopsis for every command", () => {
    for (const cmd of SPEC.commands) {
      const [line] = usageLines(cmd)
      expect(line.startsWith(`adaptv ${cmd.path.join(" ")}`)).toBe(true)
    }
  })

  it("names build's surfaces without 'web', and says where a web build lives", () => {
    const build = commandAt(["build"])
    expect(build.args[0].choices).toEqual(["ios", "android", "all"])
    expect(build.args[0].rejects.web).toContain("preview web")
  })

  it("quotes with ' and never a backtick (R43)", () => {
    const text = JSON.stringify(SPEC)
    expect(text).not.toContain("`")
  })
})

describe("orList", () => {
  it("reads as a sentence", () => {
    expect(orList(["--force"])).toBe("'--force'")
    expect(orList(["--force", "--host"])).toBe("'--force' or '--host'")
    expect(orList([])).toBe("")
  })
})

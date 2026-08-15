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
  it("prefers the longest match, and separates the command from its rest", () => {
    //`matchCommand` still tries two words before one. Nothing uses that today — `gen icons`
    //became `icons` — but a namespace is the sort of thing that comes back, and the rule is
    //what stops `gen` matching before `gen icons` when it does.
    expect(matchCommand(["icons", "--input", "x"]).cmd.path).toEqual([
      "icons",
    ])
    expect(matchCommand(["dev", "ios"]).rest).toEqual(["ios"])
    expect(matchCommand(["nope"]).cmd).toBeNull()
  })

  it("never suggests the word that was just typed", () => {
    //`commandNames()` returns `path[0]`, so while `gen icons` existed it contributed the
    //candidate `gen`, and `adaptv gen` answered: unknown command 'gen', did you mean 'gen'?
    for (const name of commandNames())
      expect(suggest(name, commandNames())).not.toContain(name)
  })

  it("writes a synopsis for every command", () => {
    for (const cmd of SPEC.commands) {
      const [line] = usageLines(cmd)
      expect(line.startsWith(`adaptv ${cmd.path.join(" ")}`)).toBe(true)
    }
  })

  it("offers 'web' as a build surface and rejects none", () => {
    const build = commandAt(["build"])
    expect(build.args[0].choices).toEqual(["web", "ios", "android", "all"])
    //`web` first: it is the surface every app has, and the only one that
    //publishes the update channel.
    expect(build.args[0].rejects).toBeUndefined()
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

describe("the copy reads like a person wrote it", () => {
  const summaries = SPEC.commands.map((c) => c.summary)
  const describes = SPEC.commands.flatMap((c) =>
    flagsFor(c).map((f) => f.describe),
  )

  it("keeps the em-dash out of the command list", () => {
    //Not a ban on em-dashes — `--force` and `--json` earn theirs introducing a list. This is
    //about the COMMAND LIST, which was five lines all built the same way:
    //    doctor   check the local toolchain — JDK, Android SDK, Xcode, CocoaPods
    //    dev      live reload — one dev server, every surface attached, hot-reloading on save
    //    preview  the real build, run the way a user gets it — no live reload
    //    build    static artifacts — an unsigned .ipa and a debug .apk
    //    gen icons your whole icon set — manifest, favicons, … — from one image
    //`<noun phrase> — <expansion>`, five times. No single line was bad; the rhythm was the
    //tell, and a page you scan is where uniformity shows most.
    for (const s of summaries) expect(s).not.toContain("—")
  })

  it("says what running the command DOES, so the list reads as actions", () => {
    //Four of the five opened with a noun. A command is a verb; its one line should be too.
    const VERB =
      /^(check|run|package|generate|write|open|show|print|launch|build)\b/
    for (const s of summaries) expect(s).toMatch(VERB)
  })

  it("uses no marketing filler", () => {
    //Never had any, and this is what keeps it that way.
    //No `unlock` or `elevate`: both have literal uses here ("Unlock it and keep it unlocked
    //while installing"), and a rule that flags correct copy is a rule that gets switched off.
    const SLOP =
      /\b(seamless(ly)?|robust|powerful|effortless(ly)?|simply|easily|leverage|utilize|streamline|innovative|comprehensive|blazing|delightful|empower)\b/i
    for (const s of [...summaries, ...describes, SPEC.tagline])
      expect({ s }).toSatisfy(({ s: t }) => !SLOP.test(t))
  })

  it("explains a flag in the dev's words, not adaptv's", () => {
    //Each of these was in a flag description and meant nothing outside this codebase:
    //"calm steps" (what our own renderer prints), "slots" (an internal icon target),
    //"one-ink" (print jargon), "your mark" (designer jargon).
    const OURS = /\bcalm steps\b|\bslots?\b|\bone-ink\b|\byour mark\b/i
    for (const d of describes)
      expect({ d }).toSatisfy(({ d: t }) => !OURS.test(t))
  })
})

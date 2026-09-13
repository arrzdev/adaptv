import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { CliFault, parse, splitPassthrough } from "./cli-parse.mjs"
import { flagsFor, SPEC } from "./cli-spec.mjs"

// Every case here is something the OLD hand-rolled parser got wrong, or something it got right
// that must not regress. The hand-rolled one ended with
//     else if (a.startsWith("--")) flags[a.slice(2)] = true
// so an unknown flag was silently accepted, `--flag=value` became a key called "flag=value",
// and a flag that took a value swallowed the positional after it.

/** Parse, returning either the result or the fault's kind + fields.
 *  `message` is spread explicitly — it is a non-enumerable own property of Error. */
const run = (argv) => {
  try {
    return parse(argv)
  } catch (err) {
    if (err instanceof CliFault)
      return { fault: err.kind, message: err.message, ...err }
    throw err
  }
}

describe("what used to be accepted in silence", () => {
  it("rejects an unknown flag instead of setting it to true and running anyway", () => {
    const r = run(["dev", "ios", "--forse"])
    expect(r.fault).toBe("unknown-flag")
    expect(r.token).toBe("--forse")
    expect(r.suggestions).toEqual(["--force"])
  })

  it("understands --flag=value, which used to become a key called 'target=abc'", () => {
    expect(run(["dev", "--target=abc", "ios"]).flags.target).toBe("abc")
  })

  it("takes no value, so '--host ios' means the ios surface in LAN mode", () => {
    //`--host` used to accept an optional `[ip]`, and an optional-value flag consumes the next
    //token — so this ate the surface and then complained there wasn't one. The flag stopped
    //taking a value because nobody wants to look up their own LAN address for a tool already
    //running on the machine; the shape reads naturally now as a side effect.
    const r = run(["dev", "--host", "ios"])
    expect(r.fault).toBeUndefined()
    expect(r.flags.host).toBe(true)
    expect(r.path).toEqual(["dev"])
    expect(r.rest).toEqual(["ios"])
  })

  it("rejects an ip after --host, and says the flag no longer takes one", () => {
    //Muscle memory, and any script written against the old shape. The ip arrives as a stray
    //operand, so a generic "does not take" would be true and useless.
    //The fault carries the operand; the SENTENCE it turns into is `cli-help.test.mjs`'s.
    const r = run(["dev", "ios", "--host", "192.168.1.5"])
    expect(r.fault).toBe("excess-args")
    expect(r.received).toEqual(["192.168.1.5"])
    expect(r.accepted).toEqual(["ios"])
  })

  it("refuses a --background that is not a colour, which used to silently become white", () => {
    const r = run(["icons", "--input", "x.png", "--background", "zzz"])
    expect(r.fault).toBe("invalid-value")
    expect(r.message).toContain("hex colour")
  })

  it("refuses a --margin with no value, which used to fall back to the default", () => {
    expect(run(["icons", "--input", "x.png", "--margin"]).fault).toBe(
      "flag-needs-value",
    )
  })

  it("refuses an out-of-range --margin", () => {
    const r = run(["icons", "--input", "x.png", "--margin", "90"])
    expect(r.fault).toBe("invalid-value")
    expect(r.message).toContain("between 0 and 50")
  })
})

describe("help and version, which used to be errors", () => {
  it("answers --version", () => {
    expect(run(["--version"]).version).toBe(true)
    expect(run(["-v"]).version).toBe(true)
  })

  it("answers --help per command, where it used to say 'unknown dev target'", () => {
    expect(run(["dev", "--help"])).toMatchObject({
      help: true,
      path: ["dev"],
    })
    expect(run(["icons", "--help"])).toMatchObject({
      help: true,
      path: ["icons"],
    })
    expect(run(["-h"]).help).toBe(true)
    expect(run([]).help).toBe(true)
  })

  it("still answers the bare word 'help', which worked before", () => {
    expect(run(["help"]).help).toBe(true)
    expect(run(["help", "build"])).toMatchObject({
      help: true,
      path: ["build"],
    })
  })
})

describe("commands and surfaces", () => {
  it("suggests a command", () => {
    const r = run(["biuld", "ios"])
    expect(r.fault).toBe("unknown-command")
    expect(r.suggestions).toEqual(["build"])
  })

  it("suggests a surface", () => {
    const r = run(["dev", "is"])
    expect(r.fault).toBe("unknown-surface")
    expect(r.suggestions).toEqual(["ios"])
  })

  it("accepts a web build, because that is what publishes the update channel", () => {
    //It used to be rejected with "a web build is 'adaptv preview web'". That
    //stopped being true when OTA landed: the site and the bundle installed apps
    //run are two builds that both write dist/client, so only a command
    //sequencing them can emit the channel — and `preview web` serves, it does
    //not publish.
    const r = run(["build", "web"])
    expect(r.fault).toBeUndefined()
    expect(r.rest).toEqual(["web"])
  })

  it("asks for a surface when none is given", () => {
    expect(run(["dev"]).fault).toBe("missing-surface")
  })

  it("rejects --target with an 'all' surface, on both commands that have one", () => {
    expect(run(["dev", "all", "--target", "x"]).fault).toBe("conflict")
    expect(run(["preview", "all", "--target", "x"]).fault).toBe("conflict")
  })

  it("rejects a stray extra argument", () => {
    expect(run(["dev", "ios", "extra"]).fault).toBe("excess-args")
  })

  it("requires --input for icons", () => {
    expect(run(["icons"]).fault).toBe("missing-flag")
  })

  it("treats a renamed command as simply unknown", () => {
    //`gen icons` became `icons`, and there is no migration message: nothing has ever been
    //published, so no install anywhere carries the old spelling.
    const r = run(["gen", "icons", "--input", "x.png"])
    expect(r.fault).toBe("unknown-command")
    expect(r.token).toBe("gen")
  })
})

describe("the passthrough boundary", () => {
  it("splits at a lone --", () => {
    expect(
      splitPassthrough(["dev", "ios", "--", "--port", "4000"]),
    ).toEqual({
      head: ["dev", "ios"],
      after: ["--port", "4000"],
    })
    expect(splitPassthrough(["dev", "ios"]).after).toBeNull()
  })

  it("forwards vite args from dev", () => {
    expect(
      run(["dev", "ios", "--", "--port", "4000"]).flags.viteArgs,
    ).toEqual(["--port", "4000"])
  })

  it("refuses a passthrough on a command that forwards nothing", () => {
    expect(run(["build", "ios", "--", "x"]).fault).toBe("no-passthrough")
  })

  it("always sets viteArgs, so no caller needs a null check", () => {
    expect(run(["build", "ios"]).flags.viteArgs).toEqual([])
  })
})

describe("the shape handed to the commands is the shape they already read", () => {
  //The migration's safety property: every adaptv flag is one lowercase word, so commander's
  //camel-casing is a no-op and no command call site changed.
  it("keeps the flag keys the commands read", () => {
    const r = run([
      "dev",
      "ios",
      "--target",
      "abc",
      "--latest",
      "--force",
      "--verbose",
    ])
    expect(r.flags).toMatchObject({
      target: "abc",
      latest: true,
      force: true,
      verbose: true,
    })
    expect(r.rest).toEqual(["ios"])
  })

  it("leaves an unpassed flag undefined rather than false", () => {
    expect(run(["dev", "ios"]).flags.target).toBeUndefined()
  })
})

describe("the spec is the only description of the surface", () => {
  const SRC = readFileSync(
    path.join(process.cwd(), "bin/adaptv.mjs"),
    "utf8",
  )

  it("has no flag left un-declared — every flags.X the CLI reads is in the spec", () => {
    const declared = new Set(
      SPEC.commands.flatMap((c) => flagsFor(c).map((f) => f.long)),
    )
    //`viteArgs` is the passthrough, produced by the parser rather than declared as a flag.
    declared.add("viteArgs")
    const read = new Set(
      [...SRC.matchAll(/\bflags\.([a-zA-Z]+)/g)].map((m) => m[1]),
    )
    const orphans = [...read].filter((f) => !declared.has(f))
    expect(
      orphans,
      `read from flags but not declared: ${orphans}`,
    ).toEqual([])
  })

  it("keeps the command catalogue out of the file header comment", () => {
    //The header used to carry its own copy of every command and flag, and it had already
    //drifted — it omitted `gen icons` entirely. One description, or none.
    //
    //The rule is specifically about COMMAND flags, which are the ones that drift. Prose may
    //still say `adaptv --help`: that is a pointer to where the description lives, and it is
    //the same on every command forever.
    const header = SRC.slice(0, SRC.indexOf("import "))
    const declared = SPEC.commands.flatMap((c) =>
      flagsFor(c).map((f) => `--${f.long}`),
    )
    const named = [...new Set(declared)].filter((f) => header.includes(f))
    expect(named, "the header comment documents flags again").toEqual([])
  })
})

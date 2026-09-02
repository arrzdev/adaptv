import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * `render.mjs` is the CLI's rendering ENGINE, and this is what makes that true rather than
 * merely intended.
 *
 * Every inconsistency the owner has had to report came from the same shape: a command drew
 * its own output instead of asking the renderer for it, and the copy drifted from the
 * original. `preview web` hand-rolled `ctrl-c stop` — dim and unspaced, where `dev` got a
 * bold, spaced one from `liveWatcher()`. `doctor` printed its own banner and used `✔` where
 * the rest of the CLI uses `✓`. A per-platform step was written twice, once for one platform
 * and once for `all`, and the two shapes diverged.
 *
 * No rule in a document catches that. A test does: if the bytes can only leave through one
 * file, a second visual language cannot quietly appear in a third.
 */

//cwd, not import.meta.url: vitest hands modules a non-`file:` URL.
const BIN = join(process.cwd(), "bin")
const ENGINE = "lib/render.mjs"

/** Every .mjs the CLI ships, excluding tests and the engine itself. */
function cliModules() {
  const files = []
  //`ui/` too: the Ink components are held to the same glyph and stdout rules as everything
  //else — a second visual language is exactly as possible there as anywhere.
  for (const entry of ["", "commands", "lib", "ui"]) {
    const dir = join(BIN, entry)
    let names = []
    try {
      names = readdirSync(dir)
    } catch {
      continue
    }
    for (const f of names) {
      if (!f.endsWith(".mjs") || f.includes(".test.")) continue
      const rel = entry ? `${entry}/${f}` : f
      if (rel !== ENGINE) files.push(rel)
    }
  }
  return files
}

describe("the render engine owns every byte the CLI prints", () => {
  it("finds the CLI's modules (guard against an empty sweep)", () => {
    const mods = cliModules()
    expect(mods.length).toBeGreaterThan(3)
    expect(mods).toContain("adaptv.mjs")
  })

  it.each(cliModules())("%s writes nothing to stdout directly", (rel) => {
    const src = readFileSync(join(BIN, rel), "utf8")
    const offenders = src
      .split("\n")
      .map((l, i) => [i + 1, l])
      .filter(([, l]) => /process\.stdout\.write|console\.log/.test(l))
      .map(([n, l]) => `${rel}:${n}  ${l.trim()}`)
    //`rawOut()` in render.mjs is the sanctioned escape hatch for --verbose passthrough (R12).
    expect(offenders).toEqual([])
  })

  it("parses — every module, with the real parser", () => {
    //The suite only loads a module something imports, and `icon-preview.mjs` is imported by one
    //command and no test. It is also ONE enormous template literal, so ordinary prose can break
    //it: a backtick in a CSS comment closes the literal and turns the rest of the sheet into
    //JavaScript. That shipped a `SyntaxError` past a fully green run, and only the dev running
    //the command ever saw it. `node --check` is the cheap floor under that — the same parser
    //that will refuse the file at runtime, rather than a regex guessing at one.
    const broken = cliModules()
      .map((rel) => [
        rel,
        spawnSync(process.execPath, ["--check", join(BIN, rel)], {
          encoding: "utf8",
        }),
      ])
      .filter(([, r]) => r.status !== 0)
      .map(
        ([rel, r]) => `${rel}: ${(r.stderr ?? "").split("\n")[2] ?? ""}`,
      )
    expect(broken).toEqual([])
  })

  it("keeps commander behind one door", () => {
    //Commander is a SECOND engine: left to itself it prints its own help, its own errors and
    //its own exit codes, in its own visual language. `cli-parse.mjs` exists to take all three
    //away from it (configureOutput, exitOverride, configureHelp) and hand back structured
    //faults instead. That containment is only true while exactly one module imports it — a
    //second importer is a second set of defaults nobody silenced.
    const importers = cliModules().filter((rel) =>
      /from\s+["']commander["']/.test(
        readFileSync(join(BIN, rel), "utf8"),
      ),
    )
    expect(importers).toEqual(["lib/cli-parse.mjs"])
  })

  it("keeps the glyph set in one place", () => {
    //A second ✔/✗/⚠ vocabulary is how `doctor` ended up looking like a different program.
    const strays = []
    for (const rel of cliModules()) {
      const src = readFileSync(join(BIN, rel), "utf8")
      for (const [n, l] of src.split("\n").entries()) {
        if (/[✔✗⚠]/.test(l) && !l.trimStart().startsWith("//"))
          strays.push(`${rel}:${n + 1}  ${l.trim()}`)
      }
    }
    expect(strays).toEqual([])
  })
})

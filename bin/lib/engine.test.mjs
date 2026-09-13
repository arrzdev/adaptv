import { spawnSync } from "node:child_process"
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
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

//Runs inside ONE child node: compiles each path as an ES module — V8's module parser, the one
//`node --check` and the runtime use — without linking or evaluating it, and answers one entry
//per path, `null` or the error's text.
const PARSE = `const { SourceTextModule } = require("node:vm")
const { readFileSync } = require("node:fs")
const out = []
for (const f of JSON.parse(readFileSync(0, "utf8"))) {
  try { new SourceTextModule(readFileSync(f, "utf8"), { identifier: f }); out.push(null) }
  catch (e) { out.push(String(e)) }
}
process.stdout.write(JSON.stringify(out))`

/**
 * The paths that do not parse as ES modules, as `path:line  SyntaxError: …`.
 *
 * One process for the whole sweep. It was one `node --check` per module, and a node process
 * costs ~60ms to start whatever it then does: 37 modules made this the slowest test in the
 * file (1.8–2.4s alone) and it timed out at 5s under a loaded gate. `node --check` still runs,
 * but only for a path that failed, because it is what names the line.
 */
function unparseable(paths) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-vm-modules", "--no-warnings", "-e", PARSE],
    { input: JSON.stringify(paths), encoding: "utf8" },
  )
  //A child that died, or answered for fewer paths, would otherwise read as "nothing broken".
  expect(r.status, r.stderr).toBe(0)
  const errors = JSON.parse(r.stdout)
  expect(errors).toHaveLength(paths.length)
  return paths.flatMap((p, i) => {
    if (errors[i] === null) return []
    const check = spawnSync(process.execPath, ["--check", p], {
      encoding: "utf8",
    })
    const where = (check.stderr ?? "").split("\n")[0] || p
    return [`${where}  ${errors[i]}`]
  })
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
    expect(unparseable(cliModules().map((rel) => join(BIN, rel)))).toEqual(
      [],
    )
  })

  it("parses — and the sweep refuses the break it exists for", () => {
    //The sweep is only worth its place while it can fail. Plant the shipped bug — a backtick in
    //a CSS comment closing the template literal — beside a module that must pass (a hashbang
    //and top-level await, as `adaptv.mjs` has), and require exactly the first to be named.
    const dir = mkdtempSync(join(tmpdir(), "adaptv-parse-"))
    try {
      const broken = join(dir, "sheet.mjs")
      const fine = join(dir, "entry.mjs")
      writeFileSync(
        broken,
        "export const css = `a { color: red } /* a `b` note */ b {}`\n",
      )
      writeFileSync(fine, "#!/usr/bin/env node\nawait Promise.resolve()\n")
      const found = unparseable([fine, broken])
      expect(found).toHaveLength(1)
      expect(found[0]).toMatch(/sheet\.mjs:1 {2}SyntaxError: /)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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

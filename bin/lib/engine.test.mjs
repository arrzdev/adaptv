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
  for (const entry of ["", "lib"]) {
    const dir = join(BIN, entry)
    for (const f of readdirSync(dir)) {
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

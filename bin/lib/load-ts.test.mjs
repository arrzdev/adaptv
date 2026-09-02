// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { ADAPTV_ROOT } from "./load-ts.mjs"

/*
 * `bin/` reaches into `src/` by string: `loadAdaptvModule("ota/build/ota-emit.ts")`,
 * resolved by esbuild when that CLI command runs and by nothing before then. `tsc`
 * includes `src/**` only, Biome reads no string, and a loader-hook measurement
 * found that only 4 of the 11 targets are ever bundled by any test — so a moved
 * file broke `adaptv build web` and nothing else. → `docs/roadmap/src-reorg.md` §7
 *
 * This is the literal, checked. Every `loadAdaptvModule("…")` in a non-test
 * `.mjs` anywhere under `bin/` must name a file that exists under `src/`.
 *
 * Comments are stripped first, and that is a decision: the doc-comment on
 * `loadAdaptvModule` itself carries an example call, and an example cannot break a
 * command. What this guards is the set of strings the CLI *resolves*, so the count
 * below is of those alone — 18 today, over 13 targets.
 */

const BIN = path.resolve(import.meta.dirname, "..")
const SRC = path.join(ADAPTV_ROOT, "src")

/** Every non-test `.mjs` under `dir`, recursively. */
function cliSources(dir) {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...cliSources(full))
    else if (
      entry.name.endsWith(".mjs") &&
      !entry.name.endsWith(".test.mjs")
    )
      found.push(full)
  }
  return found.sort()
}

/**
 * Comments out, strings kept — one pass over both, because they nest into each
 * other both ways: a glob string such as `"src/**"` followed by `/` opens no
 * comment, and a `//` in a URL inside a string is not a line comment. Whichever token starts first wins.
 */
function code(source) {
  const token =
    /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g
  return source.replace(token, (match) =>
    match.startsWith("/") ? match.replace(/[^\n]/g, "") : match,
  )
}

/** Every `loadAdaptvModule("<target>")` in the CLI, as `{ file, line, target }`. */
function stringLoads() {
  const loads = []
  for (const file of cliSources(BIN)) {
    const source = code(readFileSync(file, "utf8"))
    for (const match of source.matchAll(
      /loadAdaptvModule\(\s*"([^"]+)"/g,
    )) {
      loads.push({
        file: path.relative(ADAPTV_ROOT, file),
        line: source.slice(0, match.index).split("\n").length,
        target: match[1],
      })
    }
  }
  return loads
}

describe("loadAdaptvModule — the strings bin/ resolves against src/", () => {
  const loads = stringLoads()

  /*
   * The vacuous pass: a regex that stops matching, or a walk pointed at the wrong
   * directory, finds zero loads and zero dangling ones. The floor is well under
   * today's 18 and well over zero.
   */
  it("actually found the call sites it claims to check", () => {
    expect(loads.length).toBeGreaterThanOrEqual(10)
    expect(new Set(loads.map((l) => l.file)).size).toBeGreaterThanOrEqual(
      4,
    )
  })

  it("names only files that exist under src/", () => {
    const dangling = loads
      .filter(({ target }) => {
        const full = path.join(SRC, target)
        return !(existsSync(full) && statSync(full).isFile())
      })
      .map(({ file, line, target }) => `${file}:${line} → src/${target}`)
    expect(dangling).toEqual([])
  })
})

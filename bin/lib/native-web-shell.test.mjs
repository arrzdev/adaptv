// @vitest-environment node
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * adaptv **generates** its app shell (`src/vite/shell-emit.ts`) and never adopts
 * one produced by the router. The generated copy is the only `index.html` that
 * carries the prerendered boot fallback (`DECISIONS.md` B31), so anything
 * downstream that overwrites it with a different document silently removes the
 * app's last line of defence.
 *
 * This is a source guard rather than a behavioural test because the hazard is a
 * single line inside `buildWeb`, after a real `vite build` that a unit test
 * cannot stand up. The line was there, it did fire on every native build, and it
 * was harmless only because the two documents happened to be byte-identical —
 * see B31 for the measurement. "Happened to be" is what this test removes.
 */

const nativeSource = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "native.mjs"),
  "utf8",
)

/** Lines that are actual code — the comment explaining the hazard names it too. */
const codeLines = nativeSource
  .split("\n")
  .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))

describe("the native SPA build keeps adaptv's own shell", () => {
  it("never reads the router's `_shell.html` in code", () => {
    expect(codeLines.filter((l) => l.includes("_shell.html"))).toEqual([])
  })

  it("copies no file over the generated shell", () => {
    //The clobber was a `copyFileSync`; nothing else in this module needs one, so
    //its reappearance is the signal regardless of what it is spelled against.
    expect(codeLines.filter((l) => l.includes("copyFileSync"))).toEqual([])
  })

  it("requires the generated `index.html` instead of synthesising one", () => {
    //Assembled rather than written out: the sentence being matched is itself a
    //template literal in the source, and spelling it whole here would make this
    //file look like it had an unescaped placeholder of its own.
    expect(nativeSource).toContain(
      `the SPA build produced no $\{CAP_WEB_DIR}/index.html`,
    )
  })

  it("keeps the reason attached to the code, not only to the docs", () => {
    //The next person to "restore" the copy reads this file, not DECISIONS.md.
    expect(nativeSource).toContain("B31")
  })
})

// @vitest-environment node
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * adaptv **generates** its app shell (`src/vite/shell-emit.ts`) and never adopts
 * one produced by the router. The generated copy is the only `index.html` that
 * carries the prerendered boot fallback (`docs/decisions/register.md` B31), so anything
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
    //The next person to "restore" the copy reads this file, not docs/decisions/register.md.
    expect(nativeSource).toContain("B31")
  })
})

/**
 * …and it must be a shell built from the config that is on disk NOW.
 *
 * The other half of the same guarantee, and the one that actually broke. `.adaptv/web` is
 * what `cap sync` copies into every platform's `public/`, so whichever command produced it
 * decides what ships. `dev` decided by asking only whether a bundle existed — so after a
 * `themeColor` edit it synced a shell emitted from the previous config while
 * `preparePlatforms`, in the same run, re-derived the iOS splash colourset and Android's
 * `colors.xml` from the new one. The native splash painted the new colour and handed off to
 * a web shell painting the old one, with nothing anywhere reporting a problem.
 *
 * Source guards, for the same reason as everything above: the hazard lives in a branch
 * around two real `vite build`s. What can be pinned is that every path which syncs asks the
 * question, and that none of them is allowed to go back to asking whether a file exists.
 */
const cliSource = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "adaptv.mjs",
  ),
  "utf8",
)

/** The body of one function in `adaptv.mjs`, up to the next top-level declaration. */
function bodyOf(name) {
  const start = cliSource.search(
    new RegExp(`^(async )?function ${name}\\(`, "m"),
  )
  expect(start).toBeGreaterThan(-1)
  const rest = cliSource.slice(start + 1)
  const end = rest.search(/\n(async )?function \w+\(/)
  return end === -1 ? rest : rest.slice(0, end)
}

describe("a config edit invalidates the bundle the native project ships", () => {
  it("is asked by every command that syncs one", () => {
    //`runLive` is `dev` (the path the bug shipped on) and `pipeline` is
    //`build`/`preview`. A third command that syncs and does not appear here is a
    //third command that can ship a stale shell.
    for (const fn of ["runLive", "pipeline"]) {
      expect(bodyOf(fn)).toContain(
        'bundleStale(appRoot, "capacitor", config)',
      )
    }
  })

  it("is asked again by dev's `b` rebuild, which re-reads the config", () => {
    //`b` exists to rebuild from the config the dev has just edited. Re-reading it and
    //then syncing the old bundle is the same bug with a keystroke in front of it.
    const live = bodyOf("runLive")
    const rebuild = live.slice(live.indexOf("const rebuild = async"))
    expect(rebuild).toContain('bundleStale(appRoot, "capacitor", config)')
  })

  it("never decides by asking whether a bundle merely exists", () => {
    //The original gate, verbatim. Its return is "there is a file there", which is a
    //different question from "there is a file there that this config produced".
    expect(cliSource).not.toContain(
      'existsSync(path.join(appRoot, CAP_WEB_DIR, "index.html"))',
    )
  })

  it("hands the same fingerprint to the bundle that gates the native assets", () => {
    //One signal for both halves of the app. Two is what let them disagree.
    const stamp = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "build-stamp.mjs",
      ),
      "utf8",
    )
    expect(stamp).toContain("appConfigFingerprint(appRoot, config)")
    expect(nativeSource).toContain("buildIdEnv(appRoot, config)")
  })
})

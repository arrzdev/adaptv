// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { OWN_PHASES } from "../ui/theme.mjs"
import { namesPlumbing } from "./opacity.mjs"
import { prettyLine } from "./render.mjs"

/**
 * The class this file closes: **a call site can invent a phrase that silently disappears, and
 * nothing catches it.**
 *
 * `prettyLine` is a filter for what BUILD TOOLS print. A phase adaptv chose for itself only
 * survives it by being in `OWN_PHASES`; everything else is measured against rules written for
 * xcodebuild and gradle, and adaptv's own words lose. Eight `report()` call sites were emitting
 * strings that rendered as the empty string — a lone verb (`archiving`), parentheses
 * (`scaffolding native project (first run)`), a URL (`<url> · warming`), a file extension
 * (`packaging .ipa`), a package name. The row kept its previous phase and adaptv went quiet
 * during a step it was actually performing. Nothing failed; the only symptom was silence.
 *
 * Three more survived by ACCIDENT — `looking for devices`, `reading the published manifest`,
 * `writing the channel` were outside `OWN_PHASES` and reached the row through the filter's
 * last-ditch "starts with a participle" escape hatch, which exists for unrecognised tool lines.
 * Any rewording would have deleted them, and the deletion would have looked like nothing.
 *
 * So the assertion is not "it renders": it is "it is REGISTERED". Every phase adaptv reports
 * for itself has to be a plain literal whose head is in `OWN_PHASES`, which is the only way the
 * register can be trusted to describe what the CLI actually says.
 */

const BIN = path.resolve(fileURLToPath(new URL("../", import.meta.url)))

/** Every source file the CLI ships, tests excluded. */
function sources(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...sources(full))
    else if (entry.endsWith(".mjs") && !entry.endsWith(".test.mjs"))
      out.push(full)
  }
  return out.sort()
}

/**
 * Every `report(...)` / `report?.(...)` argument in `bin/`, as written.
 *
 * Deliberately a text scan rather than a runtime one: a phase that only appears on a first-run
 * scaffold, a legacy migration, or a missing plugin is exactly the kind that never runs in a
 * test and so is exactly the kind that rots. `kind` is what the argument IS, because the
 * distinction is the point — a string literal is adaptv talking, an identifier
 * (`report(l)`, `onLine: report`) is a tool line being forwarded and is `prettyLine`'s job.
 */
// No whitespace before the paren: a doc comment saying "inside a report (`doctor`)" is not a
// call site, and the first version of this scan reported it as one.
const CALL =
  /\breport(?:\?\.)?\(\s*(?:(["'])((?:\\.|(?!\1).)*)\1|(`(?:\\.|[^`])*`))/g

/** Strip `//` and block comments — prose about `report()` is not `report()`. */
const CODE_ONLY = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

function reportedPhrases() {
  const found = []
  for (const file of sources(BIN)) {
    const src = CODE_ONLY(readFileSync(file, "utf8"))
    const rel = path.relative(path.dirname(BIN), file)
    for (const m of src.matchAll(CALL)) {
      const line = src.slice(0, m.index).split("\n").length
      if (m[3] !== undefined)
        found.push({ where: `${rel}:${line}`, raw: m[3], template: true })
      else
        found.push({
          where: `${rel}:${line}`,
          raw: m[2],
          template: false,
        })
    }
  }
  return found
}

const PHRASES = reportedPhrases()

describe("every phase adaptv reports for itself survives prettyLine", () => {
  it("finds the call sites at all (the scan itself can rot)", () => {
    // A regex that stops matching would turn this whole file green and useless.
    expect(PHRASES.length).toBeGreaterThanOrEqual(18)
    expect(PHRASES.map((p) => p.raw)).toContain("syncing")
  })

  it.each(PHRASES)("$where — $raw", ({ raw, template }) => {
    // A template literal cannot be checked against a closed register, and every one that
    // has ever been written here was a path, a URL or a package name — none of which a
    // phase may carry (R22). Interpolate into a NOTICE instead; the phase stays a literal.
    expect(template, "a phase must be a literal, not a template").toBe(
      false,
    )
    // The register, first: this is the check that does not depend on which of `prettyLine`'s
    // rules happens to spare the phrase today.
    const head = raw.split(" · ")[0]
    expect(
      OWN_PHASES.has(head),
      `'${head}' is not in OWN_PHASES (bin/ui/theme.mjs) — reword it into an existing entry, or add it there AND to docs/design/cli-contract.md`,
    ).toBe(true)
    // …and the byte-level consequence, which is what the dev sees.
    expect(prettyLine(raw)).toBe(raw)
    // R8: a phase is on screen, so it may never name the engines underneath.
    expect(namesPlumbing(raw)).toBe(false)
  })
})

describe("OWN_PHASES is a register, not a wishlist", () => {
  it("is every entry a present participle (R45)", () => {
    for (const phase of OWN_PHASES)
      expect(
        phase,
        `'${phase}' does not read as "right now adaptv is …"`,
      ).toMatch(/^[a-z]+ing\b/)
  })

  it("passes every entry through prettyLine unchanged", () => {
    for (const phase of OWN_PHASES) expect(prettyLine(phase)).toBe(phase)
  })

  it("carries no entry no call site uses", () => {
    // A dead phrase in the register is how the register stops describing the CLI. Two other
    // mouths speak these words and both count: `render.mjs` opens every live row on
    // `preparing` directly, and `tool-log.mjs` maps xcodebuild/gradle/CocoaPods lines onto
    // R24's shared half of the vocabulary (`preparing build`, `processing resources`).
    const spoken = new Set(
      PHRASES.filter((p) => !p.template).map((p) => p.raw.split(" · ")[0]),
    )
    spoken.add("preparing")
    for (const m of readFileSync(
      path.join(BIN, "lib", "tool-log.mjs"),
      "utf8",
    ).matchAll(/"([a-z][a-z ]+)"/g))
      spoken.add(m[1])
    for (const phase of OWN_PHASES)
      expect(spoken.has(phase), `'${phase}' is reported by nothing`).toBe(
        true,
      )
  })
})

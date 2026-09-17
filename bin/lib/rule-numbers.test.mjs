// @vitest-environment node
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * The class this file closes: **a rule number that means two different things.**
 *
 * `docs/design/cli-contract.md` numbers its rules, and everything else in the repo cites them
 * by that number alone — a comment above the code a rule constrains, a test name, a line in
 * the skill. The number is the only link. Nothing in it says which rule it points at, so a
 * number used twice is a citation that resolves to either of two unrelated rules, and a reader
 * who follows one has no way to notice they landed on the wrong one.
 *
 * It happened twice. `R33` was both "everything adaptv already knows is said before the run"
 * and "a crash dump is never a phase"; `R39` was both "an explicit flag outranks a measurement"
 * and "there is ONE answer to 'is this config usable'". Both collisions were live for months
 * across ~50 citations before anyone noticed, because a duplicate heading reads as correct in
 * isolation — you only see it by holding the whole file at once, which nobody does.
 *
 * A dangling citation is the same wound from the other side: `R0` was cited in the contract and
 * defined nowhere, so it pointed at nothing and read as if it pointed at something.
 *
 * So the assertions are about the NUMBER SPACE, not about any rule's text: every number is
 * defined exactly once, the range has no holes, and every citation anywhere in the repo names
 * a number the contract actually defines.
 */

const ROOT = path.resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
)
const CONTRACT = path.join(ROOT, "docs/design/cli-contract.md")

/** A rule DEFINITION: a bolded `**R<n> — …**` opening its own line. */
const DEFINITION = /^\*\*R(\d+) — /gm
/** A CITATION: the bare token, anywhere. `R33`, `(R24, R70)`, `R33/R18`. */
const CITATION = /\bR(\d+)\b/g

const CONTRACT_SRC = readFileSync(CONTRACT, "utf8")

/** Every rule the contract defines, in the order it defines them. */
function definitions() {
  const out = []
  for (const m of CONTRACT_SRC.matchAll(DEFINITION))
    out.push({
      n: Number(m[1]),
      line: CONTRACT_SRC.slice(0, m.index).split("\n").length,
      // The rule's own headline, so a duplicate failure names the two rules rather than
      // just the number they fight over.
      title: CONTRACT_SRC.slice(m.index + m[0].length, m.index + 200)
        .split("**")[0]
        .replace(/\s+/g, " ")
        .trim(),
    })
  return out
}

const DEFINED = definitions()

/**
 * Where citations can live. Deliberately a whole-repo walk rather than a file list: the last
 * two rules to be cited were cited from `src/` and `.claude/`, neither of which anyone would
 * have thought to add to a list, and a scan that misses a file is a scan that passes.
 */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".adaptv",
  ".next",
  "coverage",
  "ios",
  "android",
  //Playwright's report output: a trace viewer bundle it writes next to the e2e suite, whose
  //minified source cites `R0` by accident. It is generated, transient and nobody's citation —
  //and the walk went red on it for anyone who ran the e2e suite before the gate.
  "playwright-report",
  "test-results",
  "blob-report",
  ".playwright",
  //Cloudflare's dev output under `.project-zero/`: bundled worker source that
  //cites `R0` by accident, the same way the trace viewer above does.
  ".wrangler",
  //Xcode's build output under `.project-zero/`. Same category as the two above —
  //generated, transient, nobody's citation — but it fails differently: its
  //ModuleCache holds absolute symlinks written before this repo was renamed, so
  //they dangle and a `stat` that follows them throws ENOENT mid-walk.
  "DerivedData",
])
const TEXT = new Set([
  ".md",
  ".mjs",
  ".js",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".mts",
])

/**
 * Skipped by path rather than by name, because the name alone is load-bearing
 * elsewhere. `.claude/` is a real citation site — `skills/cli-ux/SKILL.md` cites
 * six rules — so it cannot go in `SKIP_DIRS`; but `.claude/worktrees/` holds whole
 * second checkouts of this repo, and reading those makes the scan report on
 * branches the working tree does not contain. It also reads a *copy* of this file,
 * which quotes retired numbers as examples and is exempted below only by its own
 * exact path.
 */
const SKIP_PATHS = new Set([path.join(".claude", "worktrees")])

function textFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue
    const full = path.join(dir, entry)
    if (SKIP_PATHS.has(path.relative(ROOT, full))) continue
    //`lstat`, not `stat`: a dangling symlink answers the only question asked here
    //("is this a directory to descend into?") without being followed, and a walk
    //that throws on one reports nothing at all about rule numbers. It also means
    //a symlinked directory is not descended into, which is the safe answer — it
    //cannot loop, and no citation site in this repo is reached only that way.
    if (lstatSync(full).isDirectory()) out.push(...textFiles(full))
    else if (TEXT.has(path.extname(entry))) out.push(full)
  }
  return out.sort()
}

/** Every `R<n>` in the repo that is not the contract defining that rule. */
function citations() {
  const defLines = new Set(DEFINED.map((d) => `${CONTRACT}:${d.line}`))
  const out = []
  for (const file of textFiles(ROOT)) {
    // This file is the guard, not a citation site: it quotes retired and mistyped numbers
    // as EXAMPLES, and a scanner that reads its own prose as citations can never fail
    // honestly — it would only ever be reporting itself.
    if (file === fileURLToPath(import.meta.url)) continue
    const src = readFileSync(file, "utf8")
    src.split("\n").forEach((text, i) => {
      if (defLines.has(`${file}:${i + 1}`)) return
      for (const m of text.matchAll(CITATION))
        out.push({
          n: Number(m[1]),
          where: `${path.relative(ROOT, file)}:${i + 1}`,
        })
    })
  }
  return out
}

const CITED = citations()

describe("the CLI contract's rule numbers", () => {
  it("does not read Playwright's report output as citations", () => {
    const root = mkdtempSync(path.join(tmpdir(), "adaptv-rules-"))
    try {
      mkdirSync(path.join(root, "playground", "playwright-report"), {
        recursive: true,
      })
      writeFileSync(
        path.join(root, "playground", "playwright-report", "x.js"),
        "R0",
      )
      mkdirSync(path.join(root, "src"))
      writeFileSync(path.join(root, "src", "ok.ts"), "// R1")
      expect(textFiles(root)).toEqual([path.join(root, "src", "ok.ts")])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("finds the rules at all (the scan itself can rot)", () => {
    // A heading style that drifts would turn this whole file green and useless.
    expect(DEFINED.length).toBeGreaterThanOrEqual(70)
    expect(DEFINED.map((d) => d.n)).toContain(1)
    expect(CITED.length).toBeGreaterThanOrEqual(100)
  })

  it("defines every number exactly once", () => {
    const seen = new Map()
    const clashes = []
    for (const d of DEFINED) {
      const first = seen.get(d.n)
      if (first)
        clashes.push(
          `R${d.n} is defined twice — L${first.line} "${first.title}" and L${d.line} "${d.title}"`,
        )
      else seen.set(d.n, d)
    }
    expect(
      clashes,
      `a citation of these numbers points at either rule, and a reader cannot tell which:\n  ${clashes.join("\n  ")}\n\nGive the less-cited rule a fresh number at the end of the range and update every citation of it.`,
    ).toEqual([])
  })

  it("leaves no hole in the range", () => {
    // A gap is a number that reads as retired but cites as a typo. Deleting a rule means
    // renumbering the last one into its place, not leaving the hole.
    const numbers = new Set(DEFINED.map((d) => d.n))
    const highest = Math.max(...numbers)
    const missing = []
    for (let n = 1; n <= highest; n++)
      if (!numbers.has(n)) missing.push(`R${n}`)
    expect(
      missing,
      `the contract runs R1–R${highest} but defines nothing for ${missing.join(", ")}`,
    ).toEqual([])
  })

  it("is cited nowhere by a number it does not define", () => {
    // Every dangling citation at once, not the first one: a renumber leaves them in a
    // scatter across `bin/`, `docs/` and `.claude/`, and fixing them one run at a time is
    // the same waste R33 refuses in the CLI's own output.
    const numbers = new Set(DEFINED.map((d) => d.n))
    const dangling = CITED.filter((c) => !numbers.has(c.n)).map(
      (c) => `${c.where} cites R${c.n}`,
    )
    expect(
      dangling,
      `these point at a rule the contract does not define — a typo, or a renumber that left the citation behind:\n  ${dangling.join("\n  ")}`,
    ).toEqual([])
  })
})

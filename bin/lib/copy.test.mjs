// @vitest-environment node
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// The house copy rules, enforced over EVERY string the dev can see.
//
// The first version of this only checked the command summaries, on the reasoning that an
// em-dash "earns its place" introducing a list. The owner disagreed, having read
// `'dev' needs a surface — one of web, ios, android, all` on their own terminal. There were 50
// of them. A rule applied to one table and not to the other forty-nine strings is not a rule.
//
// This walks the SOURCE rather than calling the renderer, because the strings live in a dozen
// modules and most need a device, a config or a build to reach.

const BIN = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const FILES = [
  "adaptv.mjs",
  "lib/cli-spec.mjs",
  "lib/cli-help.mjs",
  "lib/render.mjs",
  "lib/preflight.mjs",
  "lib/icons.mjs",
  "lib/icon-gen.mjs",
  "lib/icon-tuning.mjs",
  "lib/icon-preview.mjs",
  "lib/native.mjs",
  "lib/dev-server.mjs",
  "lib/tool-log.mjs",
  "ui/watch.mjs",
  "ui/live.mjs",
]

const LITERAL = /(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g

/** Every string literal in these modules. Comment lines are skipped — they are not output. */
function literals() {
  const out = []
  for (const rel of FILES) {
    const src = readFileSync(path.join(BIN, rel), "utf8")
    src.split("\n").forEach((line, i) => {
      const t = line.trim()
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"))
        return
      for (const m of line.matchAll(LITERAL))
        if (m[2].trim()) out.push({ rel, line: i + 1, text: m[2] })
    })
  }
  return out
}

const ALL = literals()

describe("the copy rules, over every string the dev can see", () => {
  it("finds strings to check at all", () => {
    //A regex that quietly matches nothing would make every test below vacuously pass.
    expect(ALL.length).toBeGreaterThan(200)
  })

  it("uses NO em-dash, anywhere", () => {
    //A colon, a comma, a semicolon or a full stop — each says something an em-dash doesn't,
    //and picking one makes the sentence sharper. `'dev' needs a surface: web, ios, android or
    //all` names a list. `no adaptv.config.ts here. Run from an app root.` is a fact and then
    //an instruction, which is two sentences.
    const bad = ALL.filter((s) => s.text.includes("—"))
    expect(bad.map((b) => `${b.rel}:${b.line}  ${b.text}`)).toEqual([])
  })

  it("uses no marketing filler", () => {
    //No `unlock` or `elevate`: both have literal uses here ("Unlock it and keep it unlocked
    //while installing"), and a rule that flags correct copy is a rule that gets switched off.
    const SLOP =
      /\b(seamless(ly)?|robust|powerful|effortless(ly)?|simply|easily|leverage|utilize|streamline|innovative|comprehensive|blazing|delightful|empower)\b/i
    const bad = ALL.filter((s) => SLOP.test(s.text))
    expect(bad.map((b) => `${b.rel}:${b.line}  ${b.text}`)).toEqual([])
  })

  it("never shouts", () => {
    //An exclamation mark in a CLI is either false cheer or panic. Neither helps.
    const bad = ALL.filter((s) => /\w!(\s|$)/.test(s.text))
    expect(bad.map((b) => `${b.rel}:${b.line}  ${b.text}`)).toEqual([])
  })
})

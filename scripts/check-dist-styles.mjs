/**
 * Check the two shipped stylesheets from a package with no `src/`
 * (docs/decisions/styling.md §0.1, "What follows").
 *
 * 1. `styles.css` (`dist/styles/index.css`) is plain CSS: it bundles with lightningcss —
 *    no Tailwind anywhere — and contains no Tailwind at-rule or function. Tailwind fails
 *    soft on its own syntax and a plain-CSS bundler passes an unknown at-rule through, so
 *    an `@utility` left in `styles.css` would ship and silently do nothing in a plain-CSS
 *    app. Only a scan of the bundle catches that.
 * 2. `tailwind.css` compiles with Tailwind and emits adaptv's utilities and its variants
 *    for classes found in an app's markup.
 *
 * Usage: `node scripts/check-dist-styles.mjs <package dir>` (run by `verify-dist.mjs` on the
 * staged package, whose `node_modules` links the repo's).
 */
import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

const dir = path.resolve(process.argv[2] ?? ".")
const fromPackage = createRequire(path.join(dir, "package.json"))
const problems = []

// ── 1. styles.css, with no Tailwind ──────────────────────────────────────────
/** Tailwind syntax a plain-CSS pipeline does not understand. */
const TAILWIND_SYNTAX = [
  /@utility\b/,
  /@custom-variant\b/,
  /@variant\b/,
  /@theme\b/,
  /@source\b/,
  /@apply\b/,
  /@plugin\b/,
  /@config\b/,
  /@reference\b/,
  /@tailwind\b/,
  /--spacing\(/,
  /--value\(/,
  /--modifier\(/,
  /\btheme\(/,
]

const { bundle } = await import(
  pathToFileURL(fromPackage.resolve("lightningcss")).href
)
let plain = ""
try {
  plain = bundle({
    filename: path.join(dir, "dist/styles/index.css"),
    errorRecovery: false,
  }).code.toString()
} catch (error) {
  problems.push(
    `styles.css does not bundle as plain CSS: ${error.message}`,
  )
}
//comments may name the syntax (they explain where it moved); rules may not
const rules = plain.replace(/\/\*[\s\S]*?\*\//g, "")
for (const pattern of TAILWIND_SYNTAX) {
  const at = rules.search(pattern)
  if (at !== -1)
    problems.push(
      `styles.css contains Tailwind syntax: ${rules.slice(at, at + 60).split("\n")[0]}`,
    )
}
for (const name of ["selectable", "scrollbar-hidden", "scrollbar-visible"])
  if (!rules.includes(`.${name}`))
    problems.push(`styles.css lost the plain \`.${name}\` class`)

// ── 2. tailwind.css, with Tailwind ───────────────────────────────────────────
// `@tailwindcss/node` is `@tailwindcss/vite`'s own dep, not the repo's, so resolve it
// from where pnpm put the plugin.
const fromPlugin = createRequire(
  realpathSync(
    path.join(dir, "node_modules/@tailwindcss/vite/package.json"),
  ),
)
const { compile } = await import(
  pathToFileURL(fromPlugin.resolve("@tailwindcss/node")).href
)

/** A class an app would write, and a fragment of the rule Tailwind must emit for it. */
const PROBES = [
  ["pb-safe-or-4", "max(var(--adaptv-inset-bottom"],
  ["md:scrollbar-hidden", "scrollbar-width: none"],
  ["app:p-safe", "display-mode: standalone"],
  ["web:selectable", 'data-adaptv-platform="web"'],
  ["dark:block", ".dark"],
  ["hover:underline", ":hover:not("],
  ["active:scale-95", "[data-pressed]"],
]

const compiler = await compile(
  `@import "tailwindcss" source(none);\n@import "./dist/styles/tailwind.css";\n`,
  { base: dir, onDependency: () => {} },
)
const css = compiler.build(PROBES.map(([candidate]) => candidate))
for (const [candidate, fragment] of PROBES) {
  const selector = `.${candidate.replaceAll(":", "\\:")}`
  if (!css.includes(selector))
    problems.push(`tailwind.css: \`${candidate}\` emits no rule`)
  else if (!css.includes(fragment))
    problems.push(`tailwind.css: \`${candidate}\` lacks \`${fragment}\``)
}
//tailwind.css carries all of styles.css: one adaptv rule proves the import resolved
if (!css.includes("--adaptv-inset-top:"))
  problems.push("tailwind.css does not import styles.css")

for (const p of problems) console.error(`✘ ${p}`)
process.exit(problems.length ? 1 : 0)

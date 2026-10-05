/**
 * Compile the shipped stylesheet the way an app's Tailwind does, from a package with no
 * `src/`, and fail when a class only an adaptv component uses is missing from the output.
 *
 * `dist/styles/index.css` is a copy of `src/styles/index.css`, so its `@source` glob has to
 * match what ships, not what the checkout holds. When it doesn't, nothing errors: the app's
 * CSS just lacks every class adaptv's components use. Typecheck and publint can't see that.
 *
 * Usage: `node scripts/check-dist-styles.mjs <package dir>` (run by `verify-dist.mjs` on the
 * staged package, whose `node_modules` links the repo's).
 */
import { realpathSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

const dir = path.resolve(process.argv[2] ?? ".")
// `@tailwindcss/node` and `@tailwindcss/oxide` are `@tailwindcss/vite`'s own deps, not
// the repo's, so resolve them from where pnpm put the plugin.
const fromPlugin = createRequire(
  realpathSync(
    path.join(dir, "node_modules/@tailwindcss/vite/package.json"),
  ),
)
const load = (name) => import(pathToFileURL(fromPlugin.resolve(name)).href)
const { compile } = await load("@tailwindcss/node")
const { Scanner } = await load("@tailwindcss/oxide")

/**
 * Utilities that reach an app's CSS only through adaptv's `@source`: each one appears in a
 * component, not in the stylesheet itself.
 */
const PROBES = [
  "active:scale-95", // components/button.tsx
  "pb-safe-or-4", // an adaptv `@utility`, named in hooks/use-insets.ts
]

// `source(none)` turns off Tailwind's own detection, which would otherwise scan this
// whole directory and hide a broken `@source`.
const entry = `@import "tailwindcss" source(none);
@import "./dist/styles/index.css";
`
const compiler = await compile(entry, {
  base: dir,
  onDependency: () => {},
})
const scanner = new Scanner({ sources: compiler.sources })
const css = compiler.build(scanner.scan())

const scanned = scanner.files.map((f) => path.relative(dir, f))
const missing = PROBES.filter(
  (c) => !css.includes(`.${c.replaceAll(":", "\\:")}`),
)
const fromCli = scanned.filter((f) =>
  f.startsWith(path.join("dist", "cli") + path.sep),
)

if (scanned.length === 0)
  console.error("✘ the stylesheet's @source scans no file")
for (const c of missing)
  console.error(`✘ \`${c}\` is not in the compiled CSS`)
if (fromCli.length)
  console.error("✘ the stylesheet scans dist/cli:", fromCli[0])
process.exit(scanned.length && !missing.length && !fromCli.length ? 0 : 1)

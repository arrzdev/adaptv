/**
 * Prove `dist/` is publish-correct — WITHOUT flipping the live package off source.
 *
 * The repo's `package.json` still resolves `@arrzdev/adaptv/*` to `src/` (the
 * inner-loop dev workflow depends on it — see `tsdown.config.ts`). So this stages
 * a throwaway "publish view" whose `exports` point at `dist/`, and runs the same
 * validators a publish would. The exports map below is therefore also the SPEC the
 * eventual cutover hand-writes into `package.json` (§6.2: "hand-write the exports
 * map … let publint + attw police it" — auto-`exports: true` silently drops all
 * but the last build in an array config).
 *
 * Run after `pnpm build`. Exits non-zero on any real problem.
 */
import { execFileSync } from "node:child_process"
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const repo = process.cwd()
const pkg = JSON.parse(
  readFileSync(path.join(repo, "package.json"), "utf8"),
)

/** Every JS/TS subpath, `.mjs` + `.d.mts` (types first, per Node's own advice). */
const jsEntries = [
  "shell",
  "router",
  "config",
  "components",
  "hooks",
  "capabilities",
  "storage",
  "ota",
  "routes",
  "utils",
  "sw",
  "vite",
]
const publishExports = {
  "./package.json": "./package.json",
  "./biome-shared.json": "./biome-shared.json",
  // Ambient route factories — types-only, no runtime.
  "./route-globals": "./dist/route-globals.d.ts",
  // Plain CSS, consumed via `@import`; attw can't model it, so it's excluded below.
  "./styles.css": "./dist/styles/index.css",
}
for (const e of jsEntries) {
  publishExports[`./${e}`] = {
    types: `./dist/${e}.d.mts`,
    default: `./dist/${e}.mjs`,
  }
}

// ── 1. Structural invariants the validators don't cover ──────────────────────
const problems = []
const read = (p) => readFileSync(path.join(repo, p), "utf8")
const browser = [
  "shell",
  "router",
  "components",
  "hooks",
  "capabilities",
  "storage",
  "ota",
  "routes",
  "utils",
]
const node = ["vite", "sw", "config"]

for (const e of [...browser, ...node]) {
  for (const ext of ["mjs", "d.mts"]) {
    try {
      read(`dist/${e}.${ext}`)
    } catch {
      problems.push(`missing dist/${e}.${ext}`)
    }
  }
}
// 🚨 §6.2: Rolldown drops `"use client"` from non-entry modules in bundle mode.
// The banner re-asserts it — on the browser build ONLY.
for (const e of browser) {
  if (!read(`dist/${e}.mjs`).startsWith('"use client"'))
    problems.push(`${e}.mjs missing "use client"`)
}
for (const e of node) {
  if (read(`dist/${e}.mjs`).startsWith('"use client"'))
    problems.push(`${e}.mjs must NOT carry "use client"`)
}
// `index.css`'s relative `@import`s must resolve to co-located siblings.
for (const css of ["index", "patches", "drawer", "swipeable", "utils"]) {
  try {
    read(`dist/styles/${css}.css`)
  } catch {
    problems.push(`missing dist/styles/${css}.css`)
  }
}

if (problems.length) {
  console.error("✘ structural checks failed:")
  for (const p of problems) console.error("  -", p)
  process.exit(1)
}
console.log(
  "✔ structural checks:",
  browser.length + node.length,
  "entries, banners, styles",
)

// ── 2. publint + attw against a staged publish view ──────────────────────────
const staged = {
  name: pkg.name,
  version: pkg.version,
  type: "module",
  sideEffects: pkg.sideEffects,
  bin: pkg.bin,
  peerDependencies: pkg.peerDependencies,
  peerDependenciesMeta: pkg.peerDependenciesMeta,
  dependencies: pkg.dependencies,
  exports: publishExports,
  files: [
    "dist",
    "bin",
    "patches",
    "biome-shared.json",
    "THIRD_PARTY_LICENSES",
  ],
}
const dir = mkdtempSync(path.join(tmpdir(), "adaptv-publish-"))
for (const f of staged.files)
  cpSync(path.join(repo, f), path.join(dir, f), { recursive: true })
writeFileSync(
  path.join(dir, "package.json"),
  JSON.stringify(staged, null, 2),
)

const bin = (name) => path.join(repo, "node_modules", ".bin", name)
function run(label, cmd, args) {
  try {
    execFileSync(cmd, args, { cwd: dir, stdio: "inherit" })
    console.log(`✔ ${label}`)
    return true
  } catch {
    console.error(`✘ ${label} failed`)
    return false
  }
}

const okPublint = run("publint", bin("publint"), ["--strict"])
const okAttw = run("attw", bin("attw"), [
  "--pack",
  "--profile",
  "node16",
  // adaptv is ESM-only by design (`type: module`, no CJS build — §6.2); the
  // `cjs-resolves-to-esm` note is expected, not a defect. `./styles.css` is CSS,
  // which attw can't resolve as JS/types.
  "--ignore-rules",
  "cjs-resolves-to-esm",
  "--exclude-entrypoints",
  "styles.css",
])

process.exit(okPublint && okAttw ? 0 : 1)

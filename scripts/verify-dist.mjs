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
import {
  closeSync,
  cpSync,
  mkdtempSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
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

/**
 * The ONE import in `dist/*.d.mts` that is supposed to be unresolvable inside the
 * package, and therefore the only `InternalResolutionError` allowed through.
 *
 * `#adaptv-route-tree` is the CONSUMER's generated route tree. adaptv stamps the
 * `tsconfig.paths` entry into the app, and that indirection is what gives `getRouter`
 * the app's real tree instead of `AnyRoute` — verified against a dist-shaped fixture.
 * attw analyses the tarball in isolation, where no app exists, so it can only ever
 * report this one as broken.
 *
 * ⚠︎ The obvious silencer — a `#adaptv-route-tree` entry in the package's own `imports`
 * map — was measured and REJECTED. It resolves, and the consumer's `paths` still wins,
 * so the types stay correct — but an app whose mapping never got stamped would then
 * silently fall back to the stub's `AnyRoute` instead of failing with "cannot find
 * module". Silent widening is the exact bug this area was fixed for; the loud failure
 * is the feature. → src/routes/route-tree-stub.d.ts
 */
const APP_SUPPLIED_SPECIFIER = "#adaptv-route-tree"

// adaptv is ESM-only by design (`type: module`, no CJS build — §6.2), so
// `cjs-resolves-to-esm` is expected rather than a defect; `./styles.css` is CSS, which
// attw cannot resolve as JS/types.
// ⚠︎ `--ignore-rules` is VARIADIC, not comma-separated — `"a,b"` parses as one unknown
// rule name, so nothing gets ignored and the check fails with everything still reported.
const attwArgs = (...extraIgnoreRules) => [
  "--pack",
  "--profile",
  "node16",
  //`--ignore-rules` is variadic, so every rule name must sit INSIDE this group,
  //before the next flag — appending one at the end of the array silently feeds it
  //to `--exclude-entrypoints` instead.
  "--ignore-rules",
  "cjs-resolves-to-esm",
  ...extraIgnoreRules,
  "--exclude-entrypoints",
  "styles.css",
]

/**
 * Audit the ignored rule instead of trusting it.
 *
 * `internal-resolution-error` has to be waved through for the specifier above, but a
 * blanket `--ignore-rules internal-resolution-error` would equally hide a REAL dist
 * packaging break — a chunk that failed to emit, an entry pointing at a file that isn't
 * there. So the rule is switched off for the exit code and re-checked here against an
 * allow-list of exactly one specifier. Anything else fails the build, named.
 */
function attwInternalResolutionOk() {
  //⚠︎ NOT `execFileSync` + captured stdout. attw exits non-zero whenever it reports
  //anything — including the entries we deliberately allow — and on that path Node
  //hands back an `err.stdout` truncated to the 64 KiB pipe buffer no matter what
  //`maxBuffer` says. The report is ~280 KiB, so it arrived as invalid JSON and the
  //audit "failed" for a reason that had nothing to do with the package. Writing
  //straight to a file descriptor sidesteps the buffer entirely.
  const reportPath = path.join(tmpdir(), "adaptv-attw-report.json")
  const fd = openSync(reportPath, "w")
  try {
    execFileSync(bin("attw"), [...attwArgs(), "-f", "json"], {
      cwd: dir,
      stdio: ["ignore", fd, "inherit"],
    })
  } catch {
    //expected: any reported problem is a non-zero exit. The report still got written.
  } finally {
    closeSync(fd)
  }
  let report
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8")).problems ?? {}
  } catch {
    console.error("✘ attw audit failed: no parseable JSON report")
    return false
  }
  const unexpected = (report.InternalResolutionError ?? []).filter(
    (p) => p.moduleSpecifier !== APP_SUPPLIED_SPECIFIER,
  )
  if (unexpected.length === 0) return true
  console.error(
    "✘ attw audit: unresolvable imports in the published types —",
  )
  for (const p of unexpected)
    console.error(`  - ${p.moduleSpecifier} (${p.entrypoint ?? "?"})`)
  return false
}

const okPublint = run("publint", bin("publint"), ["--strict"])
const okAttw = run(
  "attw",
  bin("attw"),
  attwArgs("internal-resolution-error"),
)
const okAudit = attwInternalResolutionOk()
if (okAudit)
  console.log("✔ attw audit: only the app-supplied route tree is open")

process.exit(okPublint && okAttw && okAudit ? 0 : 1)

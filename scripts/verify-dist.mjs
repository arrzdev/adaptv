/**
 * Prove `dist/` is publish-correct: that it holds every file `package.json` `exports`
 * names, and that the package passes the validators a publish would.
 *
 * `exports` is hand-written (§6.2: "hand-write the exports map … let publint + attw
 * police it" — auto-`exports: true` silently drops all but the last build in an array
 * config), so this reads it verbatim and stages the package exactly as `files` ships it:
 * no `src/`.
 *
 * Run after `pnpm build`. Exits non-zero on any real problem.
 */
import { execFileSync } from "node:child_process"
import {
  appendFileSync,
  closeSync,
  cpSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const repo = process.cwd()
const pkg = JSON.parse(
  readFileSync(path.join(repo, "package.json"), "utf8"),
)

/**
 * The subpaths that are NOT JavaScript, each with the one shape it publishes as.
 *
 * These are listed rather than derived because each one is a different kind of file with a
 * different destination, and there is nothing in `exports` that says which. Everything not
 * named here is a JS entry — so a new subpath is checked by default, and forgetting it is
 * not one of the available outcomes.
 */
const rootFile = {
  //Copied verbatim into the tarball; `staged.files` below is what puts them there.
  "./package.json": "package.json",
  "./biome-shared.json": "biome-shared.json",
}
/** Ambient route factories — types-only, no runtime. Hand-authored, copied by tsdown. */
const typesOnly = {
  "./route-globals": "dist/interface/route-globals.d.ts",
}
/** Plain CSS, consumed via `@import`; attw can't model it, so it's excluded below. */
const stylesheet = { "./styles.css": "dist/styles/index.css" }

/**
 * Every JS/TS subpath, `.mjs` + `.d.mts` (types first, per Node's own advice) — read
 * from `package.json` `exports`, never listed again here.
 *
 * It was listed, and it had already gone wrong: `exports` published `./root-route` and
 * `./server-entry`, this file knew about neither, and `./server-entry` had no dist entry in
 * `tsdown.config.ts` at all. A script whose whole purpose is to prove `dist/` matches what
 * the package promises was reporting green over a promised subpath that was never built —
 * the exact failure it exists to catch, invisible because the spec it checked against was a
 * second copy of the map instead of the map.
 */
const jsEntries = Object.keys(pkg.exports)
  .filter((k) => !(k in rootFile || k in typesOnly || k in stylesheet))
  .map((k) => k.replace(/^\.\//, ""))

// ── 1. Structural invariants the validators don't cover ──────────────────────
const problems = []
const read = (p) => readFileSync(path.join(repo, p), "utf8")

for (const e of jsEntries) {
  const target = pkg.exports[`./${e}`]
  if (
    target?.types !== `./dist/${e}.d.mts` ||
    target?.default !== `./dist/${e}.mjs`
  )
    problems.push(
      `exports './${e}' must be { types: ./dist/${e}.d.mts, default: ./dist/${e}.mjs }`,
    )
}
for (const [subpath, file] of Object.entries({
  ...rootFile,
  ...typesOnly,
  ...stylesheet,
}))
  if (pkg.exports[subpath] !== `./${file}`)
    problems.push(`exports '${subpath}' must be ./${file}`)

/**
 * Which runtime each entry is for — the ONE thing `exports` cannot say, and the reason these
 * three lists are still written out. They mirror the three build objects in
 * `tsdown.config.ts` one for one.
 *
 * `root-route` is a React module the generated route tree imports at runtime, so it belongs
 * with the client surface; `server-entry` is the Cloudflare Worker handler and belongs with
 * neither — it is not Node, and a `"use client"` banner on the module a Worker boots from is
 * backwards. The guard below is what keeps the lists honest: an entry in `exports` and in
 * none of them is a problem, not an omission, so the next subpath cannot be quietly skipped
 * the way these two were.
 */
const browser = [
  "shell",
  "router",
  "root-route",
  "components",
  "hooks",
  "capabilities",
  "storage",
  "ota",
  "routes",
  "utils",
]
const node = ["vite", "sw", "config"]
const worker = ["server-entry"]
const classified = [...browser, ...node, ...worker]

for (const e of jsEntries) {
  if (!classified.includes(e))
    problems.push(
      `exports publishes './${e}' — say which runtime it is for in scripts/verify-dist.mjs`,
    )
  for (const ext of ["mjs", "d.mts"]) {
    try {
      read(`dist/${e}.${ext}`)
    } catch {
      problems.push(`missing dist/${e}.${ext}`)
    }
  }
}
for (const e of classified)
  if (!jsEntries.includes(e))
    problems.push(
      `'${e}' is classified here but exports no longer publishes it`,
    )
// The non-JS subpaths get their own existence check — omitting one is not an exemption.
for (const [subpath, file] of Object.entries({
  ...rootFile,
  ...typesOnly,
  ...stylesheet,
})) {
  try {
    read(file)
  } catch {
    problems.push(`missing ${file} (exports ${subpath})`)
  }
}
// 🚨 §6.2: Rolldown drops `"use client"` from non-entry modules in bundle mode.
// The banner re-asserts it — on the browser build ONLY.
// An entry that was never emitted is already reported above; reading it here would throw
// over the top of that and lose every other problem in the list.
const emitted = (e) => {
  try {
    return read(`dist/${e}.mjs`)
  } catch {
    return null
  }
}
for (const e of browser) {
  if (emitted(e)?.startsWith('"use client"') === false)
    problems.push(`${e}.mjs missing "use client"`)
}
for (const e of [...node, ...worker]) {
  if (emitted(e)?.startsWith('"use client"'))
    problems.push(`${e}.mjs must NOT carry "use client"`)
}
// A file located relative to the module that asks for it holds in `src/` and nowhere else:
// bundled into `dist/vite.mjs` or `dist/cli/**`, `../routes/x.tsx` and `../..` point past
// the package. `src/vite/package-files.ts` is the one place adaptv finds its own files.
const builtModules = readdirSync(path.join(repo, "dist"), {
  recursive: true,
})
  .filter((f) => f.endsWith(".mjs"))
  .map((f) => path.join("dist", f))
for (const file of builtModules)
  for (const [ref] of read(file).matchAll(
    /new URL\(\s*["'`]\.{1,2}\/[^"'`]*["'`]\s*,\s*import\.meta\.url\s*\)/g,
  ))
    problems.push(
      `${file} resolves ${ref} — use src/vite/package-files.ts`,
    )
// `index.css`'s relative `@import`s must resolve to co-located siblings.
for (const css of ["index", "patches", "drawer", "swipeable", "utils"]) {
  try {
    read(`dist/styles/${css}.css`)
  } catch {
    problems.push(`missing dist/styles/${css}.css`)
  }
}

/**
 * One row per check in the CI job summary, so publint and attw read as their own lines next to
 * the gate mode instead of being buried in the step log. A no-op outside Actions.
 */
function summarise(rows) {
  const file = process.env.GITHUB_STEP_SUMMARY
  if (!file) return
  const lines = rows.map(
    ([label, ok]) => `| ${label} | ${ok ? "✔ pass" : "✘ fail"} |`,
  )
  appendFileSync(
    file,
    ["", "| Publish check | Result |", "| --- | --- |", ...lines, ""].join(
      "\n",
    ),
  )
}

if (problems.length) {
  console.error("✘ structural checks failed:")
  for (const p of problems) console.error("  -", p)
  summarise([["dist structure", false]])
  process.exit(1)
}
console.log(
  "✔ structural checks:",
  jsEntries.length,
  "entries, banners, styles",
)

// ── 2. publint + attw against the package as `files` ships it ─────────────────
const staged = { ...pkg, scripts: undefined, devDependencies: undefined }
//One throwaway directory holds the staged package and attw's report, and it goes on
//every way out — a pass, a failure, or a throw — so a check run on every build does not
//leave a copy of the package behind in the OS temp dir each time.
const work = mkdtempSync(path.join(tmpdir(), "adaptv-publish-"))
process.on("exit", () => rmSync(work, { recursive: true, force: true }))
const dir = path.join(work, "package")
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
  const reportPath = path.join(work, "attw-report.json")
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

// ── 3. The CLI runs from what is published ───────────────────────────────────
// The staged package has no `src/`, so `loadAdaptvModule` takes its `dist/cli/` path here,
// for every module the CLI can ask for: one missing from the build, or one that throws when
// loaded from there, fails now instead of on a user's machine. The repo's `node_modules`
// stands in for the install, linked in only after attw has packed the directory.
symlinkSync(
  path.join(repo, "node_modules"),
  path.join(dir, "node_modules"),
  "dir",
)
const okCli = run("cli modules load from dist/cli", process.execPath, [
  "--input-type=module",
  "-e",
  `import { CLI_MODULES } from "./bin/lib/cli-modules.mjs"
import { frameworkLayout, loadAdaptvModule } from "./bin/lib/load-ts.mjs"
if (frameworkLayout() !== "dist") throw new Error("the staged package has a src/")
for (const m of CLI_MODULES) await loadAdaptvModule(m)`,
])

summarise([
  ["dist structure", true],
  ["publint --strict", okPublint],
  ["attw (node16 profile)", okAttw],
  ["attw audit (only `#adaptv-route-tree` unresolved)", okAudit],
  ["cli modules load from dist/cli", okCli],
])
process.exit(okPublint && okAttw && okAudit && okCli ? 0 : 1)

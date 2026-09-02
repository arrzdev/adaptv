import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

/*
 * The execution boundary — the one invariant `tsdown.config.ts` states and
 * nothing enforced.
 *
 * `tsdown.config.ts` builds two bundles from one package: a `platform: "browser"`
 * one for everything a component tree imports at runtime, and a `platform: "node"`
 * one for the build-time tools. A `node:*` import that reaches the browser build
 * either fails it outright (`Could not resolve 'node:fs'`) or, on a bundler in a
 * more forgiving mood, ships. The config says why that is safe today — "every
 * browser-surface import of a `config/*` module is `import type` (erased at
 * build), so no browser entry drags a `node:` builtin into its graph" — and that
 * sentence was hand-verified by a human reading the tree once.
 *
 * This is that sentence as a gate. → `docs/roadmap/src-reorg.md` §0.5 move A.
 *
 * Two checks, because neither one alone covers the tree:
 *
 *  - **The allow-list** names every directory and file permitted to touch Node.
 *    It covers all 227 non-test source files, including the 28 that no published
 *    entry imports — `src/sw/default-worker.ts` and `src/routes/client-entry.tsx`
 *    reach a browser as *files the CLI hands to Vite*, so an import graph never
 *    sees them and a reachability check alone would wave them through.
 *  - **The browser closure** walks the real import graph from the browser entries
 *    and demands zero `node:*` in it. That one cannot be quietly widened: a new
 *    line in the allow-list does not buy anything a browser entry can reach.
 *
 * ## Two decisions this file makes, deliberately
 *
 * **`*.test.ts` and `*.test.tsx` are exempt from the allow-list; nothing else is.**
 * A test never ships, so `node:fs` in one is free — but "exempt every file whose
 * name ends in `.test.ts`" is how a real violation hides behind a filename. So the
 * exemption is not taken on trust: `no test file is reachable from a published
 * entry` below proves the premise, and the moment a shipped module imports one,
 * that test fails and the exemption stops applying to it. Note that
 * `*.test-helper.ts` and `src/test-utils/` are **not** exempt — they are plain
 * modules that anything may import, so each is named in the allow-list like any
 * other Node-touching file, and the same test proves no entry reaches them.
 *
 * **The browser surface is read off `tsdown.config.ts` and `package.json`, not off
 * directory names.** `the entry lists match the build` below re-derives both entry
 * sets from those two files, so adding an entry to either one fails here until it
 * is classified.
 */

const ROOT = process.cwd()
const SRC = path.join(ROOT, "src")
const rel = (file: string) => path.relative(ROOT, file)

/**
 * The `platform: "browser"` entries of `tsdown.config.ts`, plus `./server-entry`.
 *
 * `server-entry` is the fourth face (a Cloudflare Worker). `tsdown.config.ts`
 * builds it from its own `workerEntry` — not `browserEntry`, whose `"use client"`
 * banner is backwards on the module a Worker boots from, and not `nodeEntry`,
 * because a Worker is not Node. It has no `node:fs` either, so it is classified
 * on this side of the line.
 */
const BROWSER_ENTRIES = [
  "src/interface/shell.index.ts",
  "src/interface/router.index.ts",
  "src/routes/root-route.tsx",
  "src/interface/components.index.ts",
  "src/interface/hooks.index.ts",
  "src/interface/capabilities.index.ts",
  "src/interface/storage.index.ts",
  "src/interface/ota.index.ts",
  "src/interface/routes.index.ts",
  "src/interface/utils.index.ts",
  "src/interface/server-entry.ts",
]

/** The `platform: "node"` entries — build-time tools and the SW toolkit. */
const NODE_ENTRIES = [
  "src/interface/vite.index.ts",
  "src/interface/sw.index.ts",
  "src/interface/config.index.ts",
]

/**
 * Every file allowed to import a `node:*` builtin. Each entry is a *face*, not a
 * convenience: these run on the developer's machine, inside Vite or the CLI, and
 * never enter a bundle.
 *
 * `src/ota/` is the sharp one, and the OTA slice made it sharper: it is now a
 * three-part directory — `src/ota/build/` runs on the dev's machine, the files
 * beside it (`updater.ts`, `use-ota-updates.ts`) are browser code, and
 * `src/interface/ota.index.ts` is a **browser** tsdown entry pointed straight at
 * that directory. It is safe only because the barrel is curated and exports
 * neither `native-fingerprint` nor anything under `build/` — which
 * `src/interface/ota.barrel.test.ts` asserts by name, so this file is not the
 * only thing standing on it.
 * → `docs/roadmap/src-reorg.md` §0.1, §2.2
 *
 * Note what is NOT written here: `src/ota/`. The two entries below name the
 * build face and the one stray Node file by their exact paths, so the browser
 * half of the same directory stays covered by the allow-list.
 */
const NODE_ALLOWED = [
  "src/vite/",
  "src/native/",
  "src/ota/build/",
  "src/ota/native-fingerprint.ts",
  "src/styles/compile.test-helper.ts",
  //the barrel guards' shared walk — a plain module the tests import, named by
  //file rather than as `src/test-utils/` so a second file there is a decision
  "src/test-utils/barrel-guard.ts",
]

const isTest = (file: string) => /\.test\.tsx?$/.test(file)

/** Every `.ts`/`.tsx` under `src/`, repo-relative and sorted. */
function sourceFiles(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (/\.tsx?$/.test(entry.name)) found.push(rel(full))
    }
  }
  walk(SRC)
  return found.sort()
}

/**
 * Comments and template literals out; quoted strings — the specifiers — kept.
 *
 * One left-to-right pass over strings *and* comments together, because the two
 * nest into each other both ways and a two-pass strip gets it wrong: `platform.ts`
 * opens a line comment with `//**There is deliberately NO cross-product**`, and a
 * block-comment pass run first reads the `/*` inside it and swallows the next 18
 * lines — including the file's only `config/*` import. Whichever token starts
 * first wins, which is what a compiler does.
 *
 * Template literals are blanked rather than kept: `boot-fallback-prerender.ts`
 * emits `import … from "node:module"` as generated source inside one, and that is
 * a string, not this file's import.
 */
function code(source: string): string {
  const token =
    /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g
  return source.replace(token, (match) => {
    if (match.startsWith('"') || match.startsWith("'")) return match
    if (match.startsWith("`")) return "``"
    //keep the newlines a block comment spanned, so nothing joins across it
    return match.startsWith("//") ? "" : match.replace(/[^\n]/g, "")
  })
}

type ImportRef = { spec: string; typeOnly: boolean }

/**
 * The import specifiers of one file.
 *
 * Statement-shaped rather than line-shaped, so a multi-line `import type { … }`
 * is one import: the head between `import` and `from` may not contain a quote or
 * a semicolon, which is what stops a match running past the end of one statement
 * into the next one's specifier.
 *
 * `import type` and `export type` are the only forms counted as type-only. An
 * inline `import { type X }` is deliberately not — biome's `useImportType` is set
 * to `separatedType`, so that form does not exist here, and the assertion below is
 * about a specifier that is erased whole.
 */
function importsOf(file: string): ImportRef[] {
  const source = code(readFileSync(path.join(ROOT, file), "utf8"))
  const refs: ImportRef[] = []
  const withFrom =
    /(?:^|[\s;}])((?:import|export)\s+(?:[^;'"]*?))\bfrom\s*["']([^"']+)["']/g
  for (const match of source.matchAll(withFrom)) {
    refs.push({
      spec: match[2],
      typeOnly: /^(?:import|export)\s+type\b/.test(match[1].trim()),
    })
  }
  const sideEffect = /(?:^|[\s;}])import\s*["']([^"']+)["']/g
  for (const match of source.matchAll(sideEffect)) {
    refs.push({ spec: match[1], typeOnly: false })
  }
  const dynamic = /import\s*\(\s*["']([^"']+)["']\s*\)/g
  for (const match of source.matchAll(dynamic)) {
    refs.push({ spec: match[1], typeOnly: false })
  }
  return refs
}

/**
 * A specifier to a repo-relative file, or `null` when it leaves `src/` — a bare
 * package, `virtual:adaptv/*`, `#adaptv-route-tree`, a `node:` builtin.
 */
function resolveSpec(spec: string, from: string): string | null {
  let base: string
  if (spec.startsWith("#adaptv/")) {
    base = path.join(SRC, spec.slice("#adaptv/".length))
  } else if (spec.startsWith("./") || spec.startsWith("../")) {
    base = path.resolve(path.dirname(path.join(ROOT, from)), spec)
  } else {
    return null
  }
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    `${base}.d.ts`,
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return rel(candidate)
    }
  }
  return null
}

/** Every file an entry set reaches, transitively, through real imports. */
function closureOf(entries: string[]): string[] {
  const seen = new Set<string>()
  const pending = [...entries]
  while (pending.length) {
    const file = pending.pop()
    if (!file || seen.has(file)) continue
    seen.add(file)
    for (const { spec } of importsOf(file)) {
      const target = resolveSpec(spec, file)
      if (target && !seen.has(target)) pending.push(target)
    }
  }
  return [...seen].sort()
}

const ALL = sourceFiles()
const BROWSER_CLOSURE = closureOf(BROWSER_ENTRIES)
const NODE_CLOSURE = closureOf(NODE_ENTRIES)

describe("execution boundary", () => {
  /*
   * The vacuous pass this file exists to avoid. A directory-scanning guard that
   * is pointed at nothing compares two empty lists and goes green — every
   * assertion below is `toEqual([])`, so a walk that rots silently reports
   * perfect compliance. → `docs/roadmap/src-reorg.md` §7
   *
   * The floors are well under today's numbers (227 non-test files, a 154-file
   * browser closure, a 79-file node closure) and well over zero.
   */
  it("actually walked the tree it claims to have walked", () => {
    expect(ALL.length).toBeGreaterThan(300)
    expect(ALL.filter((f) => !isTest(f)).length).toBeGreaterThan(200)
    expect(BROWSER_CLOSURE.length).toBeGreaterThan(120)
    expect(NODE_CLOSURE.length).toBeGreaterThan(60)
    for (const entry of [...BROWSER_ENTRIES, ...NODE_ENTRIES]) {
      expect(existsSync(path.join(ROOT, entry)), entry).toBe(true)
    }
  })

  /*
   * The entry lists above are the definition of "browser surface" this file
   * works from, so they are re-derived rather than trusted. Adding an entry to
   * `tsdown.config.ts` or a subpath to `package.json` fails here until someone
   * says which side of the boundary it is on.
   */
  it("keeps the entry lists matching the build", () => {
    const config = code(
      readFileSync(path.join(ROOT, "tsdown.config.ts"), "utf8"),
    )
    const entriesIn = (name: string) => {
      const block = new RegExp(
        `const ${name} = \\{([\\s\\S]*?)\\n\\}`,
      ).exec(config)
      expect(block, `${name} not found in tsdown.config.ts`).not.toBeNull()
      return [...(block?.[1] ?? "").matchAll(/"(src\/[^"]+)"/g)]
        .map((m) => m[1])
        .sort()
    }

    //`server-entry` is the one browser-side entry built outside `browserEntry`
    expect(entriesIn("browserEntry")).toEqual(
      BROWSER_ENTRIES.filter(
        (e) => e !== "src/interface/server-entry.ts",
      ).sort(),
    )
    expect(entriesIn("workerEntry")).toEqual([
      "src/interface/server-entry.ts",
    ])
    expect(entriesIn("nodeEntry")).toEqual([...NODE_ENTRIES].sort())

    const pkg = JSON.parse(
      readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ) as { exports: Record<string, string> }
    const exported = Object.values(pkg.exports)
      .map((target) => target.replace(/^\.\//, ""))
      .filter(
        (target) => /\.tsx?$/.test(target) && !target.endsWith(".d.ts"),
      )
      .sort()
    expect(exported).toEqual([...BROWSER_ENTRIES, ...NODE_ENTRIES].sort())
  })

  /*
   * The allow-list. Every non-test file in `src/`, including the ones no entry
   * imports — the SW modules and `client-entry.tsx` reach a browser by path
   * rather than by import, and are invisible to the closure check below.
   */
  it("keeps node: imports inside the build-time allow-list", () => {
    const violations: string[] = []
    for (const file of ALL) {
      if (isTest(file)) continue
      if (NODE_ALLOWED.some((allowed) => file.startsWith(allowed)))
        continue
      for (const { spec } of importsOf(file)) {
        if (spec.startsWith("node:")) violations.push(`${file} → ${spec}`)
      }
    }
    expect(violations).toEqual([])
  })

  /*
   * The check an allow-list edit cannot buy off. `tsdown.config.ts`'s browser
   * build is exactly this graph; a `node:*` anywhere in it is the failure the
   * comment in that file describes.
   */
  it("keeps every node: import out of the browser build graph", () => {
    const violations: string[] = []
    for (const file of BROWSER_CLOSURE) {
      for (const { spec } of importsOf(file)) {
        if (spec.startsWith("node:")) violations.push(`${file} → ${spec}`)
      }
    }
    expect(violations).toEqual([])
  })

  /*
   * What makes exempting `*.test.ts` from the allow-list safe: no published
   * entry can reach one. Both closures, because a test dragged into the node
   * build would be just as wrong — it would ship `vitest` to a consumer.
   */
  it("keeps test files out of every published entry graph", () => {
    const shipped = [...BROWSER_CLOSURE, ...NODE_CLOSURE]
    expect(shipped.filter(isTest)).toEqual([])
    expect(shipped.filter((f) => f.includes(".test-helper."))).toEqual([])
    expect(shipped.filter((f) => f.startsWith("src/test-utils/"))).toEqual(
      [],
    )
  })

  /*
   * The second half of `tsdown.config.ts`'s claim. `src/config/` is built as a
   * **Node** entry, so a single value import of it from the browser graph — one
   * `import { defineApp }` where `import type` was meant — pulls the loader, and
   * with it `node:fs`, into a browser bundle. Every one of the 8 today is a type
   * import; `import { type X }` deliberately does not count, because the erasure
   * is what matters and `import type` is the form biome's `separatedType` keeps.
   *
   * Intra-`config/` imports are skipped: they are the Node entry importing
   * itself, which is what it is for.
   */
  it("keeps every browser-surface config/* import type-only", () => {
    const violations: string[] = []
    let checked = 0
    for (const file of BROWSER_CLOSURE) {
      if (file.startsWith("src/config/")) continue
      for (const { spec, typeOnly } of importsOf(file)) {
        const target = resolveSpec(spec, file)
        if (!target?.startsWith("src/config/")) continue
        checked += 1
        if (!typeOnly) violations.push(`${file} → ${spec}`)
      }
    }
    expect(violations).toEqual([])
    expect(checked).toBeGreaterThanOrEqual(8)
  })
})

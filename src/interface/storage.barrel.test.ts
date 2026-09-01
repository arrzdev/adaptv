import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { storage } from "#adaptv/storage/index"
import { kv } from "#adaptv/storage/kv"
import { secure } from "#adaptv/storage/secure"
import { store } from "#adaptv/storage/store"

/*
 * `@arrzdev/adaptv/storage` is the one published subpath whose barrel does not
 * live in `src/interface/`.
 *
 * `src/interface/storage.index.ts` is a single `export *` line pointing at
 * `src/storage/index.ts`, so the file that actually decides the public surface is
 * the one inside the directory — a different shape from every other interface
 * barrel, which lists its modules directly. That is deliberate: the tier table and
 * the "`secure` is NOT secure on web" caveat belong next to the code they describe,
 * and a consumer reading the module gets them. The cost is that the published
 * surface is one indirection away from where the other guards look, which is why
 * `capabilities`, `ota` and `components` all grew a barrel guard and this one did
 * not.
 *
 * The failure it is missing is the same one the others were built for, and it is
 * silent in both directions. A named-list barrel that falls BEHIND its directory
 * exports nothing, drags nothing into any graph, and is indistinguishable from a
 * complete one: `tsc` is happy, lint is happy, and each tier's own suite imports
 * its module directly so nothing compares the two. That is how a finished `Text`
 * shipped unreachable (`src/components/barrels.test.ts`), and it is how
 * `StoreValue` — the return type of the public `useStore` — sat unexported here:
 * `hooks.index.ts` re-exports its hooks with `export *`, so every other hook's
 * result type is public for free, and the two hooks that live in `src/storage/`
 * are the only ones behind a named list.
 *
 * So this asserts both halves, plus the two things unique to this barrel: that the
 * interface file is still the bare pass-through the rest of this reasoning depends
 * on, and that the `storage` namespace object holds exactly the three tiers.
 */

const STORAGE_DIR = resolve(process.cwd(), "src/storage")
const BARREL = resolve(STORAGE_DIR, "index.ts")
const INTERFACE_BARREL = resolve(
  process.cwd(),
  "src/interface/storage.index.ts",
)

/**
 * The three tiers, in the order the header's table lists them. These are the
 * modules the `storage` namespace object is composed from — adding a fourth is a
 * design decision (`docs/design/architecture.md §2`), and it fails here until it
 * is written down.
 */
const TIERS = ["kv", "store", "secure"]

/**
 * The React half. Deliberately NOT in the `storage` namespace: `storage.useKv()`
 * would read as a callable on a namespace object rather than a hook, and the rules
 * of hooks are the whole reason the distinction matters. They are still published
 * — just as `useKv` / `useStore`, the way every other adaptv hook is.
 */
const HOOKS = ["use-kv", "use-store"]

/**
 * Names the barrel deliberately keeps off the public surface. Empty on purpose:
 * every tier is a plain object of methods and both hooks are consumer API, so
 * there is nothing here that only the framework may call — unlike `capabilities`
 * and `ota`, which both have real internals to hold back. Adding a name is a
 * deliberate act and needs its reason written beside it; arriving here by accident
 * is the bug this file exists for.
 */
const WITHHELD = new Set<string>()

/** Every storage module on disk, tests excluded — and not the barrel itself. */
function modulesOnDisk(): string[] {
  return readdirSync(STORAGE_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => f.replace(/\.ts$/, ""))
    .filter((name) => name !== "index")
    .sort()
}

/** Top-level `export` names in a storage module, types included. */
function exportedNames(module: string): string[] {
  const src = readFileSync(resolve(STORAGE_DIR, `${module}.ts`), "utf8")
  const names: string[] = []
  const pattern =
    /^export\s+(?:async\s+)?(?:function|const|type|class|interface)\s+([A-Za-z0-9_$]+)/gm
  let match = pattern.exec(src)
  while (match) {
    names.push(match[1])
    match = pattern.exec(src)
  }
  return names
}

const BARREL_SOURCE = readFileSync(BARREL, "utf8")
const INTERFACE_SOURCE = readFileSync(INTERFACE_BARREL, "utf8")

/** The `export { … } from "#adaptv/storage/<module>"` list, or `null`. */
function namedListFor(module: string): string | null {
  return (
    new RegExp(
      `export (?:type )?\\{[^}]*\\}\\s*from "#adaptv/storage/${module}"`,
      "s",
    ).exec(BARREL_SOURCE)?.[0] ?? null
  )
}

describe("the storage barrel", () => {
  /*
   * The vacuous pass: every assertion below compares against a directory scan, so
   * a walk pointed at nothing goes green and a rotted `exportedNames` regex makes
   * "exports everything" trivially true. The floors are the real counts today —
   * five modules, and eight names across them — and well over zero.
   */
  it("actually walked the directory it claims to have walked", () => {
    expect(modulesOnDisk().length).toBeGreaterThanOrEqual(5)
    const names = modulesOnDisk().flatMap(exportedNames)
    expect(names.length).toBeGreaterThanOrEqual(8)
    //and the barrel is the file this thinks it is
    expect(BARREL_SOURCE).toContain('from "#adaptv/storage/')
    for (const name of WITHHELD) {
      expect(
        names,
        `${name} is withheld but nothing exports it`,
      ).toContain(name)
    }
  })

  /*
   * The premise everything else here rests on. `src/interface/storage.index.ts` is
   * what `exports["./storage"]` points at, and it is a bare `export *` — so
   * `src/storage/index.ts` IS the published surface. Turn the interface file into
   * a named list and the published surface silently moves there, leaving this
   * whole suite guarding a file that no longer decides anything.
   */
  it("is the file the published subpath actually resolves to", () => {
    expect(INTERFACE_SOURCE).toContain('export * from "../storage/index"')
    expect(
      /^\s*export\s*\{/m.test(INTERFACE_SOURCE),
      "the interface file must stay a pass-through — a named list here would move the public surface",
    ).toBe(false)
  })

  /*
   * A module written, tested, and never exported: the one-directional, silent
   * failure. Deleting `export { useStore } from "#adaptv/storage/use-store"` is
   * what this catches, and nothing else does.
   */
  it("re-exports every tier and hook module on disk", () => {
    //an `export … from`, not any mention of the specifier: the three tiers are
    //ALSO plain-imported here to compose the namespace object, so a substring
    //match would call a tier exported on the strength of the import beside it
    const missing = modulesOnDisk().filter(
      (module) => namedListFor(module) === null,
    )
    expect(missing).toEqual([])
  })

  /*
   * The partition, so a NEW module cannot land unclassified. A sixth file in
   * `src/storage/` is either a fourth tier (and belongs in the namespace object
   * and the header table) or another hook — and until someone says which, it is
   * neither, and this fails.
   */
  it("classifies every module on disk as a tier or a hook", () => {
    expect(modulesOnDisk()).toEqual([...TIERS, ...HOOKS].sort())
  })

  /*
   * The same comparison one level down. Every module here is exported through a
   * named list rather than `export *`, so a name added to a tier reaches nobody
   * until the list grows too — which is exactly how `StoreValue` stayed private
   * while the hook returning it was public.
   */
  it("exports every name its modules export", () => {
    const held: string[] = []
    for (const module of modulesOnDisk()) {
      const named = namedListFor(module)
      expect(
        named,
        `${module} must be exported by a named list`,
      ).not.toBeNull()
      for (const name of exportedNames(module)) {
        if (!new RegExp(`\\b${name}\\b`).test(named ?? "")) held.push(name)
      }
    }
    expect(new Set(held)).toEqual(WITHHELD)
  })

  /*
   * The composed namespace, checked as a value rather than as text — it is the one
   * thing here source alone cannot answer. `storage` is what the docs, the
   * cookbook and the tier table all name, so a tier missing from this object is a
   * tier that does not exist as far as a consumer reading `storage.` is concerned,
   * even with its module fully exported beside it.
   */
  it("composes the storage namespace from exactly the three tiers", () => {
    expect(Object.keys(storage).sort()).toEqual([...TIERS].sort())
    expect(storage.kv).toBe(kv)
    expect(storage.store).toBe(store)
    expect(storage.secure).toBe(secure)
  })

  /*
   * The header is the tier table — the one place the three tiers, their backends
   * and the "`secure` is NOT secure on web" caveat are written down. A table that
   * disagrees with the object below it is worse than no table, because it is the
   * part a consumer reads.
   */
  it("documents exactly the tiers it composes", () => {
    const documented = [
      ...BARREL_SOURCE.matchAll(/\|\s*`storage\.([a-z]+)`\s*\|/g),
    ].map((m) => m[1])
    expect(documented.sort()).toEqual([...TIERS].sort())
    expect(
      BARREL_SOURCE,
      "the web caveat is the most load-bearing sentence in this file",
    ).toContain("not secure")
  })
})

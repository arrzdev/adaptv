import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { callSitesOf, exportsOf } from "#adaptv/test-utils/barrel-guard"

/*
 * `src/interface/components.index.ts` must cover exactly the components on disk.
 *
 * This exists because a barrel drifted from the directory in silence.
 * `src/components/index.ts` was missing `text`, `view`, `list` and `external-link`;
 * the interface barrel was missing `text`, `not-found` and `orientation-guard`. The
 * visible symptom was that `import { Text } from "@arrzdev/adaptv/components"` did
 * not resolve — a component that was fully built, fully tested and completely
 * unreachable.
 *
 * Nothing else catches it. `tsc` is happy (the barrel is valid either way), lint is
 * happy, every component's own suite is happy (they import the module directly), and
 * `build:check` is happy (it validates the entries that DO exist). A missing
 * re-export is invisible to every gate that does not compare the barrel to the
 * directory — so this is the gate that does.
 *
 * ## One barrel, not two
 *
 * The original pairing was `src/components/index.ts` against the interface barrel,
 * which only ever proved the two agreed — not that either was right. That second
 * barrel was unreachable (nothing in `src/`, `bin/`, `scripts/` or the playground
 * imported it; `exports` points every subpath at `src/interface/*.index.ts`) and is
 * deleted. The comparison that carries the weight is directory-vs-published-barrel,
 * with the modules held back named explicitly — the standard
 * `src/interface/capabilities.barrel.test.ts` and `src/interface/ota.barrel.test.ts`
 * hold their own withheld sets to.
 */

const COMPONENTS_DIR = resolve(process.cwd(), "src/components")
const BARREL = resolve(process.cwd(), "src/interface/components.index.ts")

/**
 * The shared press implementation behind every pressable surface. Internal for a
 * containment reason rather than an ownership one: it has many callers, and the
 * claim that makes it internal is that all of them are components in this
 * directory. The moment one is not, it is consumer API that has not admitted it.
 */
const WITHHELD_SHARED = ["press-core"]

/**
 * Extracted, unit-tested engine math, each paired with the one component that
 * drives it. The pure half exists so the maths can be tested without a DOM, not so
 * a consumer can run its own gesture; a second driver means the split is now a
 * shared abstraction and needs a real answer instead of an omission.
 */
const WITHHELD_ENGINES: Record<string, string> = {
  "swipeable-physics": "src/components/swipeable.tsx",
  "wheel-column-geometry": "src/components/wheel-column.tsx",
  "pull-to-refresh-physics": "src/components/pull-to-refresh.tsx",
}

const WITHHELD = new Set([
  ...WITHHELD_SHARED,
  ...Object.keys(WITHHELD_ENGINES),
])

/** Every component module on disk: `foo.tsx` and `foo/index.ts` both count. */
function modulesOnDisk(): string[] {
  const found = new Set<string>()
  for (const entry of readdirSync(COMPONENTS_DIR, {
    withFileTypes: true,
  })) {
    if (entry.isDirectory()) {
      if (
        readdirSync(resolve(COMPONENTS_DIR, entry.name)).includes(
          "index.ts",
        )
      )
        found.add(entry.name)
      continue
    }
    const m = entry.name.match(/^([a-z0-9-]+)\.tsx$/)
    if (m?.[1] && !entry.name.includes(".test.")) found.add(m[1])
  }
  //`.ts` modules that are still components (no JSX) — keep them honest too
  for (const entry of readdirSync(COMPONENTS_DIR)) {
    const m = entry.match(/^([a-z0-9-]+)\.ts$/)
    if (m?.[1] && !entry.includes(".test.")) found.add(m[1])
  }
  return [...found].sort()
}

/** The modules the barrel re-exports whole (`export *`), as bare names. */
function modulesInBarrel(): string[] {
  return exportsOf(readFileSync(BARREL, "utf8"))
    .filter((e) => e.names === null)
    .map((e) => e.spec)
    .filter((spec) => spec.startsWith("../components/"))
    .map((spec) => spec.slice("../components/".length))
    .sort()
}

/** Every non-test file under `src/` importing a component module by that name. */
const importersOf = (module: string) =>
  callSitesOf(new RegExp(`from "[^"]*/${module}(?:\\.ts)?"`))

describe("the component barrel", () => {
  /*
   * The vacuous pass. Both assertions below compare against a directory scan and a
   * regex over one file, so a walk pointed at nothing — or a parser that stops
   * matching — compares two empty lists and reports perfect compliance. The floors
   * are the real counts today (27 exported components, 4 withheld) and well over
   * zero. → `docs/roadmap/src-reorg.md` §7
   */
  it("actually walked the directory it claims to have walked", () => {
    expect(modulesOnDisk().length).toBeGreaterThanOrEqual(31)
    expect(modulesInBarrel().length).toBeGreaterThanOrEqual(27)
    for (const module of WITHHELD) {
      expect(
        modulesOnDisk(),
        `${module} is withheld but not on disk`,
      ).toContain(module)
    }
  })

  it("exports every component it does not deliberately withhold", () => {
    //the failure mode is one-directional and silent: a new component is written,
    //tested, and never exported, so only its author can use it
    const missing = modulesOnDisk().filter(
      (module) =>
        !WITHHELD.has(module) && !modulesInBarrel().includes(module),
    )
    expect(missing).toEqual([])
  })

  /*
   * The same comparison from the other end, so the withheld list cannot be padded:
   * the modules absent from the barrel must be exactly the ones named above.
   * Exporting `press-core` fails here as an unwithheld module, and padding either
   * withheld list to silence a failure fails as a module that is exported anyway.
   */
  it("withholds exactly the modules it means to withhold", () => {
    const exported = new Set(modulesInBarrel())
    const held = new Set(modulesOnDisk().filter((m) => !exported.has(m)))
    expect(held).toEqual(WITHHELD)
  })

  /*
   * The justification for the shared module, checked rather than trusted: it is
   * internal because it never leaves the directory. A caller anywhere else in `src/`
   * makes it framework-wide plumbing that consumers cannot reach.
   */
  it("keeps the shared press implementation inside the components", () => {
    for (const module of WITHHELD_SHARED) {
      const callers = importersOf(module)
      expect(
        callers.length,
        `${module} has no callers left`,
      ).toBeGreaterThan(0)
      expect(
        callers.filter((file) => !file.startsWith("src/components/")),
        `${module} is internal only while every caller is a component`,
      ).toEqual([])
    }
  })

  /*
   * The justification for the engines, on the stricter standard their split earns:
   * one driver each. A second one means the pure half is a shared abstraction, and
   * "the component owns it" is no longer the reason it is unexported.
   */
  it("keeps each engine down to the one component that drives it", () => {
    for (const [module, driver] of Object.entries(WITHHELD_ENGINES)) {
      expect(
        importersOf(module),
        `${module} is driven by ${driver}`,
      ).toEqual([driver])
    }
  })
})

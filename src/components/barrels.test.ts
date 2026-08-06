import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/*
 * The two component barrels must cover exactly the same modules.
 *
 * This exists because they silently drifted. `src/components/index.ts` was missing
 * `text`, `view`, `list` and `external-link`; `src/interface/components.index.ts`
 * was missing `text`, `not-found` and `orientation-guard`. The visible symptom was
 * that `import { Text } from "@arrzdev/adaptv/components"` did not resolve — a
 * component that was fully built, fully tested and completely unreachable.
 *
 * Nothing else catches it. `tsc` is happy (both files are valid), lint is happy,
 * every component's own suite is happy (they import the module directly), and
 * `build:check` is happy (it validates the entries that DO exist). A missing
 * re-export is invisible to every gate that does not compare the two lists — so
 * this is the gate that does.
 */

const COMPONENTS_DIR = resolve(process.cwd(), "src/components")

/** Modules internal by design, and therefore expected in NEITHER barrel. */
const INTERNAL = new Set([
  //the shared press track behind Button and Pressable — not consumer API
  "press-core",
  //extracted, unit-tested engine math — driven by their components, not exported
  "swipeable-physics",
  "wheel-column-geometry",
  "pull-to-refresh-physics",
])

/** Not components: the barrel itself, and this file's own siblings. */
const NOT_A_COMPONENT = new Set(["index", "barrels"])

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
  return [...found]
    .filter((m) => !INTERNAL.has(m) && !NOT_A_COMPONENT.has(m))
    .sort()
}

/** The module specifiers a barrel re-exports, normalised to bare names. */
function modulesInBarrel(path: string): string[] {
  const src = readFileSync(resolve(process.cwd(), path), "utf8")
  return [
    ...src.matchAll(/export \* from "[./]*(?:components\/)?([^"]+)"/g),
  ]
    .map((m) => m[1])
    .filter((m): m is string => typeof m === "string")
    .sort()
}

describe("the component barrels", () => {
  it("cover exactly the same modules", () => {
    expect(modulesInBarrel("src/interface/components.index.ts")).toEqual(
      modulesInBarrel("src/components/index.ts"),
    )
  })

  it("cover every component on disk, and nothing that is not there", () => {
    //the failure mode is one-directional and silent: a new component is written,
    //tested, and never exported, so only its author can use it
    expect(modulesInBarrel("src/interface/components.index.ts")).toEqual(
      modulesOnDisk(),
    )
  })

  it("keep internal modules out of the public surface", () => {
    const publicModules = new Set(
      modulesInBarrel("src/interface/components.index.ts"),
    )
    for (const internal of INTERNAL) {
      expect(
        publicModules.has(internal),
        `${internal} is internal — exporting it would make it consumer API`,
      ).toBe(false)
    }
  })
})

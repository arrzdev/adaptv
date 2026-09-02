import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { callSitesOf, exportsOf } from "#adaptv/test-utils/barrel-guard"

/*
 * `src/interface/ota.index.ts` is a `platform: "browser"` tsdown entry pointed at
 * a directory that is not all browser code.
 *
 * `src/ota/` is three things at once: `build/` runs on the dev's machine (it is
 * what `adaptv build web` and `adaptv keys ota` string-load out of `bin/`),
 * `native-fingerprint.ts` imports `node:crypto`, and the seven files beside them
 * are the runtime updater. One hand-written barrel decides which of the three a
 * consumer can reach, and until this file there was nothing comparing that barrel
 * to the directory — deleting `export * from "../ota/updater"` left `pnpm gate`
 * fully green. → `docs/roadmap/src-reorg.md` §0.1, §2.5
 *
 * ## What this does NOT duplicate
 *
 * `src/execution-boundary.test.ts` already walks the browser import graph from
 * these entries and fails on any `node:*` in it, so *exporting* `native-fingerprint`
 * or anything under `build/` is caught there too — twice over, since its
 * `NODE_ALLOWED` list names those paths. What nothing catches is the other
 * direction: a barrel that falls **behind** its directory exports nothing, drags
 * nothing into any graph, and looks exactly like a barrel that is complete. That
 * is the failure `Text` shipped under, and it is what the first two tests below
 * are for.
 *
 * The Node half is still asserted here, by name, for a reason the graph walk does
 * not cover: this file says *which* names are held back and *why*, so removing one
 * from `WITHHELD` is a decision someone has to write down rather than a line that
 * quietly disappears. It is stated as a list of exact module paths, never a
 * `build/` prefix rule — a prefix would let a new `node:`-importing file into the
 * directory unnamed, and `the WITHHELD set names every Node file on disk` below
 * fails the moment one appears.
 *
 * ## Two barrels, on purpose
 *
 * `use-store-release` is exported from `hooks.index.ts`, not from `ota.index.ts`:
 * `@arrzdev/adaptv/hooks` is the subpath an app already imports its hooks from,
 * and a React hook does not move to a second subpath because its state lives in
 * `src/ota/`. So "exported" here means "reachable from either published barrel",
 * and the placement itself is pinned by its own test rather than left to drift.
 */

const OTA_DIR = resolve(process.cwd(), "src/ota")
const BUILD_DIR = resolve(OTA_DIR, "build")
const OTA_BARREL = resolve(process.cwd(), "src/interface/ota.index.ts")
const HOOKS_BARREL = resolve(process.cwd(), "src/interface/hooks.index.ts")

/**
 * The Node half, named file by file. Neither published barrel may reach any of
 * these, and `platform: "browser"` is the reason: `native-fingerprint.ts` imports
 * `node:crypto`, `build/ota-emit.ts` imports `node:crypto` and `node:fs`, and
 * `build/ota-zip.ts` imports `node:zlib`. `build/ota-config-module.ts` touches no
 * builtin itself but imports `native-fingerprint`, so it carries one anyway.
 */
const NODE_ONLY = [
  "native-fingerprint",
  "build/ota-config-module",
  "build/ota-emit",
  "build/ota-zip",
]

/**
 * Browser-side modules deliberately kept off the public surface, each paired with
 * the file (or files) inside the framework that owns it. The last test checks the
 * ownership is real rather than asserted — the same standard
 * `capabilities.barrel.test.ts` holds its `WITHHELD_INTERNAL` to.
 */
const WITHHELD_INTERNAL: Record<string, string[]> = {
  //the updater's own persistence. An app writing bundle states would be telling
  //the updater things it is the only thing in a position to know.
  ledger: ["src/ota/updater.ts"],
  //adaptv's manifest signature scheme, both halves of it: the emitter signs, the
  //updater verifies. There is no third party to it.
  "manifest-signing": ["src/ota/updater.ts", "src/ota/build/ota-emit.ts"],
  //mounted once by the shell on every app. A second caller starts a second
  //updater against the same ledger.
  "use-ota-updates": ["src/shell/shell-layout.tsx"],
}

const WITHHELD = new Set([...NODE_ONLY, ...Object.keys(WITHHELD_INTERNAL)])

/** Not modules: the ambient declaration for `virtual:adaptv/ota-config`. */
const isModule = (name: string) =>
  name.endsWith(".ts") &&
  !name.endsWith(".test.ts") &&
  !name.endsWith(".d.ts")

/**
 * Every OTA module on disk, `build/` ones prefixed — the same shape as the
 * specifier a barrel would have to write to export one.
 */
function modulesOnDisk(): string[] {
  const flat = readdirSync(OTA_DIR)
    .filter(isModule)
    .map((f) => f.replace(/\.ts$/, ""))
  const build = readdirSync(BUILD_DIR)
    .filter(isModule)
    .map((f) => `build/${f.replace(/\.ts$/, "")}`)
  return [...flat, ...build].sort()
}

/** The `src/ota/` modules that import a `node:*` builtin, tests excluded. */
function nodeTouchingModules(): string[] {
  return modulesOnDisk().filter((module) =>
    /(?:^|\n)import[^;]*?from\s*["']node:/.test(
      readFileSync(resolve(OTA_DIR, `${module}.ts`), "utf8"),
    ),
  )
}

const OTA_SOURCE = readFileSync(OTA_BARREL, "utf8")
const HOOKS_SOURCE = readFileSync(HOOKS_BARREL, "utf8")
const OTA_EXPORTS = exportsOf(OTA_SOURCE)
const HOOKS_EXPORTS = exportsOf(HOOKS_SOURCE)

/** Whether a barrel re-exports a module at all — `export *` or a named list. */
const barrelReaches = (
  exports: ReturnType<typeof exportsOf>,
  module: string,
) => exports.some((e) => e.spec === `../ota/${module}`)

const isExported = (module: string) =>
  barrelReaches(OTA_EXPORTS, module) ||
  barrelReaches(HOOKS_EXPORTS, module)

describe("the OTA barrel", () => {
  /*
   * The vacuous pass §7 warns about: every assertion here compares against a
   * directory scan, so a walk pointed at nothing goes green. The floors are the
   * real counts today (8 flat modules, 3 under `build/`) and well over zero.
   */
  it("actually walked the directory it claims to have walked", () => {
    expect(modulesOnDisk().length).toBeGreaterThanOrEqual(11)
    expect(
      modulesOnDisk().filter((m) => m.startsWith("build/")).length,
    ).toBeGreaterThanOrEqual(3)
    expect(nodeTouchingModules().length).toBeGreaterThanOrEqual(3)
    //and the barrels are the files this thinks they are
    expect(OTA_SOURCE).toContain("../ota/")
    expect(HOOKS_SOURCE).toContain("../hooks/")
    for (const module of WITHHELD) {
      expect(
        modulesOnDisk(),
        `${module} is withheld but not on disk`,
      ).toContain(module)
    }
  })

  /*
   * The one-directional, silent failure: a module is written, tested, and never
   * exported, so only its author can use it. Deleting `export * from
   * "../ota/updater"` by hand is what this catches — and did.
   */
  it("exports every browser-side module it does not deliberately withhold", () => {
    const missing = modulesOnDisk().filter(
      (module) => !WITHHELD.has(module) && !isExported(module),
    )
    expect(missing).toEqual([])
  })

  /*
   * The same comparison from the other end, so the list cannot be padded: the
   * modules absent from both barrels must be exactly the ones named above.
   * Exporting `native-fingerprint` fails here as an unwithheld Node module, not
   * as a graph violation three files away.
   */
  it("withholds exactly the modules it means to withhold", () => {
    const held = new Set(modulesOnDisk().filter((m) => !isExported(m)))
    expect(held).toEqual(WITHHELD)
  })

  /*
   * `NODE_ONLY` is written out file by file rather than as a `build/` prefix, so
   * this is what stops it going stale: a new `node:`-importing file in `src/ota/`
   * is a browser-entry hazard the moment it lands, and it fails here until
   * someone names it.
   */
  it("names every Node-touching file on disk in NODE_ONLY", () => {
    const unnamed = nodeTouchingModules().filter(
      (module) => !NODE_ONLY.includes(module),
    )
    expect(unnamed).toEqual([])
  })

  /*
   * Said once more as a flat assertion, because it is the invariant with the
   * worst failure: `ota.index.ts` is a `platform: "browser"` tsdown entry, and a
   * `node:crypto` import reaching it either fails that build or ships.
   */
  it("keeps the Node half out of both published barrels", () => {
    for (const module of NODE_ONLY) {
      expect(
        isExported(module),
        `${module} runs on Node — exporting it points a browser entry at a node: builtin`,
      ).toBe(false)
    }
  })

  /*
   * `store-release` is the one module exported through a named list rather than
   * `export *`, and the list is the whole point: an app may hold the value
   * `useStoreRelease` hands it, and may not set it. The mutators decide what the
   * app's own UI shows, and only the updater knows when either is true.
   */
  it("exports the store-release type without its mutators", () => {
    const named = OTA_EXPORTS.find(
      (e) => e.spec === "../ota/store-release",
    )
    expect(
      named?.typeOnly,
      "store-release must be a named type export",
    ).toBe(true)
    expect(named?.names).toEqual(["StoreReleaseRequired"])
    for (const mutator of [
      "noteStoreReleaseRequired",
      "clearStoreRelease",
      "resetStoreReleaseForTests",
    ]) {
      expect(
        OTA_SOURCE,
        `${mutator} is the updater's to call`,
      ).not.toContain(mutator)
    }
  })

  /*
   * The placement `use-store-release` already has, pinned. `@arrzdev/adaptv/hooks`
   * is the subpath consumers import it from; moving it to `./ota` because its
   * state lives in `src/ota/` would break every app using it, for tidiness.
   */
  it("keeps useStoreRelease on the hooks subpath, not the ota one", () => {
    expect(barrelReaches(HOOKS_EXPORTS, "use-store-release")).toBe(true)
    expect(barrelReaches(OTA_EXPORTS, "use-store-release")).toBe(false)
  })

  /*
   * The justification for holding a browser module back, checked rather than
   * trusted. "The framework owns this" stops being true the moment a second
   * caller appears, and then the name needs a real answer instead of an omission.
   */
  it("keeps each withheld runtime module down to its owners", () => {
    for (const [module, owners] of Object.entries(WITHHELD_INTERNAL)) {
      expect(
        callSitesOf(new RegExp(`from "#adaptv/ota/${module}(?:\\.ts)?"`)),
        `${module} is owned by ${owners}`,
      ).toEqual([...owners].sort())
    }
  })
})

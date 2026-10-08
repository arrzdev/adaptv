import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { callSitesOf, exportsOf } from "#adaptv/test-utils/barrel-guard"

/*
 * `src/interface/hooks.index.ts` publishes `src/hooks/` one `export *` line per
 * file, and nothing compared the two. A hook written, tested and never exported
 * is usable only by its author — the failure `Text` shipped under
 * (`src/components/barrels.test.ts`), one directory over. `tsc` is happy either
 * way, and every hook's own suite imports the module directly.
 *
 * The other direction matters as much here: eleven hooks on disk are NOT exported,
 * and each one is unexported for a reason. Five are the shell's own — mounted
 * once on every app with no consumer involvement, the "already invisible" layer
 * of `docs/research/component-surface.md` §8.2 — and a second mount would run a
 * second copy of something that owns document-wide state. The rest are component
 * plumbing: the pure half of a gesture, a ref merge, an SSR-safe layout effect,
 * a style animation.
 * Both lists are written out with their owners, and the last test checks that the
 * ownership is real rather than asserted — the standard the capabilities and OTA
 * guards hold their withheld sets to.
 *
 * ## One hook from another directory, on purpose
 *
 * `use-store-release` lives in `src/ota/` and is exported from THIS barrel:
 * `adaptv/hooks` is the subpath an app already imports its hooks from,
 * and a hook does not move to a second subpath because its state lives elsewhere.
 * `ota.barrel.test.ts` pins the same placement from its side.
 */

const HOOKS_DIR = resolve(process.cwd(), "src/hooks")
const BARREL = resolve(process.cwd(), "src/interface/hooks.index.ts")

/**
 * Mounted by the shell on every app, once. Each is paired with the files inside
 * the framework that call it; `use-sync-theme` is also the one owner of
 * `setThemeColorBase`, which `capabilities.barrel.test.ts` withholds by name.
 * `use-caret-repaint` has three more callers than the shell — the drawer and the
 * keyboard-avoidance hook pre-mute the caret through its exported helpers — and
 * they are still all framework internals.
 */
const WITHHELD_SHELL: Record<string, string[]> = {
  "use-caret-repaint": [
    "src/components/avoid-keyboard/use-keyboard-avoidance.ts",
    "src/components/drawer/drawer-keyboard.ts",
    "src/components/drawer/drawer-motion.ts",
    "src/shell/shell-layout.tsx",
  ],
  "use-register-pwa-service-worker": ["src/shell/shell-layout.tsx"],
  "use-splash-handoff": ["src/shell/shell-layout.tsx"],
  "use-suppress-text-magnifier": ["src/shell/shell-layout.tsx"],
  "use-sync-theme": ["src/shell/shell-layout.tsx"],
}

/**
 * Internal plumbing with named callers. None of these is a capability an app
 * would ask for by name: the gesture capture is the shared half of four
 * components' engines, and the rest exist so a component can be written without
 * repeating a React idiom. A consumer wanting one of these wants the component.
 */
const WITHHELD_INTERNAL: Record<string, string[]> = {
  //the imperative stand-in for a motion component, for components that wrap app
  //content; an app animating its own content has motion itself
  //(docs/decisions/animation.md §3.1)
  "use-animated-style": [
    "src/components/button.tsx",
    "src/components/pull-to-refresh.tsx",
  ],
  "use-gesture-capture": [
    "src/components/drawer/drawer-engine.tsx",
    "src/components/edge-swipe-gestures.tsx",
    "src/components/slider.tsx",
    "src/components/swipeable.tsx",
  ],
  "use-isomorphic-layout-effect": [
    "src/components/collapsible.tsx",
    "src/components/icon.tsx",
    "src/components/text.tsx",
    "src/hooks/use-status-bar.ts",
    "src/hooks/use-sync-theme.ts",
    "src/hooks/use-theme.ts",
    "src/shell/shell-layout.tsx",
  ],
  "use-manifest-orientation": ["src/components/orientation-guard.tsx"],
  "use-merged-ref": [
    "src/components/avoid-keyboard/avoid-keyboard.tsx",
    "src/components/image.tsx",
    "src/components/icon.tsx",
    "src/components/spinner.tsx",
    "src/components/text.tsx",
  ],
  "use-scroll-edge-fade": ["src/components/scroll-view.tsx"],
}

const WITHHELD: Record<string, string[]> = {
  ...WITHHELD_SHELL,
  ...WITHHELD_INTERNAL,
}

/** The one hook exported here that does not live in `src/hooks/`. */
const FROM_OTA = "../ota/use-store-release"

/** Every `use-*` hook module on disk, tests excluded. */
function hooksOnDisk(): string[] {
  return readdirSync(HOOKS_DIR)
    .filter((f) => /^use-.*\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => f.replace(/\.tsx?$/, ""))
    .sort()
}

const EXPORTS = exportsOf(readFileSync(BARREL, "utf8"))
const isExported = (hook: string) =>
  EXPORTS.some((e) => e.spec === `../hooks/${hook}`)

describe("the hooks barrel", () => {
  /*
   * The vacuous pass: every assertion below compares against a directory scan
   * and a parse of one file, so a walk pointed at nothing — or a parser that
   * stops matching — compares two empty lists and goes green. The floors are well
   * under the real counts today (37 hooks on disk, 29 export lines) and well over
   * zero. → `docs/roadmap/src-reorg.md` §7
   */
  it("actually walked the directory it claims to have walked", () => {
    expect(hooksOnDisk().length).toBeGreaterThanOrEqual(20)
    expect(EXPORTS.length).toBeGreaterThanOrEqual(20)
    for (const hook of Object.keys(WITHHELD)) {
      expect(
        hooksOnDisk(),
        `${hook} is withheld but not on disk`,
      ).toContain(hook)
    }
  })

  /*
   * The one-directional, silent failure: a hook is written, tested, and never
   * exported. Deleting `export * from "../hooks/use-share"` by hand is what this
   * catches.
   */
  it("exports every hook it does not deliberately withhold", () => {
    const missing = hooksOnDisk().filter(
      (hook) => !(hook in WITHHELD) && !isExported(hook),
    )
    expect(missing).toEqual([])
  })

  /*
   * The same comparison from the other end, so the withheld lists cannot be
   * padded: the hooks absent from the barrel must be exactly the ones named
   * above. Exporting `use-sync-theme` fails here as an unwithheld hook.
   */
  it("withholds exactly the hooks it means to withhold", () => {
    const held = hooksOnDisk().filter((hook) => !isExported(hook))
    expect(held).toEqual(Object.keys(WITHHELD).sort())
  })

  /*
   * `export *` is the shape every line here has — a named list on this barrel
   * would be a hook exporting less than its module declares, which is a decision
   * `storage` makes on purpose and this barrel never has. And every line points
   * at `src/hooks/` except the one that is meant not to.
   */
  it("re-exports whole modules, and reaches outside src/hooks/ once", () => {
    expect(EXPORTS.filter((e) => e.names !== null)).toEqual([])
    const elsewhere = EXPORTS.map((e) => e.spec).filter(
      (spec) => !spec.startsWith("../hooks/"),
    )
    expect(elsewhere).toEqual([FROM_OTA])
  })

  /*
   * The justification for each omission, checked rather than trusted. "The
   * framework owns this" stops being true the moment a caller appears that is not
   * on the list — and then the hook needs a real answer instead of an omission.
   */
  it("keeps each withheld hook down to its named owners", () => {
    for (const [hook, owners] of Object.entries(WITHHELD)) {
      expect(
        callSitesOf(new RegExp(`from "#adaptv/hooks/${hook}"`)),
        `${hook} is owned by ${owners.join(", ")}`,
      ).toEqual([...owners].sort())
    }
  })
})

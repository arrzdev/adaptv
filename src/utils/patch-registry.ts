//The patch registry: every correction adaptv applies, one row each.
//
//Each patch can be named in up to three places — a config key in
//`adaptv.config.ts`, a pre-paint stamp on `<html>` (the global tier), and a
//`data-adaptv-no-*` attribute on an element (the local tier). Kept in step by
//memory, those drift: `styling.md §5.4.1` records exactly that failure for
//`cn.ts`'s conflict table ("the entry nobody wrote was `cursor`"). So all three
//are DERIVED from the row here, and `patch-registry.test.ts` fails if a stamp or
//hatch attribute is spelled by hand anywhere else in `src/`.
//
//The plan this implements is `docs/roadmap/patch-delivery.md` (§2, §3).
//
//══ Two species, and only one gets a marker ═══════════════════════════════════
//
//  property   the patch is a CSS property inside `@layer adaptv.*`. The local
//             opt-out is re-declaring the property: an unlayered consumer rule
//             wins at any specificity, in any CSS dialect. No marker.
//  marker     the patch is behaviour — a rewritten selector, a preventDefault, a
//             scroll lock. No property can undo it, so the element carries
//             `data-adaptv-no-<name>` and the patch checks for it.
//  false      no local opt-out, deliberately: using one would harm the user. The
//             row says why, and `isPatchDisabled` refuses the name at compile time.
//
//⚠︎ A hatch must be expensive to add (patch-delivery.md §2.5). The magnifier
//patch once exempted `.clickable`, `a[href]`, `button` and the ARIA roles,
//"which is precisely why it kept appearing on them". A marker is a named row
//with a reason; there is no generic `data-adaptv-disable-<anything>`.

/**
 * How far one of the *questionable* app-feel resets reaches.
 *
 * - `"app"` — installed PWA + native only.
 * - `"all"` — every target, browser tab included.
 * - `"off"` — adaptv does not touch the property at all.
 *
 * Only the resets whose alternative is **different, not broken**, are configurable.
 * The hover-stickiness fix, the `touch-action` longhand (WebKit 240917), the caret
 * mute, the autofill cover and the safe-area `env()` ordering (crbug/40699457) have
 * no knob and never will — nobody has a legitimate reason to want the broken
 * behaviour, so a flag there would only be a way to break the app.
 */
export type UiPatchScope = "app" | "all" | "off"

/** Where a patch is enforced. The registry is uniform; the enforcement is not. */
export type PatchLayer = "css-layered" | "css-rewrite" | "js" | "build"

/**
 * The global tier. `patches` — a boolean in `config.patches`, read by the shell.
 * `ui` — a {@link UiPatchScope} in `config.ui`, resolved pre-paint into a
 * boolean-presence `stamp` on `<html>` (`utils/platform.ts`).
 */
type PatchConfig =
  | { block: "patches"; default: boolean }
  | { block: "ui"; default: UiPatchScope; stamp: `data-adaptv-${string}` }

type PatchRow = {
  layer: PatchLayer
  config: PatchConfig | null
  /** `"all"`: every stylesheet in the app's output, `node_modules` included (§6.2). */
  reach: "all" | "app"
  why: string
} & (
  | { hatch: "marker" | "property" }
  | {
      hatch: false
      /** Required: a missing hatch is a decision, and the row carries it. */
      noHatchBecause: string
    }
)

export const PATCHES = {
  hover: {
    layer: "css-rewrite",
    config: null,
    hatch: "marker",
    reach: "all",
    why: "sticky :hover after a tap, and hover must not beat a focus ring",
  },
  active: {
    layer: "css-rewrite",
    config: null,
    hatch: "marker",
    reach: "all",
    why: "press feedback follows the gesture engine's reentrant data-pressed",
  },
  /**
   * The global `user-select: none` reset. Default `"app"`.
   *
   * `"all"` is hostile in a real browser tab: the user cannot select an error
   * message, cannot `Ctrl+A`, cannot copy a code snippet. Text-editing surfaces
   * (`input`, `textarea`, `[contenteditable="true"]`) always keep native selection
   * whatever this is set to, and any element can opt back in with the `selectable`
   * utility.
   */
  noSelect: {
    layer: "css-layered",
    config: {
      block: "ui",
      default: "app",
      stamp: "data-adaptv-no-select",
    },
    hatch: "property",
    reach: "all",
    why: "a stray selection is a mis-tap in an app ui (`selectable` restores it)",
  },
  /**
   * The global `scrollbar-width: none` + `::-webkit-scrollbar { display: none }`
   * reset. Default `"all"` — the one option that is stricter than `"app"`, because
   * it is the one with a per-scroller escape: `ScrollView`'s
   * `showsVerticalScrollIndicator` emits `scrollbar-visible`, which outranks this
   * reset, so a scroller that genuinely wants a desktop scroll-position indicator
   * asks for one. That escape is what lets the same code feel the same on all six
   * targets without stranding a desktop user.
   */
  hideScrollbars: {
    layer: "css-layered",
    config: {
      block: "ui",
      default: "all",
      stamp: "data-adaptv-hide-scrollbars",
    },
    hatch: "property",
    reach: "all",
    why: "desktop scrollbar chrome (`scrollbar-visible` restores it)",
  },
  /**
   * The `a[href] { -webkit-touch-callout: none }` reset — iOS's long-press link
   * preview sheet. Default `"app"`.
   *
   * In an installed app the sheet is a browser artefact leaking through (and it
   * fights any long-press gesture the app owns), but in an iOS Safari tab it is a
   * real affordance the user expects — long-press a link to copy it or open it in
   * a new tab. `"all"` takes that away.
   *
   * ⚠︎ Only the callout is configurable. The `-webkit-tap-highlight-color:
   * transparent` half of the same rule stays universal (`tapHighlight`).
   */
  touchCallout: {
    layer: "css-layered",
    config: {
      block: "ui",
      default: "app",
      stamp: "data-adaptv-no-touch-callout",
    },
    hatch: "property",
    reach: "all",
    why: "iOS long-press link sheet (re-declare -webkit-touch-callout)",
  },
  focusRing: {
    layer: "css-layered",
    config: null,
    hatch: false,
    noHatchBecause:
      "WCAG 2.4.7 (AA): removing the keyboard focus indicator is broken, not a preference",
    reach: "all",
    why: "no focus ring for mouse/touch focus",
  },
  autofill: {
    layer: "css-layered",
    config: null,
    hatch: false,
    noHatchBecause:
      "nobody has a legitimate reason to want unreadable autofilled text",
    reach: "all",
    why: "WebKit's autofill yellow covers the field's own colours",
  },
  tapHighlight: {
    layer: "css-layered",
    config: null,
    hatch: false,
    noHatchBecause:
      "doctrine: a second, uglier press feedback drawn on top of adaptv's own",
    reach: "all",
    why: "-webkit-tap-highlight-color on a[href]",
  },
  safeAreaOrder: {
    layer: "css-layered",
    config: null,
    hatch: false,
    noHatchBecause: "the un-patched order is a broken safe-area layout",
    reach: "all",
    why: "env() safe-area ordering (crbug/40699457)",
  },
  /**
   * Repaint a focused input's caret when it moves (scroll / drawer / keyboard)
   * so iOS never leaves a detached "ghost" caret behind. Default `true`.
   */
  caretRepaint: {
    layer: "js",
    config: { block: "patches", default: true },
    hatch: "marker",
    reach: "all",
    why: "iOS leaves a detached ghost caret when a focused field moves",
  },
  /**
   * Suppress the iOS double-tap text-magnifier loupe (WebKit bug 231161 — not
   * fixable in CSS). Default `true`.
   */
  textMagnifier: {
    layer: "js",
    config: { block: "patches", default: true },
    hatch: "marker",
    reach: "all",
    why: "WebKit 231161 — the double-tap loupe is not fixable in CSS",
  },
  /**
   * Hold an app-wide scroll + virtual-keyboard-overlay lock so the on-screen
   * keyboard / URL bar can't shift the layout — you own keyboard avoidance for
   * inputs outside an overlay (wrap them in `<AvoidKeyboard>`). Default `true`.
   */
  viewportFreeze: {
    layer: "js",
    config: { block: "patches", default: true },
    hatch: "marker",
    reach: "all",
    why: "the keyboard / URL bar must not shift the layout",
  },
  ringShadow: {
    layer: "build",
    config: null,
    hatch: false,
    noHatchBecause:
      "byte-identical on browsers that were never broken — nothing to turn off",
    reach: "all",
    why: "Tailwind's ring shadow on engines without empty-fallback var()",
  },
} as const satisfies Record<string, PatchRow>

type Patches = typeof PATCHES

/** Every patch adaptv applies. */
export type PatchName = keyof Patches

/**
 * `config.patches`, derived: one optional boolean per `block: "patches"` row.
 * Homomorphic over the registry, so each field keeps the row's doc comment.
 */
export type BooleanPatchConfig = {
  [K in PatchName as Patches[K]["config"] extends { block: "patches" }
    ? K
    : never]?: boolean
}

/** `config.ui`, derived: one optional {@link UiPatchScope} per `block: "ui"` row. */
export type UiPatchConfig = {
  [K in PatchName as Patches[K]["config"] extends { block: "ui" }
    ? K
    : never]?: UiPatchScope
}

/** The patches toggled by a boolean in `config.patches`. */
export type BooleanPatchName = keyof BooleanPatchConfig

/** The patches scoped by a {@link UiPatchScope} in `config.ui`. */
export type UiPatchName = keyof UiPatchConfig

/**
 * The patches an element can opt out of with `data-adaptv-no-<name>`. A row with
 * `hatch: false` is not in this union, so `isPatchDisabled(el, "focusRing")` does
 * not compile — adding that hatch is an edit to the row that says why it is false.
 */
export type HatchedPatchName = {
  [K in PatchName]: Patches[K]["hatch"] extends "marker" ? K : never
}[PatchName]

type Kebab<S extends string> = S extends `${infer Head}${infer Tail}`
  ? Head extends Lowercase<Head>
    ? `${Head}${Kebab<Tail>}`
    : `-${Lowercase<Head>}${Kebab<Tail>}`
  : S

export type HatchAttribute<K extends HatchedPatchName = HatchedPatchName> =
  `data-adaptv-no-${Kebab<K>}`

/** `textMagnifier` → `data-adaptv-no-text-magnifier`. The only spelling of a hatch. */
export function hatchAttribute<K extends HatchedPatchName>(
  name: K,
): HatchAttribute<K> {
  const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
  return `data-adaptv-no-${kebab}` as HatchAttribute<K>
}

const names = Object.keys(PATCHES) as PatchName[]

function isHatched(name: PatchName): name is HatchedPatchName {
  return PATCHES[name].hatch === "marker"
}

/** Every `data-adaptv-no-*` hatch, in registry order. */
export const HATCHED_PATCHES: readonly HatchedPatchName[] =
  names.filter(isHatched)

/** The `config.patches` keys, in registry order. */
export const BOOLEAN_PATCHES = names.filter(
  (name): name is BooleanPatchName =>
    PATCHES[name].config?.block === "patches",
)

/** The `config.ui` keys, in registry order. */
export const UI_PATCHES = names.filter(
  (name): name is UiPatchName => PATCHES[name].config?.block === "ui",
)

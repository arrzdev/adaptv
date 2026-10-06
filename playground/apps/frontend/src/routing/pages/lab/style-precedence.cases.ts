/*
 * The style-precedence matrix (docs/decisions/styling.md §2, §9), shared by the lab page
 * that renders it and `e2e/style-precedence.spec.ts` that measures it.
 *
 * Every row is one part of one primitive, and up to two claims about it:
 *
 * - `override` — a DEFAULT the primitive paints from `@layer adaptv.components`. A
 *   consumer class must beat it.
 * - `lock` — a property the primitive writes as INLINE style. A consumer class must not
 *   move it.
 *
 * Each row renders three times: bare (no consumer class: proves the default is really
 * there, so the override is not passing vacuously), with the `plain` classes (unlayered
 * CSS from style-precedence.css, the plain-CSS app), and with the `tw` classes (Tailwind
 * utilities, the Tailwind app). The class names are spelled out in full here so
 * Tailwind's scanner finds them in this file.
 *
 * `isolate` rows render alone (`?only=<id>`): they portal, cover the viewport, or open.
 */

export type Dialect = "bare" | "plain" | "tw"

export type Claim = {
  /** CSS property, as `getComputedStyle` names it. */
  property: string
  plain: string
  tw: string
  /** What the consumer class asks for (override) or the lock's value (lock). */
  expected: string
}

export type PrecedenceCase = {
  id: string
  /** Selector of the measured element, inside the case's `data-testid` wrapper. */
  part: string
  override?: Claim
  lock?: Claim
  /** Rendered only on `?only=<id>`. */
  isolate?: boolean
  /** The part portals out of its row's wrapper, so the spec looks it up page-wide. */
  portal?: boolean
}

const RED = "rgb(255, 0, 0)"
const BLUE = "rgb(0, 0, 255)"
const PRESS_LOCK = "pan-x pan-y pinch-zoom"

const bg: Claim = {
  property: "background-color",
  plain: "sp-bg",
  tw: "bg-[rgb(255,0,0)]",
  expected: RED,
}
const color: Claim = {
  property: "color",
  plain: "sp-color",
  tw: "text-[rgb(0,0,255)]",
  expected: BLUE,
}
const touch: Claim = {
  property: "touch-action",
  plain: "sp-touch-none",
  tw: "touch-none",
  expected: PRESS_LOCK,
}
const lockPosition = (expected: string): Claim => ({
  property: "position",
  plain: expected === "static" ? "sp-relative" : "sp-static",
  tw: expected === "static" ? "relative" : "static",
  expected,
})
const display = (to: "block" | "grid" | "flex"): Claim => ({
  property: "display",
  plain: `sp-${to}`,
  tw: to,
  expected: to,
})
const lockDisplay = (expected: string): Claim => ({
  property: "display",
  plain: "sp-block",
  tw: "block",
  expected,
})
const lockShrink: Claim = {
  property: "flex-shrink",
  plain: "sp-shrink",
  tw: "shrink",
  expected: "0",
}
const lockOverflowY: Claim = {
  property: "overflow-y",
  plain: "sp-overflow-hidden",
  tw: "overflow-hidden",
  expected: "auto",
}
const lockPointerEvents: Claim = {
  property: "pointer-events",
  plain: "sp-pe-auto",
  tw: "pointer-events-auto",
  expected: "none",
}
const height48: Claim = {
  property: "height",
  plain: "sp-h-48",
  tw: "h-12",
  expected: "48px",
}
const width24: Claim = {
  property: "width",
  plain: "sp-size-24",
  tw: "size-6",
  expected: "24px",
}

export const CASES: PrecedenceCase[] = [
  //press targets
  { id: "pressable", part: '[data-adaptv="pressable"]', lock: touch },
  {
    id: "button",
    part: '[data-adaptv="button"][data-part="root"]',
    override: bg,
    lock: touch,
  },
  {
    id: "button-leading",
    part: '[data-adaptv="button-leading"][data-part="leading"]',
    override: {
      property: "justify-content",
      plain: "sp-justify-start",
      tw: "justify-start",
      expected: "flex-start",
    },
    lock: lockShrink,
  },
  {
    id: "button-text",
    part: '[data-adaptv="button-label"][data-part="label"]',
    //the lock is `inline-flex`; as a flex item it is blockified, and computes `flex`
    lock: lockDisplay("flex"),
  },
  {
    id: "fab",
    part: '[data-adaptv="fab"][data-part="root"]',
    override: {
      property: "z-index",
      plain: "sp-z-0",
      tw: "z-0",
      expected: "0",
    },
    lock: {
      property: "transition-property",
      plain: "sp-transition-none",
      tw: "transition-none",
      expected: "translate",
    },
    isolate: true,
  },
  {
    id: "link",
    part: '[data-adaptv="link"]',
    override: color,
    lock: touch,
  },
  {
    id: "external-link",
    part: '[data-adaptv="external-link"]',
    override: {
      property: "text-decoration-line",
      plain: "sp-underline",
      tw: "underline",
      expected: "underline",
    },
    lock: touch,
  },
  {
    id: "text-selectable",
    part: '[data-adaptv="text"]',
    lock: {
      property: "user-select",
      plain: "sp-select-none",
      tw: "select-none",
      expected: "text",
    },
  },
  { id: "icon", part: '[data-adaptv="icon"]', override: width24 },

  //layout
  {
    id: "view",
    part: '[data-adaptv="view"]',
    override: display("grid"),
    //the wrapper sets --adaptv-inset-bottom: 13px, so the lock is distinguishable from 0
    lock: {
      property: "padding-bottom",
      plain: "sp-pb-0",
      tw: "pb-0",
      expected: "13px",
    },
  },
  {
    id: "scroll-view",
    part: '[data-adaptv="scroll-view"]',
    override: display("block"),
    lock: lockOverflowY,
  },
  {
    id: "list",
    part: '[data-adaptv="list"]',
    override: display("block"),
    lock: lockOverflowY,
  },

  //status
  {
    id: "spinner",
    part: '[data-adaptv="spinner"][data-part="root"]',
    override: width24,
  },
  {
    id: "progress-bar",
    part: '[data-adaptv="progress-bar"][data-part="root"]',
    override: height48,
    lock: {
      property: "overflow-x",
      plain: "sp-overflow-visible",
      tw: "overflow-visible",
      expected: "hidden",
    },
  },
  {
    id: "skeleton",
    part: '[data-adaptv="skeleton"]',
    override: {
      property: "border-top-left-radius",
      plain: "sp-radius-0",
      tw: "rounded-none",
      expected: "0px",
    },
  },
  {
    id: "divider",
    part: '[data-adaptv="divider"]',
    override: {
      property: "border-top-color",
      plain: "sp-border-red",
      tw: "border-[rgb(255,0,0)]",
      expected: RED,
    },
  },

  //toggles
  {
    id: "checkbox",
    part: '[data-adaptv="checkbox"][data-part="root"]',
    override: display("flex"),
    lock: lockPosition("relative"),
  },
  {
    id: "checkbox-box",
    part: '[data-adaptv="checkbox-box"][data-part="box"]',
    override: bg,
    lock: {
      property: "overflow-x",
      plain: "sp-overflow-visible",
      tw: "overflow-visible",
      expected: "hidden",
    },
  },
  {
    id: "checkbox-icon",
    part: '[data-adaptv="checkbox-icon"][data-part="icon"]',
    lock: lockPointerEvents,
  },
  {
    id: "radio-item",
    part: '[data-part="item"]',
    //not `display`: an item is a flex item of the group, so its default is blockified
    override: {
      property: "align-items",
      plain: "sp-items-start",
      tw: "items-start",
      expected: "flex-start",
    },
    lock: lockPosition("relative"),
  },
  {
    id: "radio-box",
    part: '[data-part="box"]',
    override: bg,
    lock: lockPosition("relative"),
  },
  {
    id: "radio-indicator",
    part: '[data-part="indicator"]',
    lock: lockPointerEvents,
  },
  {
    id: "switch",
    part: '[data-adaptv="switch"][data-part="root"]',
    override: bg,
    lock: lockPosition("relative"),
  },
  {
    id: "switch-thumb",
    part: '[data-adaptv="switch-thumb"][data-part="thumb"]',
    override: bg,
    lock: {
      property: "position",
      plain: "sp-relative",
      tw: "relative",
      expected: "absolute",
    },
  },
  {
    id: "slider",
    part: '[data-adaptv="slider"][data-part="root"]',
    override: display("block"),
    lock: lockPosition("relative"),
  },
  {
    id: "slider-track",
    part: '[data-adaptv="slider-track"]',
    override: bg,
    lock: lockPosition("relative"),
  },
  {
    id: "slider-range",
    part: '[data-adaptv="slider-range"]',
    override: bg,
    lock: {
      property: "position",
      plain: "sp-relative",
      tw: "relative",
      expected: "absolute",
    },
  },
  {
    id: "slider-thumb",
    part: '[data-adaptv="slider-thumb"]',
    override: bg,
    lock: lockPointerEvents,
  },

  //fields
  {
    id: "input",
    part: '[data-adaptv="input"][data-part="root"]',
    override: bg,
  },
  {
    id: "input-disabled",
    part: '[data-adaptv="input"][data-part="root"]',
    lock: touch,
  },
  {
    id: "input-grouped",
    part: '[data-adaptv="input"][data-part="root"]',
    override: bg,
  },
  {
    id: "input-leading",
    part: '[data-adaptv="input-leading"][data-part="leading"]',
    override: {
      property: "align-self",
      plain: "sp-self-start",
      tw: "self-start",
      expected: "flex-start",
    },
    lock: lockShrink,
  },
  {
    id: "text-area",
    part: '[data-adaptv="text-area"][data-part="root"]',
    override: bg,
    lock: {
      property: "box-sizing",
      plain: "sp-box-content",
      tw: "box-content",
      expected: "border-box",
    },
  },
  {
    id: "field-group-row",
    part: '[data-adaptv="field-group-row"][data-part="row"]',
    override: {
      property: "justify-content",
      plain: "sp-justify-start",
      tw: "justify-start",
      expected: "flex-start",
    },
    lock: lockDisplay("flex"),
  },
  {
    id: "select-trigger",
    part: '[data-adaptv="select-trigger"]',
    override: bg,
    lock: touch,
  },
  {
    id: "select-content",
    portal: true,
    part: '[data-adaptv="select-content"]',
    override: bg,
    lock: lockOverflowY,
    isolate: true,
  },
  {
    id: "dropdown-content",
    portal: true,
    part: '[data-adaptv="dropdown"][data-part="content"]',
    override: bg,
    lock: {
      property: "z-index",
      plain: "sp-z-0",
      tw: "z-0",
      expected: "50",
    },
    isolate: true,
  },
  {
    id: "dropdown-item",
    portal: true,
    part: '[data-adaptv="dropdown-item"]',
    override: color,
    lock: touch,
    isolate: true,
  },

  //drawer
  {
    id: "drawer-content",
    portal: true,
    part: '[data-adaptv="drawer"][data-part="content"]',
    override: bg,
    lock: {
      property: "position",
      plain: "sp-static",
      tw: "static",
      expected: "fixed",
    },
    isolate: true,
  },
  {
    id: "drawer-overlay",
    portal: true,
    part: '[data-adaptv="drawer"][data-part="overlay"]',
    override: bg,
    lock: {
      property: "position",
      plain: "sp-static",
      tw: "static",
      expected: "fixed",
    },
    isolate: true,
  },
  {
    id: "drawer-footer",
    part: '[data-adaptv="drawer"][data-part="footer"]',
    override: display("grid"),
    lock: lockShrink,
  },
  {
    id: "drawer-shell",
    part: '[data-adaptv="drawer"][data-part="shell"]',
    lock: lockDisplay("flex"),
  },
  {
    id: "drawer-handle",
    part: '[data-adaptv="drawer"][data-part="handle"]',
    override: height48,
  },

  //media and scrollers
  {
    id: "image",
    part: '[data-adaptv="image"][data-part="root"]',
    override: bg,
    lock: lockPosition("relative"),
  },
  {
    id: "pull-to-refresh",
    part: '[data-adaptv="pull-to-refresh"][data-part="root"]',
    override: {
      property: "flex-shrink",
      plain: "sp-shrink",
      tw: "shrink",
      expected: "1",
    },
    lock: lockPosition("relative"),
  },
  {
    id: "wheel-column",
    part: '[data-adaptv="wheel-column"][data-part="root"]',
    lock: lockOverflowY,
  },
  {
    id: "wheel-column-item",
    part: '[data-adaptv="wheel-column-item"][data-part="item"]',
    override: color,
    lock: {
      property: "touch-action",
      plain: "sp-touch-none",
      tw: "touch-none",
      expected: PRESS_LOCK,
    },
  },

  //screens
  {
    id: "splash",
    part: "[data-adaptv-splash]",
    override: bg,
    lock: {
      property: "position",
      plain: "sp-static",
      tw: "static",
      expected: "fixed",
    },
    isolate: true,
  },
  {
    id: "offline",
    part: '[data-adaptv="offline"]',
    override: {
      property: "justify-content",
      plain: "sp-justify-start",
      tw: "justify-start",
      expected: "flex-start",
    },
  },
  {
    id: "not-found",
    part: '[data-adaptv="not-found"]',
    override: bg,
  },
]

export const DIALECTS: Dialect[] = ["bare", "plain", "tw"]

/** The consumer class a row gets in one dialect: every claim's class, joined. */
export function classesFor(c: PrecedenceCase, dialect: Dialect): string {
  if (dialect === "bare") return ""
  return [c.override, c.lock]
    .filter((claim): claim is Claim => claim !== undefined)
    .map((claim) => claim[dialect])
    .join(" ")
}

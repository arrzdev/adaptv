/*
 * Dropdown anchored positioning — pure geometry, no DOM.
 *
 * Given the trigger's viewport rect, the content's natural size, the viewport and
 * its safe-area insets, resolve where a fixed-positioned menu should sit: it opens
 * on its preferred side, FLIPS to the other when that side can't hold it, CLAMPS
 * its height (scrolling inside) when neither side can, and SHIFTS horizontally to
 * stay on screen. Because the trigger rect is the real one, a trigger that is
 * partly or wholly scrolled off (a carousel item) still resolves to a box inside
 * the visible viewport — the menu opens on the visible part rather than off-screen.
 *
 * Everything the component does about position flows from this one function, so the
 * hard cases (flip, clamp, shift, occlusion, safe area) are unit-testable without a
 * browser — see dropdown-position.test.ts.
 */

export type DropdownSide = "top" | "bottom"
export type DropdownAlign = "start" | "end" | "center"
export type DropdownPlacement =
  | "bottom-start"
  | "bottom-end"
  | "bottom"
  | "top-start"
  | "top-end"
  | "top"

export type Rect = { x: number; y: number; width: number; height: number }
export type Size = { width: number; height: number }
export type Inset = {
  top: number
  right: number
  bottom: number
  left: number
}

export type ResolvedPosition = {
  /** Fixed-position coordinates (viewport space). */
  left: number
  top: number
  /** Cap for the content box — apply as max-height/max-width; content scrolls. */
  maxHeight: number
  maxWidth: number
  /** The side actually used, after any flip (drives the transform-origin/arrow). */
  side: DropdownSide
  align: DropdownAlign
}

/** Never crush the menu below this; cap and scroll instead of vanishing. */
export const DROPDOWN_MIN_CONTENT_HEIGHT = 96
/** Default gap between the trigger and the menu. */
export const DROPDOWN_GUTTER = 6
/** Default minimum gap kept from every viewport edge. */
export const DROPDOWN_VIEWPORT_PADDING = 8

const ZERO_INSET: Inset = { top: 0, right: 0, bottom: 0, left: 0 }

function clamp(value: number, min: number, max: number): number {
  // when the box fills the axis (max < min) pin to the leading edge rather than invert
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}

export function parsePlacement(placement: DropdownPlacement): {
  side: DropdownSide
  align: DropdownAlign
} {
  const [side, align] = placement.split("-") as [
    DropdownSide,
    DropdownAlign | undefined,
  ]
  return { side, align: align ?? "center" }
}

export function resolveDropdownPosition(args: {
  trigger: Rect
  content: Size
  viewport: Size
  insets?: Partial<Inset>
  placement?: DropdownPlacement
  gutter?: number
  /** Minimum gap kept from every viewport edge. */
  padding?: number
}): ResolvedPosition {
  const insets: Inset = { ...ZERO_INSET, ...args.insets }
  const gutter = args.gutter ?? DROPDOWN_GUTTER
  const padding = args.padding ?? DROPDOWN_VIEWPORT_PADDING
  const { side: prefSide, align } = parsePlacement(
    args.placement ?? "bottom-start",
  )
  const { trigger, content, viewport } = args

  /* ---- vertical: choose a side (flip), then cap + clamp -------------------- */

  const topEdge = insets.top + padding
  const bottomEdge = viewport.height - insets.bottom - padding
  const spaceBelow = bottomEdge - (trigger.y + trigger.height) - gutter
  const spaceAbove = trigger.y - topEdge - gutter

  const fitsBelow = content.height <= spaceBelow
  const fitsAbove = content.height <= spaceAbove

  let side: DropdownSide
  if (prefSide === "bottom") {
    // prefer below; flip up only if below can't hold it AND above can; else the roomier
    side = fitsBelow
      ? "bottom"
      : fitsAbove
        ? "top"
        : spaceBelow >= spaceAbove
          ? "bottom"
          : "top"
  } else {
    side = fitsAbove
      ? "top"
      : fitsBelow
        ? "bottom"
        : spaceAbove >= spaceBelow
          ? "top"
          : "bottom"
  }

  const space = side === "bottom" ? spaceBelow : spaceAbove
  const maxHeight = Math.max(
    DROPDOWN_MIN_CONTENT_HEIGHT,
    Math.min(content.height, space),
  )
  const usedHeight = Math.min(content.height, maxHeight)

  let top =
    side === "bottom"
      ? trigger.y + trigger.height + gutter
      : trigger.y - gutter - usedHeight
  // keep it inside the safe viewport even when the trigger is scrolled off-screen
  top = clamp(top, topEdge, bottomEdge - usedHeight)

  /* ---- horizontal: align to the trigger, then shift into view -------------- */

  const leftEdge = insets.left + padding
  const rightEdge = viewport.width - insets.right - padding
  const availWidth = rightEdge - leftEdge
  const maxWidth = Math.max(0, Math.min(content.width, availWidth))
  const usedWidth = maxWidth

  let left: number
  if (align === "start") left = trigger.x
  else if (align === "end") left = trigger.x + trigger.width - usedWidth
  else left = trigger.x + trigger.width / 2 - usedWidth / 2
  left = clamp(left, leftEdge, rightEdge - usedWidth)

  return { left, top, maxHeight, maxWidth, side, align }
}

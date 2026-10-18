/**
 * Props that make a block that scrolls sideways reachable and named without a mouse. Chrome
 * focuses such a scroller itself; Safari does not, so a keyboard user could not scroll it
 * (axe `scrollable-region-focusable`). Spread them on the scroller, never on a block that
 * does not scroll.
 */
export function scrollRegion(label: string) {
  return { tabIndex: 0, role: "region", "aria-label": label } as const
}

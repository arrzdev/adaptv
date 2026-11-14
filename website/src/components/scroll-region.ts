/**
 * Props that make a block that scrolls sideways reachable and named without a mouse. Chrome
 * focuses such a scroller itself; Safari does not, so a keyboard user could not scroll it
 * (axe `scrollable-region-focusable`). Spread them on the scroller, never on a block that
 * does not scroll.
 *
 * The role is `group`, not `region`: a page holds a dozen code blocks and tables, and a
 * `region` is a landmark, so the landmark list repeated "Code sample" and "Table" (axe
 * `landmark-unique`). A named group is announced on focus and stays out of that list.
 */
export function scrollRegion(label: string) {
  return { tabIndex: 0, role: "group", "aria-label": label } as const
}

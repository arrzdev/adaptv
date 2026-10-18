import { describe, expect, it } from "vitest"
import {
  compileAdaptvStyles,
  ruleFor,
} from "#adaptv/styles/compile.test-helper"

/*
 * The WheelColumn focus indicator, asserted against COMPILED CSS. Whether it is VISIBLE
 * through the drum's mask is a paint question no DOM can answer, so that half lives in
 * playground/e2e/wheel-column.spec.ts on both engines; this half pins that the bundle a
 * consumer imports ships the rule at all, with the shared ring token.
 */
describe("WheelColumn focus indicator", () => {
  it("rings the centred row, inside its box, while the column has keyboard focus", async () => {
    const css = await compileAdaptvStyles([])
    expect(
      ruleFor(
        css,
        '[data-adaptv="wheel-column"]:focus-visible button[data-active="true"]',
      ),
    ).toBe(
      "outline: 2px solid var(--adaptv-ring, currentColor); outline-offset: -2px;",
    )
  })
})

/*
 * The scrollbar. The column is a native scroller, so Chrome on a desktop drew a classic
 * scrollbar beside the drum, where Safari on macOS draws an overlay that hides at rest.
 * `scrollbar-width: none` is inline (wheel-column.test.tsx); a pseudo-element has no
 * inline style, so the WebKit/Blink half is this rule, the way ScrollView does it.
 */
describe("WheelColumn scrollbar", () => {
  it("hides the WebKit/Blink scrollbar of the column", async () => {
    const css = await compileAdaptvStyles([])
    expect(
      ruleFor(
        css,
        ':where([data-adaptv="wheel-column"])::-webkit-scrollbar',
      ),
    ).toBe("display: none;")
  })
})

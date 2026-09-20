import { describe, expect, it } from "vitest"
import {
  compileAdaptvStyles,
  ruleFor,
} from "#adaptv/styles/compile.test-helper"

/*
 * The sheet's hidden tail must hang OFF the panel's border box.
 *
 * Safari on iOS 26 tints its bottom toolbar from the fixed element at the bottom edge of the
 * viewport and refuses one taller than 1.05 viewports (WebKit `LocalFrameView::fixedContainerEdges`,
 * `TooLarge`). `top: 100%` on an absolutely positioned child is what keeps the tail's height out of
 * the panel's box; `background: inherit` is what keeps it painted in whatever the consumer painted
 * the panel. Either one missing brings back the theme-coloured toolbar under a white sheet
 * (docs/decisions/register.md B33).
 */
describe("drawer.css — the hidden tail", () => {
  it("is an absolute child below the panel, painted like the panel", async () => {
    const css = await compileAdaptvStyles([])
    const rule = ruleFor(css, "[data-pwa-drawer-tail]")
    expect(rule).not.toBeNull()
    expect(rule).toContain("position: absolute")
    expect(rule).toContain("top: 100%")
    expect(rule).toContain("background: inherit")
    //a tail that catches taps would swallow a press on whatever sits under an over-dragged sheet
    expect(rule).toContain("pointer-events: none")
  })
})

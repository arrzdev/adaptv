import { describe, expect, it } from "vitest"
import {
  compileAdaptvStyles,
  ruleFor,
} from "#adaptv/styles/compile.test-helper"

/*
 * The edge-fade mask, asserted against COMPILED CSS.
 *
 * `@utility` + `--value()` fail soft: an expression Tailwind cannot parse emits no
 * rule and no error, so `edge-fade-8` would silently do nothing while the source file
 * looks perfect. The fade would then be stuck at its 2rem default and every depth in
 * the app would be quietly ignored — the exact class of failure `VISION.md §2.1`
 * calls worse than none.
 */

describe("depth is a prop, so there is no utility to collide with it", () => {
  it("ships no edge-fade-* class", async () => {
    //shipping both was the bug: an inline custom property beats a class every time,
    //so the prop silently won and any responsive class looked broken
    const css = await compileAdaptvStyles([
      "edge-fade-8",
      "edge-fade-[3rem]",
    ])
    expect(css).not.toContain("edge-fade")
  })

  it("leaves the variable reachable as the variant escape hatch", async () => {
    //`fadeSize` cannot express `md:`, so the one-line arbitrary property has to work
    const css = await compileAdaptvStyles(["[--fade-length:3rem]"])
    expect(ruleFor(css, ".\\[--fade-length\\:3rem\\]")).toContain("3rem")
  })
})

describe("the mask itself", () => {
  it("ships prefixed and unprefixed, because Android WebView trails Chromium 120", async () => {
    const css = await compileAdaptvStyles(["edge-fade-8"])
    expect(css).toContain("-webkit-mask-image")
    expect(css).toContain("mask-image")
  })

  it("defines every variable the mask reads", async () => {
    /*
     * An undefined custom property poisons the whole `calc()`, and a poisoned
     * `mask-image` renders the element FULLY TRANSPARENT — an invisible scroller,
     * which reads as the content failing to load rather than as a CSS bug. So the
     * defaults are not tidiness; they are what keeps the failure mode impossible.
     */
    const css = await compileAdaptvStyles([])
    expect(css).toContain("--fade-length: 2rem")
    expect(css).toContain("--fade-start: 0")
    expect(css).toContain("--fade-end: 0")
  })

  it("scopes itself to data-fade, so an unfaded scroller carries no mask", async () => {
    const css = await compileAdaptvStyles([])
    const maskRules = css
      .split("}")
      .filter((block) => block.includes("mask-image"))
    expect(maskRules.length).toBeGreaterThan(0)
    for (const block of maskRules) {
      expect(block).toContain("[data-fade]")
    }
  })

  it("turns the horizontal scroller's gradient around, and again in RTL", async () => {
    //`start`/`end` are logical: the component never branches on orientation or
    //direction, so if these two rules are missing the prop silently means
    //top/bottom on a horizontal strip
    const css = await compileAdaptvStyles([])
    expect(css).toContain("--fade-direction: to right")
    expect(css).toContain('[dir="rtl"]')
    expect(css).toContain("--fade-direction: to left")
  })
})

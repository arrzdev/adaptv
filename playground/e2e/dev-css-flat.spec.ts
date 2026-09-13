import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The dev server serves FLAT CSS with plain breakpoints (src/vite/dev-css-lowering.ts).
 *
 * Tailwind v4 nests every variant and writes breakpoints in range syntax, and only its build
 * lowers either. An engine without CSS nesting — Safari < 16.5, Chromium < 112 — keeps the
 * outer rule and drops what is nested in it, so in dev every `app:` / `web:` utility, and every
 * other variant, did nothing there. An engine without range syntax — Safari < 16.4, Chromium <
 * 104 — matches no `@media (width >= 40rem)`, so every breakpoint did nothing either.
 *
 * Neither engine Playwright ships here is old enough to show that: both parse nesting and range
 * syntax, so the two sheets RENDER the same in this suite. What they can show is the SHAPE of
 * what the dev server handed them, read back out of the CSSOM, which is the property an old
 * engine depends on: no style rule holds another rule, no selector is relative to a parent, and
 * no media query compares.
 * The rendering on a real nesting-less engine is a device check (an iOS 16.0–16.4 simulator).
 *
 * Runs on the dev server by construction — `playwright.config.ts` boots `vite`, never a build.
 */

type SheetShape = {
  /** Style rules carrying one of adaptv's variants, as the engine parsed them. */
  variantRules: { selector: string; parent: string; childRules: number }[]
  /** Every style rule that holds rules of its own, anywhere in the document. */
  styleRulesWithChildren: string[]
  /** Every selector that is relative to a parent rule. */
  relativeSelectors: string[]
  /** The media text of every `@media` rule, as the engine serialized it. */
  mediaQueries: string[]
}

function readSheetShape(page: Page): Promise<SheetShape> {
  return page.evaluate(() => {
    const shape: SheetShape = {
      variantRules: [],
      styleRulesWithChildren: [],
      relativeSelectors: [],
      mediaQueries: [],
    }
    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule) {
          const selector = rule.selectorText
          //`\:` is how the engine prints the escaped colon of a variant class
          if (/\.(app|web)\\:/.test(selector)) {
            shape.variantRules.push({
              selector,
              parent: rule.parentRule?.constructor.name ?? "CSSStyleSheet",
              childRules: rule.cssRules?.length ?? 0,
            })
          }
          if ((rule.cssRules?.length ?? 0) > 0) {
            shape.styleRulesWithChildren.push(selector)
          }
          if (/(^|[^\\])&/.test(selector)) {
            shape.relativeSelectors.push(selector)
          }
        }
        if (rule instanceof CSSMediaRule) {
          shape.mediaQueries.push(rule.media.mediaText)
        }
        const children = (rule as CSSGroupingRule).cssRules
        if (children) walk(children)
      }
    }
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walk(sheet.cssRules)
      } catch {
        //cross-origin sheet (the web font) — nothing adaptv serves
      }
    }
    return shape
  })
}

test.describe("the dev stylesheet is flat", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/")
    await awaitClientHandover(page)
  })

  test("every `app:` and `web:` rule is a top-level style rule", async ({
    page,
  }) => {
    const shape = await readSheetShape(page)

    //the premise: the app does use both variants, so an empty list cannot pass
    expect(
      shape.variantRules.some((r) => r.selector.includes("app\\:")),
    ).toBe(true)
    expect(
      shape.variantRules.some((r) => r.selector.includes("web\\:")),
    ).toBe(true)

    const nested = shape.variantRules.filter(
      (r) => r.childRules > 0 || r.parent === "CSSStyleRule",
    )
    expect(
      nested,
      "variant rules that still hold nested rules — dead on Safari < 16.5 / Chromium < 112",
    ).toEqual([])
  })

  test("no style rule anywhere holds a nested rule or a parent selector", async ({
    page,
  }) => {
    const shape = await readSheetShape(page)
    expect(shape.styleRulesWithChildren).toEqual([])
    expect(shape.relativeSelectors).toEqual([])
  })

  // `(width >= 40rem)` is what Tailwind writes and what Safari < 16.4 cannot parse; the lowered
  // `(min-width: 40rem)` means the same thing to every engine. A negated breakpoint must come out
  // as `not all and (…)`: the bare `not (…)` is Media Queries 4, and just as dead there.
  test("no media query is written in range syntax", async ({ page }) => {
    const { mediaQueries } = await readSheetShape(page)
    //the premise: the app does have breakpoints, so an empty list cannot pass
    expect(mediaQueries.some((q) => q.includes("width"))).toBe(true)
    expect(
      mediaQueries.filter((q) => /[<>=]/.test(q)),
      "range media queries — dead on Safari < 16.4 / Chromium < 104",
    ).toEqual([])
    expect(
      mediaQueries.filter((q) => /(^|[\s,(])not \(/.test(q)),
      "bare `not (…)` media queries — dead on Safari < 16.4 / Chromium < 104",
    ).toEqual([])
  })

  // The flattened selectors still mean what the variants mean: in a browser tab the `web:`
  // branch applies and the native `app:` branch does not, and stamping the native platform
  // swaps them. Read as computed style, so it is the engine's cascade that decides.
  test("the variants still switch on the platform attribute", async ({
    page,
  }) => {
    const swapped = await page.evaluate(() => {
      const root = document.documentElement
      const was = root.dataset.adaptvPlatform
      const both = Array.from(document.querySelectorAll("[class]")).filter(
        (el) => {
          const tokens = Array.from(el.classList)
          return (
            tokens.some((t) => t.startsWith("web:")) &&
            tokens.some((t) => t.startsWith("app:"))
          )
        },
      )
      const snapshot = (el: Element) => {
        const cs = getComputedStyle(el)
        return Array.from(cs)
          .map((p) => `${p}:${cs.getPropertyValue(p)}`)
          .join(";")
      }
      const result = both.map((el) => {
        root.dataset.adaptvPlatform = "web"
        const web = snapshot(el)
        root.dataset.adaptvPlatform = "native"
        const native = snapshot(el)
        return web !== native
      })
      if (was === undefined) delete root.dataset.adaptvPlatform
      else root.dataset.adaptvPlatform = was
      return { platform: was, elements: both.length, changed: result }
    })

    expect(swapped.platform).toBe("web")
    expect(swapped.elements).toBeGreaterThan(0)
    expect(swapped.changed.every(Boolean)).toBe(true)
  })
})

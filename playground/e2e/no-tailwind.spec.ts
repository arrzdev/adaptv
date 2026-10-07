import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The no-Tailwind build (`apps/frontend/vite.plain.config.ts`, run by
 * `playwright.plain.config.ts` only) really has no Tailwind in it
 * (docs/decisions/styling.md §0.1, §9).
 *
 * The build's own guard (`playground:no-tailwind`) fails the dev server and the build on
 * a Tailwind import, a module loaded from Tailwind, or emitted CSS that only Tailwind's
 * compiler produces. This is the same claim read from the page: the stylesheets the
 * browser was handed carry nothing of Tailwind's, while the pages still write Tailwind
 * class names, and adaptv's own rules are there.
 */

test.describe("the no-Tailwind build", () => {
  test("its stylesheets carry nothing of Tailwind's, and adaptv's own rules", async ({
    page,
  }) => {
    await page.goto("/lab/style-precedence")
    await awaitClientHandover(page)

    //every rule the document's stylesheets hold, nested rules included, as CSS text
    const { css, sheets } = await page.evaluate(() => {
      const out: string[] = []
      const walk = (rules: CSSRuleList) => {
        for (const rule of Array.from(rules)) {
          out.push(rule.cssText)
          if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules)
        }
      }
      for (const sheet of Array.from(document.styleSheets)) {
        walk(sheet.cssRules)
      }
      return { css: out.join("\n"), sheets: document.styleSheets.length }
    })
    expect(sheets).toBeGreaterThan(0)

    //adaptv's layers and component rules arrived…
    expect(css).toContain("adaptv.components")
    expect(css).toContain('[data-adaptv="button"]')
    //…and nothing Tailwind compiles or keeps: its banner, its `--tw-*` properties, its
    //preflight's theme variables
    expect(css).not.toContain("tailwindcss")
    expect(css).not.toContain("--tw-")
    expect(css).not.toContain("--default-font-family")
  })

  test("a Tailwind class name on a page styles nothing", async ({
    page,
  }) => {
    await page.goto("/lab/style-precedence")
    await awaitClientHandover(page)
    //the pages keep their Tailwind class names; with no Tailwind, `hidden` hides nothing
    const display = await page.evaluate(() => {
      const probe = document.createElement("div")
      probe.className = "hidden"
      document.body.append(probe)
      const value = getComputedStyle(probe).display
      probe.remove()
      return value
    })
    expect(display).toBe("block")
  })
})

import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

//WCAG AA text contrast (axe `color-contrast`, 4.5:1) on the pages that draw the most colour:
//the landing page with its Tally mock, a docs page and a post, in both themes. The mock's
//figures are real text that axe measures, however small the mock is drawn.
const PAGES = [
  { name: "landing", path: "/" },
  { name: "docs page", path: "/docs/button" },
  { name: "blog post", path: "/blog/ios-ghost-caret" },
]
const THEMES = ["light", "dark"] as const
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
]

for (const theme of THEMES) {
  for (const viewport of VIEWPORTS) {
    for (const { name, path } of PAGES) {
      test(`${name} text meets AA contrast, ${theme} at ${viewport.name}`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport)
        await page.addInitScript((value) => {
          localStorage.setItem("ui-theme-preference", value)
        }, theme)
        await page.goto(path)
        await expect(page.locator("h1").first()).toBeVisible()
        await page.waitForLoadState("networkidle")
        const { violations } = await new AxeBuilder({ page })
          .withRules(["color-contrast"])
          .analyze()
        expect(
          violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => `${n.target.join(" ")} ${n.any[0]?.message}`),
          })),
        ).toEqual([])
      })
    }
  }
}

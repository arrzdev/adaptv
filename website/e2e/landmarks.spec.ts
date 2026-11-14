import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

//Screen-reader users jump to the content by its `main` landmark, and axe's `region` rule
//flags any content outside a landmark. One page of each kind: landing, blog index, a post
//and a docs page.
const PAGES = [
  { name: "landing", path: "/" },
  { name: "blog index", path: "/blog" },
  { name: "blog post", path: "/blog/ios-ghost-caret" },
  { name: "docs page", path: "/docs/button" },
]

for (const { name, path } of PAGES) {
  test(`${name} has one main landmark and no content outside landmarks`, async ({
    page,
  }) => {
    await page.goto(path)
    await expect(page.locator("h1").first()).toBeVisible()
    const { violations } = await new AxeBuilder({ page })
      .withRules(["landmark-one-main", "region", "landmark-no-duplicate-main"])
      .analyze()
    expect(
      violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target.join(" ")),
      })),
    ).toEqual([])
    await expect(page.locator("main, [role=main]")).toHaveCount(1)
  })
}

//A landmark that repeats a name is no help to a reader jumping between them (axe
//`landmark-unique`). Code blocks and tables are named scrollers, so a page with many of
//them must not turn each into a landmark. Pages with several blocks, at the phone width
//where they overflow.
test.describe("landmarks are unique, phone 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  for (const path of ["/docs/quick-start", "/docs/project-structure", "/docs/button"]) {
    test(`${path} names every landmark once`, async ({ page }) => {
      await page.goto(path)
      await expect(page.locator("h1").first()).toBeVisible()
      const { violations } = await new AxeBuilder({ page })
        .withRules(["landmark-unique"])
        .analyze()
      expect(
        violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target.join(" ")),
        })),
      ).toEqual([])
    })
  }
})

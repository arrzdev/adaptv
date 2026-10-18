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

import { expect, test } from "@playwright/test"

//The pages a stranger reaches on publish day. `/docs/button` is a docs page with a live
//demo; the post is one of the entries in `src/content/blog.ts`.
const PAGES = [
  { name: "landing", path: "/" },
  { name: "docs home", path: "/docs" },
  { name: "docs page with a live demo", path: "/docs/button" },
  { name: "blog index", path: "/blog" },
  { name: "blog post", path: "/blog/ios-ghost-caret" },
]

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
]

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    for (const page of PAGES) {
      test(`${page.name} (${page.path}) loads clean`, async ({ page: tab }) => {
        const problems: string[] = []
        tab.on("console", (message) => {
          if (message.type() === "error") problems.push(`console: ${message.text()}`)
        })
        tab.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`))

        const response = await tab.goto(page.path)
        expect(response?.status()).toBe(200)
        await expect(tab.locator("h1").first()).toBeVisible()
        //hydration and lazy chunks settle before the verdict on errors and overflow
        await tab.waitForLoadState("networkidle")

        const { scrollWidth, innerWidth } = await tab.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }))
        expect(scrollWidth, "horizontal scroll").toBeLessThanOrEqual(innerWidth)
        expect(problems).toEqual([])
      })
    }
  })
}

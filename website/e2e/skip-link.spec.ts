import { expect, test } from "@playwright/test"

//Keyboard users skip the repeated header and docs sidebar (43 tab stops before the article
//on /docs/button). The first Tab stop of every kind of page is a skip link that moves focus
//into the main content.
const PAGES = [
  { name: "landing", path: "/" },
  { name: "docs home", path: "/docs" },
  { name: "docs page", path: "/docs/button" },
  { name: "blog index", path: "/blog" },
  { name: "blog post", path: "/blog/ios-ghost-caret" },
]

test.use({ viewport: { width: 1280, height: 800 } })

for (const { name, path } of PAGES) {
  test(`${name} (${path}) starts with a skip link that moves focus to the content`, async ({
    page,
  }) => {
    await page.goto(path)
    await expect(page.locator("h1").first()).toBeVisible()
    await page.waitForLoadState("networkidle")

    await page.keyboard.press("Tab")
    const skip = page.getByRole("link", { name: "Skip to content" })
    await expect(skip).toBeFocused()
    //visible once focused
    await expect(skip).toBeInViewport()
    const box = await skip.boundingBox()
    expect(box?.width).toBeGreaterThan(1)
    expect(box?.height).toBeGreaterThan(1)

    await page.keyboard.press("Enter")
    const target = await page.evaluate(() => {
      const active = document.activeElement
      return {
        insideMain: !!active?.closest("main"),
        insideHeader: !!active?.closest("header"),
        insideNav: !!active?.closest("nav, aside"),
      }
    })
    expect(target).toEqual({ insideMain: true, insideHeader: false, insideNav: false })

    //The next Tab lands on the first control after the skip point, not back in the header
    //or the docs sidebar (which sits inside `main` but before the article).
    await page.keyboard.press("Tab")
    const next = await page.evaluate(() => {
      const active = document.activeElement
      return {
        inContent: !!active?.closest("article, main"),
        inChrome: !!active?.closest("header, nav, aside"),
      }
    })
    expect(next).toEqual({ inContent: true, inChrome: false })
  })
}

import { expect, test } from "@playwright/test"

//The landing hero (TUD-734). The headline is two lines at every width a phone or a desktop
//has, from 320 px up: "Write React once" then "Feel native everywhere.", neither wrapping nor
//overflowing. The faded grid sits behind it. The lines are read from the rendered text
//(one client rect per line box), not from the markup, so any markup that renders right passes.
const WIDTHS = [320, 360, 375, 390, 414, 768, 1024, 1280, 1440]

for (const width of WIDTHS) {
  test(`hero headline is two lines at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.goto("/")
    const h1 = page.locator("h1").first()
    await expect(h1).toBeVisible()
    await page.evaluate(() => document.fonts.ready)

    const layout = await h1.evaluate((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      //one rect per text fragment; fragments on the same line box share a top
      const rects = [...range.getClientRects()].filter((r) => r.width > 0)
      const tops = [...new Set(rects.map((r) => Math.round(r.top)))]
      const box = el.getBoundingClientRect()
      return {
        text: el.innerText,
        lines: tops.length,
        lineHeight: Number.parseFloat(getComputedStyle(el).lineHeight),
        fontSize: Number.parseFloat(getComputedStyle(el).fontSize),
        height: box.height,
        left: Math.min(...rects.map((r) => r.left)),
        right: Math.max(...rects.map((r) => r.right)),
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }
    })

    expect(layout.text.split("\n").map((line) => line.trim())).toEqual([
      "Write React once",
      "Feel native everywhere.",
    ])
    expect(layout.lines, "line boxes").toBe(2)
    expect(layout.height, "h1 height").toBeLessThan(layout.lineHeight * 2.5)
    expect(layout.left, "text starts inside the viewport").toBeGreaterThanOrEqual(0)
    expect(layout.right, "text ends inside the viewport").toBeLessThanOrEqual(layout.innerWidth)
    expect(layout.scrollWidth, "horizontal scroll").toBeLessThanOrEqual(layout.innerWidth)
    //the desktop size stays where it was: clamp(..., 5.75rem)
    expect(layout.fontSize).toBeLessThanOrEqual(92)
    if (width >= 1280) expect(layout.fontSize).toBe(92)
  })
}

test("hero has the faded 48 px grid behind it", async ({ page }) => {
  await page.goto("/")
  const grid = page.locator("section:has(h1) .grid-lines").first()
  await expect(grid).toBeAttached()
  const style = await grid.evaluate((el) => {
    const s = getComputedStyle(el)
    return { size: s.backgroundSize, image: s.backgroundImage, mask: s.maskImage }
  })
  expect(style.size).toBe("48px 48px")
  expect(style.image).toContain("linear-gradient")
  expect(style.mask).toContain("radial-gradient")
})

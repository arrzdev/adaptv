import { expect, test } from "@playwright/test"

//An installed launch opens on the page: the hero is drawn in place on the first frame, with
//no entrance. A browser tab keeps the entrance. The platform comes from the head script,
//which reads `navigator.standalone` the way it does on an iPhone home-screen launch.
const HERO = "section:has(h1) :is(.rise, .stage-in)"

test("an installed launch draws the hero in place, with no entrance", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { value: true })
  })
  await page.goto("/")
  await expect(page.locator("html")).toHaveAttribute("data-adaptv-platform", "standalone")
  const blocks = await page.locator(HERO).evaluateAll((els) =>
    els.map((el) => {
      const s = getComputedStyle(el)
      return { animation: s.animationName, opacity: s.opacity, transform: s.transform }
    }),
  )
  expect(blocks.length).toBeGreaterThan(0)
  for (const block of blocks) {
    expect(block).toEqual({ animation: "none", opacity: "1", transform: "none" })
  }
})

test("a browser tab keeps the hero entrance", async ({ page }) => {
  await page.goto("/")
  await expect(page.locator("html")).toHaveAttribute("data-adaptv-platform", "web")
  const names = await page
    .locator(HERO)
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName))
  expect(names.length).toBeGreaterThan(0)
  expect(names.every((name) => name === "rise" || name === "stage-in")).toBe(true)
})

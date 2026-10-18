import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Scroll on navigation. The document never scrolls in an adaptv app; a page scrolls
 * inside its ScrollView, and the route engine resets only `window`. So a navigation
 * used to leave the page scroller where it was, and back opened the previous page at
 * the top instead of where the reader left it.
 *
 * The unit test (src/shell/scroll-reset.test.tsx) pins the router's behaviour in
 * happy-dom. What only a real page shows: that the selector finds the page's scroller
 * in the real shell, that the browser's own scroll events are what get recorded, and
 * that the server HTML carries no restore script inside the screen frame (it would
 * defeat the frame's only-child stretch until it ran).
 */

const PAGE_SCROLLER = '[data-adaptv-screen] [data-scroll-view="y"]'

function scrollerTop(page: Page) {
  return page
    .locator(PAGE_SCROLLER)
    .first()
    .evaluate((element) => element.scrollTop)
}

/** Scroll the page like a reader: move the scroller and wait for the browser's own
 *  `scroll` event, which is what the router records a position from. */
async function scrollPageTo(page: Page, top: number) {
  await page
    .locator(PAGE_SCROLLER)
    .first()
    .evaluate(
      (element, to) =>
        new Promise<void>((resolve) => {
          element.addEventListener("scroll", () => resolve(), {
            once: true,
          })
          element.scrollTop = to
        }),
      top,
    )
  await expect.poll(() => scrollerTop(page)).toBe(top)
}

/** Client-side navigation. Link taps ride the gesture engine, which synthetic input
 *  does not drive (see link.spec.ts). */
async function navigateInApp(page: Page, to: string, heading: string) {
  await page.evaluate(async (path) => {
    const router = window.__TSR_ROUTER__
    if (!router) throw new Error("the app's router is not on window")
    await router.navigate({ to: path })
  }, to)
  await expect(page).toHaveURL(new RegExp(`${to}$`))
  await expect(
    page.getByRole("heading", { name: heading, level: 1 }),
  ).toBeVisible()
}

test.describe("scroll on navigation", () => {
  test("a new page starts at the top and back brings back the position", async ({
    page,
  }) => {
    await page.goto("/lab")
    await awaitClientHandover(page)
    await scrollPageTo(page, 600)

    await navigateInApp(page, "/lab/text", "Text")
    await expect.poll(() => scrollerTop(page)).toBe(0)
    await scrollPageTo(page, 150)

    await page.goBack()
    await expect(
      page.getByRole("heading", { name: "Testing", level: 1 }),
    ).toBeVisible()
    await expect.poll(() => scrollerTop(page)).toBe(600)

    await page.goForward()
    await expect(
      page.getByRole("heading", { name: "Text", level: 1 }),
    ).toBeVisible()
    await expect.poll(() => scrollerTop(page)).toBe(150)
  })

  test("the server HTML puts no restore script in the screen frame", async ({
    request,
  }) => {
    const html = await (await request.get("/lab")).text()
    expect(html).toContain("data-adaptv-screen")
    expect(html).not.toContain("tsr-scroll-restoration")
  })
})

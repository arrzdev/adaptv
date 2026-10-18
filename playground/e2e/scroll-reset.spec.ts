import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * A navigation starts the next page at the top.
 *
 * adaptv has no document scroll: the page scrolls inside its root ScrollView, the only
 * child of the screen frame. The router's reset on navigation only scrolled `window`,
 * which never moves, so a page whose scroller SURVIVED the navigation kept its offset:
 * a layout that wraps several routes in one scroller (the website's docs), a param
 * change, or a search change. The next doc opened halfway down.
 *
 * A search change on a lab page is that case with nothing else in the way: same route,
 * same page component, same ScrollView element. The router navigates through
 * `window.__TSR_ROUTER__`, because Link taps ride the gesture engine and synthetic
 * input does not drive it (link.spec.ts).
 */

test.use({ viewport: { width: 390, height: 844 } })

const PAGE = "/lab/view-scroll"
const SCROLLER = "[data-adaptv-screen] > [data-scroll-view]"
const OFFSET = 600

async function scrollPageTo(page: Page, top: number) {
  await page.evaluate(
    ([sel, y]) => {
      const el = document.querySelector(sel as string)
      if (!el) throw new Error("no page scroller")
      el.scrollTop = y as number
    },
    [SCROLLER, top],
  )
}

/** The page scroller's offset, and a marker set on the element itself: if the
 *  element were replaced, the marker would be gone and the test would be vacuous. */
async function readScroller(page: Page) {
  return page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel)
    if (!el) throw new Error("no page scroller")
    return { top: el.scrollTop, same: el.dataset.e2eMarker === "before" }
  }, SCROLLER)
}

async function navigate(page: Page, step: number, resetScroll?: boolean) {
  await page.evaluate(
    async ([path, n, reset]) => {
      const router = window.__TSR_ROUTER__
      if (!router) throw new Error("no router on window")
      await router.navigate({
        to: path as string,
        search: { step: n },
        ...(reset === undefined ? {} : { resetScroll: reset as boolean }),
      } as never)
    },
    [PAGE, step, resetScroll ?? null] as const,
  )
  await expect
    .poll(() => page.evaluate(() => location.search))
    .toBe(`?step=${step}`)
}

test.describe("navigation scroll", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE)
    await awaitClientHandover(page)
    const room = await page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel)
      if (!el) throw new Error("no page scroller")
      el.dataset.e2eMarker = "before"
      return el.scrollHeight - el.clientHeight
    }, SCROLLER)
    expect(room, "the page must be tall enough to scroll").toBeGreaterThan(
      OFFSET,
    )
    await scrollPageTo(page, OFFSET)
    await expect
      .poll(async () => (await readScroller(page)).top)
      .toBe(OFFSET)
  })

  test("a navigation lands the surviving page scroller at the top", async ({
    page,
  }) => {
    await navigate(page, 1)
    const after = await readScroller(page)
    expect(after.same, "the scroller must survive a search change").toBe(
      true,
    )
    await expect.poll(async () => (await readScroller(page)).top).toBe(0)
  })

  test("resetScroll: false keeps the offset", async ({ page }) => {
    await navigate(page, 1, false)
    //the reset runs on the router's render after the commit; give a reset that
    //should not come a few frames to show up
    await page.waitForTimeout(300)
    const after = await readScroller(page)
    expect(after.same).toBe(true)
    expect(after.top).toBe(OFFSET)
  })
})

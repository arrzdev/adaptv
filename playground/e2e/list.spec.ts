import type { CDPSession, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * List — the windowing guarantee: 2 000 rows of data, a handful of rows in the
 * DOM, and it stays a handful however far you scroll. If the DOM row count ever
 * tracks the data count, virtualisation is off and a real list freezes the app.
 *
 * The list is built on adaptv's ScrollView, and react-virtual tracks THAT
 * scroller — which neither a programmatic `scrollTop` nor `mouse.wheel` drives in
 * headless Playwright (they leave react-virtual's window pinned at the top, an
 * artefact; a real finger scrolls it fine — confirmed #0→#16 on the iOS sim). CDP
 * touch is the instrument that actually moves it, same as scroll-axis.
 *
 * ⚠︎ chromium-only for the scroll cases (CDP). react-virtual is engine-agnostic.
 */

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })
test.describe.configure({ retries: 2 })

const LIST = '[data-adaptv="list"]'
const ROW = "[data-lab-row]"
// the lab paints "bad" at ≥80; a correct window in an h-80 box is ~15–30
const DOM_CEILING = 80

const rowIndices = (page: Page) =>
  page.$$eval("[data-lab-row]", (els) =>
    els
      .map((e) => {
        const m = (e.textContent || "").match(/#(\d+)/)
        return m ? Number(m[1]) : -1
      })
      .filter((n) => n >= 0),
  )

async function touch(
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  point?: { x: number; y: number },
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: point ? [point] : [],
  })
}

/** Drag UP inside the list (scroll it forward) by `dy` px. */
async function scrollList(page: Page, cdp: CDPSession, dy: number) {
  const box = await page.locator(LIST).boundingBox()
  if (!box) throw new Error("the list has no layout box")
  const from = {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height * 0.75),
  }
  await touch(cdp, "touchStart", from)
  for (let s = 1; s <= 16; s += 1) {
    await touch(cdp, "touchMove", {
      x: from.x,
      y: Math.round(from.y - (dy * s) / 16),
    })
  }
  await touch(cdp, "touchEnd")
  await page.waitForTimeout(120)
}

test.describe("List virtualisation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/list")
    await page.locator(ROW).first().waitFor()
    await page.locator(LIST).scrollIntoViewIfNeeded()
    await page.waitForTimeout(150)
  })

  test("2 000 rows render as only a windowful of DOM nodes", async ({
    page,
  }) => {
    const idx = await rowIndices(page)
    expect(idx.length, "the window, not the data count").toBeLessThan(
      DOM_CEILING,
    )
    expect(idx.length, "…but a real window, not empty").toBeGreaterThan(4)
    expect(Math.min(...idx), "starts at the top of the data").toBeLessThan(
      5,
    )
    expect(
      Math.max(...idx),
      "and nowhere near the 2 000th row",
    ).toBeLessThan(200)
  })

  test("scrolling recycles the window — DOM stays small, indices move", async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page)
    const topBefore = Math.min(...(await rowIndices(page)))

    for (let i = 0; i < 4; i += 1) await scrollList(page, cdp, 700)

    await expect
      .poll(async () => Math.min(...(await rowIndices(page))), {
        message: "the rendered window must follow the scroll",
        timeout: 2000,
      })
      .toBeGreaterThan(topBefore + 15)

    const after = await rowIndices(page)
    expect(
      after.length,
      "the DOM stays a handful even deep in the list",
    ).toBeLessThan(DOM_CEILING)
    expect(
      after.includes(topBefore),
      "the first row must have been recycled out of the DOM",
    ).toBe(false)
  })

  test("the window keeps recycling deeper in, never accumulating", async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page)
    let deepest = 0
    for (let burst = 0; burst < 8; burst += 1) {
      await scrollList(page, cdp, 900)
      const idx = await rowIndices(page)
      expect(
        idx.length,
        "the window must never grow toward the data count",
      ).toBeLessThan(DOM_CEILING)
      deepest = Math.max(deepest, ...idx)
    }
    expect(
      deepest,
      "scrolling reaches deep rows, not just the first screenful",
    ).toBeGreaterThan(60)
  })

  test("the empty state renders INSTEAD of the scroller", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "empty the list" }).click()
    await expect(page.getByText(/emptyState/)).toBeVisible()
    await expect(page.locator(ROW), "no rows, no scroller").toHaveCount(0)

    await page.getByRole("button", { name: "refill the list" }).click()
    await expect(page.locator(ROW).first()).toBeVisible()
  })
})

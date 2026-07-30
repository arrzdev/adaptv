import type { CDPSession, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * Overscroll containment: an inner scroller at its end must not drag the page.
 *
 * Reported as "overscroll is not being contained". The CSS was already right —
 * `overscroll-behavior-y: contain` on the `scrollable-y` utility — and that is exactly
 * why this file exists: confirming the declaration is applied proves nothing about the
 * behaviour, and shipping on that is the false confidence `VISION.md §2.1` names. Scroll
 * chaining is a compositor decision; only a real touch drag can settle it.
 *
 * What `contain` does and does not do, because the two get conflated in bug reports:
 * it stops the scroll CHAINING to the ancestor, and it deliberately KEEPS the local
 * rubber-band, because that is what a native scroller does. `none` would kill the bounce
 * too. So the claim under test is "the page behind did not move", never "the box sat
 * still".
 *
 * ⚠︎ chromium-only (CDP touch). Portrait viewport: a touch context at a landscape size
 * makes the app's rotate guard cover the screen with a `fixed inset-0` sheet, and every
 * touch then lands on the guard.
 */

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

const BOX = "[data-lab-scroller='vertical']"
const TOLERANCE_PX = 8

async function touchDrag(
  page: Page,
  cdp: CDPSession,
  from: { x: number; y: number },
  dy: number,
  steps = 20,
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [from],
  })
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x, y: from.y + dy * step }],
    })
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  })
  await page.waitForTimeout(350)
}

test.describe("an inner scroller at its end", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "needs CDP touch injection — synthetic events do not drive native scrolling",
  )

  async function setup(page: Page) {
    const cdp = await page.context().newCDPSession(page)
    await page.goto("/lab/view-scroll")
    const box = page.locator(BOX)
    await box.waitFor()
    await box.scrollIntoViewIfNeeded()

    //the page scroller is adaptv's, not the document
    const pageScroll = () =>
      page.evaluate(() => {
        const el = document.querySelector("[data-adaptv-screen] > *")
        return el ? el.scrollTop : window.scrollY
      })

    /*
     * Settle, then check the aim. CDP input has no actionability check, so a box
     * measured while the page is still scrolling into view puts the touch on empty
     * space — and a drag that lands on nothing moves nothing, which is indistinguishable
     * from perfect containment. This test would then pass for the worst possible reason.
     */
    const aim = async () => {
      let previous = -1
      let rect = await box.boundingBox()
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (rect && Math.round(rect.y) === previous) break
        previous = rect ? Math.round(rect.y) : -1
        await page.waitForTimeout(50)
        rect = await box.boundingBox()
      }
      if (!rect) throw new Error("the demo scroller has no layout box")
      const point = {
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
      }
      const hit = await page.evaluate(
        ([x, y, selector]) => {
          const el = document.elementFromPoint(x as number, y as number)
          return {
            onTarget: !!el?.closest(selector as string),
            what: el ? `${el.tagName}.${el.className}`.slice(0, 70) : "nothing",
          }
        },
        [point.x, point.y, BOX] as const,
      )
      if (!hit.onTarget) {
        throw new Error(
          `touch point ${point.x},${point.y} misses the box — hit ${hit.what}`,
        )
      }
      return point
    }

    return { cdp, box, pageScroll, aim }
  }

  test("does not chain its overscroll to the page behind it", async ({
    page,
  }) => {
    const s = await setup(page)
    const centre = await s.aim()

    //park it against its own bottom first — chaining can only happen from there
    await s.box.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await page.waitForTimeout(150)
    const boxAtEnd = await s.box.evaluate((el) => el.scrollTop)
    const max = await s.box.evaluate((el) => el.scrollHeight - el.clientHeight)
    expect(boxAtEnd, "the box must really be at its end").toBeGreaterThan(
      max - TOLERANCE_PX,
    )

    const pageBefore = await s.pageScroll()
    //keep pulling upward well past the end
    await touchDrag(page, s.cdp, centre, -10)

    expect(
      Math.abs((await s.pageScroll()) - pageBefore),
      "the page moved — the inner scroller chained its overscroll into it",
    ).toBeLessThanOrEqual(TOLERANCE_PX)
  })

  test("…and the same drag OUTSIDE the box does move the page", async ({
    page,
  }) => {
    /*
     * The negative control, and the reason the test above can be believed. If touch
     * injection were silently doing nothing, "the page did not move" would pass on a
     * completely broken build. This asserts the harness can move the page at all.
     */
    const s = await setup(page)
    const centre = await s.aim()

    const pageBefore = await s.pageScroll()
    //same gesture, started well above the box, on ordinary page content
    await touchDrag(page, s.cdp, { x: centre.x, y: centre.y - 160 }, -10)

    expect(
      Math.abs((await s.pageScroll()) - pageBefore),
      "the harness cannot scroll the page at all — the containment test above is vacuous",
    ).toBeGreaterThan(TOLERANCE_PX)
  })
})

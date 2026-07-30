import type { CDPSession, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * Single-axis scrolling, measured with real touch input.
 *
 * adaptv used to ship a JS "directional lock" for this, iOS-only, plus a
 * single-axis `touch-action` on the scroll utilities. Both were wrong, and the CSS
 * was actively harmful: `touch-action` restricts the WHOLE gesture that starts on an
 * element, not just that element's own scrolling, so `pan-x` on a horizontal strip
 * made a vertical swipe starting there scroll NOTHING — not the strip, not the page.
 * The browser already performs directional lock on its own; the only job left is to
 * not prevent it. This file is the measurement that proved it and the guard that
 * keeps it true.
 *
 * ⚠︎ CDP `Input.dispatchTouchEvent`, not `dispatchEvent(new TouchEvent(...))`.
 * Synthetic events never drive native scrolling (same reason they cannot set
 * `:active`), and `new Touch()` is an illegal constructor in WebKit. That pins this
 * to chromium — which is the Android WebView engine, so it is a real target, but a
 * pass here is NOT evidence for WKWebView. iOS stays a manual check.
 */

/*
 * `hasTouch` on the CONTEXT, not `Emulation.setTouchEmulationEnabled` sent over CDP
 * after the page exists. Late emulation races the page load: this file passed when run
 * alone and failed all three ways under parallel workers, because the touch points were
 * dispatched before the renderer had switched to touch mode and simply went nowhere.
 * (press-visual.spec.ts hit the sharper form of the same bug — there the events reached
 * native listeners but never React.) The context flag is set before the first navigation
 * and cannot race.
 *
 * The PORTRAIT viewport comes with it, and is not cosmetic: a touch-capable context at
 * a landscape desktop size makes the app's rotate guard fire, and it is a
 * `fixed inset-0 z-[110]` sheet over the whole viewport. Every touch then lands on the
 * guard, nothing scrolls, and all three tests read as a dead scroller — which is
 * exactly what happened, and what the aim check below turned into a legible error.
 */
test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

const STRIP = "[data-scroll-view='x']"
const TOLERANCE_PX = 8

async function touchDrag(
  page: Page,
  cdp: CDPSession,
  from: { x: number; y: number },
  per: { dx: number; dy: number },
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from.x, y: from.y }],
  })
  for (let step = 1; step <= 18; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: from.x + per.dx * step, y: from.y + per.dy * step },
      ],
    })
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  })
  await page.waitForTimeout(250)
}

test.describe("a horizontal ScrollView inside a scrolling page", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "needs CDP touch injection",
  )

  async function setup(page: Page) {
    const cdp = await page.context().newCDPSession(page)
    await page.goto("/lab/view-scroll")
    await page.locator(STRIP).first().waitFor()

    const strip = page.locator(STRIP).first()

    //the page scroller is adaptv's, not the document — read it, not window.scrollY
    const pageScroll = () =>
      page.evaluate(() => {
        const el = document.querySelector("[data-scroll-view='y']")
        return el ? el.scrollTop : window.scrollY
      })
    const stripScroll = () => strip.evaluate((el) => el.scrollLeft)
    /*
     * Reset, then bring the strip INTO VIEW, then measure — in that order. A
     * `boundingBox()` is viewport-relative, and the strip sits well below the fold
     * on this page; measuring before scrolling put the touch at a y outside the
     * window, where it landed on nothing and every assertion read as "the scroller
     * is broken". Only the strip's own scrollLeft is zeroed afterwards, because
     * re-zeroing the page would push it back off screen.
     */
    const reset = async () => {
      await strip.evaluate((el) => {
        el.scrollLeft = 0
      })
      await strip.scrollIntoViewIfNeeded()

      /*
       * Wait for the box to STOP MOVING, then check the aim. A fixed 120ms was enough
       * when this page was short and the machine idle; it stopped being enough once the
       * page grew and the suite ran in parallel, and the failure is silent — the touch
       * lands wherever the strip used to be, nothing scrolls, and all three tests read
       * exactly like a broken scroller. CDP input has no actionability check, so
       * `elementFromPoint` is the only thing that can tell a stale measurement from a
       * real regression.
       */
      let previous = -1
      let box = await strip.boundingBox()
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (box && Math.round(box.y) === previous) break
        previous = box ? Math.round(box.y) : -1
        await page.waitForTimeout(50)
        box = await strip.boundingBox()
      }
      if (!box) throw new Error("the horizontal strip has no layout box")

      const point = {
        x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + box.height / 2),
      }
      const hit = await page.evaluate(
        ([x, y, selector]) => {
          const el = document.elementFromPoint(x as number, y as number)
          return {
            onTarget: !!el?.closest(selector as string),
            what: el
              ? `${el.tagName}.${el.className.toString().slice(0, 60)}`
              : "nothing",
          }
        },
        [point.x, point.y, STRIP] as const,
      )
      if (!hit.onTarget) {
        throw new Error(
          `touch point ${point.x},${point.y} misses the strip — hit ${hit.what}. ` +
            "The measurement is stale, not the scroller",
        )
      }
      return point
    }

    return { cdp, pageScroll, stripScroll, reset }
  }

  test("a vertical swipe starting on the strip scrolls the PAGE", async ({
    page,
  }) => {
    // the reported bug, and the one `touch-action: pan-x` caused: the finger lands
    // on the strip, the user swipes up, and absolutely nothing moves
    const s = await setup(page)
    const centre = await s.reset()
    const pageBefore = await s.pageScroll()
    await touchDrag(page, s.cdp, centre, { dx: 0, dy: -8 })

    expect(
      Math.abs((await s.pageScroll()) - pageBefore),
      "the page must move — this is the pan-x regression",
    ).toBeGreaterThan(TOLERANCE_PX)
    expect(
      await s.stripScroll(),
      "…and the strip must not follow it sideways",
    ).toBeLessThanOrEqual(TOLERANCE_PX)
  })

  test("a horizontal swipe scrolls the STRIP and leaves the page still", async ({
    page,
  }) => {
    const s = await setup(page)
    const centre = await s.reset()
    const pageBefore = await s.pageScroll()
    await touchDrag(page, s.cdp, centre, { dx: -8, dy: 0 })

    expect(await s.stripScroll()).toBeGreaterThan(TOLERANCE_PX)
    expect(
      Math.abs((await s.pageScroll()) - pageBefore),
      "the page must not drift while a strip scrolls",
    ).toBeLessThanOrEqual(TOLERANCE_PX)
  })

  test("a diagonal swipe commits to one axis — the browser's own lock", async ({
    page,
  }) => {
    // the case the deleted JS lock existed for. The platform already does it, which
    // is why there is no lock and no `directionalLockEnabled` prop.
    const s = await setup(page)
    const centre = await s.reset()
    const pageBefore = await s.pageScroll()
    await touchDrag(page, s.cdp, centre, { dx: -8, dy: -3 })

    expect(await s.stripScroll()).toBeGreaterThan(TOLERANCE_PX)
    expect(
      Math.abs((await s.pageScroll()) - pageBefore),
      "a horizontal-dominant diagonal must not bleed into the page",
    ).toBeLessThanOrEqual(TOLERANCE_PX)
  })
})

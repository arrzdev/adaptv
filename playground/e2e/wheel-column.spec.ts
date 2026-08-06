import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * WheelColumn — the iOS picker drum, measured as the native scroller it is.
 *
 * The wheel IS the scroller: every index it reports is `scrollTop / itemHeight`.
 * It ships NO css scroll-snap on purpose (that truncates a fling to a crawl on
 * iOS) and JS-snaps once the glide settles. The two guarantees worth pinning are
 * reachable through the real scroll pipeline: any rest lands on a WHOLE row, and
 * the centred value follows the drum row by row rather than jumping only on rest.
 *
 * Driven with `mouse.wheel` after three instruments were tried and rejected:
 *   - `el.scrollTop = …` moves the box but does NOT fire the scroll event React's
 *     `onScroll` is bound to — the handler never runs and the value never tracks.
 *   - CDP `Input.dispatchTouchEvent` works from mid-list but is swallowed on the
 *     first gesture and will not engage a compositor scroll that BEGINS at
 *     scrollTop 0 (a CDP quirk — a real finger scrolls down from the top on the
 *     device, confirmed on the iOS sim).
 *   - `mouse.wheel` fires a genuine scroll event with neither trap.
 *
 * Two rules this page cost real time to learn, kept here so the next spec skips it:
 *   1. `scrollIntoViewIfNeeded()` the wheel FIRST — it sits far down a scrolling
 *      page, and aiming at its off-screen box makes the suite pass vacuously.
 *   2. The scroll a `mouse.wheel` triggers is ASYNC — reading `scrollTop`/the
 *      active row on the very next line reads the STALE pre-scroll value. Always
 *      settle (poll / wait) before asserting.
 *
 * ⚠︎ chromium-only. Android WebView engine; iOS WebKit (longer fling) is a sim walk.
 */

test.use({ viewport: { width: 390, height: 844 } })

const HOUR = '[aria-label="Hour"]'
const ITEM_H = 30
const LAST_HOUR = 23
const START = 9 // the lab's default centred hour (scrollTop 270)

const hourScrollTop = (page: Page) =>
  page.$eval(HOUR, (el) => (el as HTMLElement).scrollTop)

const activeHour = (page: Page) =>
  page.locator(`${HOUR} button[data-active="true"]`).first().innerText()

const label = (n: number) => String(n).padStart(2, "0")
const expectedLabel = (top: number) =>
  label(Math.min(LAST_HOUR, Math.max(0, Math.round(top / ITEM_H))))

// these tests time the async scroll pipeline. Five of them racing each other for
// one single-threaded dev server starves the timing and they flake; serial mode
// runs them in one worker (still parallel against OTHER spec files), and retries
// absorb any residual load spike from those.
test.describe.configure({ mode: "serial", retries: 2 })

test.describe("WheelColumn as a native scroller", () => {
  let cx = 0
  let cy = 0

  async function setup(page: Page) {
    await page.goto("/lab/wheel-column")
    await page.locator(HOUR).waitFor()
    await page
      .locator(`${HOUR} button[data-active="true"]`)
      .first()
      .waitFor()
    // the wheel is far down the page — bring it on screen, then park the mouse on it
    await page.locator(HOUR).scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    const box = await page.locator(HOUR).boundingBox()
    if (!box) throw new Error("the hour wheel has no layout box")
    cx = Math.round(box.x + box.width / 2)
    cy = Math.round(box.y + box.height / 2)
    await page.mouse.move(cx, cy)
    expect(await activeHour(page)).toBe(label(START))
  }

  /** Wheel over the drum, then wait for the scroll to truly SETTLE. `%ITEM_H≈0`
   *  alone is not enough — scrollTop sweeps THROUGH whole-row multiples during the
   *  glide, so a bare snap check returns mid-animation and reads a stale row. Wait
   *  for scrollTop to stop moving across a window AND be on a row. */
  async function wheel(page: Page, delta: number) {
    await page.mouse.move(cx, cy)
    await page.mouse.wheel(0, delta)
    await expect
      .poll(
        async () => {
          const a = await hourScrollTop(page)
          await page.waitForTimeout(120)
          const b = await hourScrollTop(page)
          return a === b ? b % ITEM_H : 999 // moving → keep polling
        },
        { timeout: 4000 },
      )
      .toBeLessThanOrEqual(1)
  }

  test("any rest position settles onto a whole row, never between two", async ({
    page,
  }) => {
    await setup(page)
    // a fractional distance — the classic 'rests between two rows' position.
    // wheel() itself asserts the JS-snap landed on a whole row.
    await wheel(page, ITEM_H * 3 + 15)
    expect(await activeHour(page)).toBe(
      expectedLabel(await hourScrollTop(page)),
    )
  })

  test("the centred value follows the drum row by row, not only its rest", async ({
    page,
  }) => {
    await setup(page)
    for (const _ of [1, 2, 3]) {
      await wheel(page, ITEM_H * 2)
      // the invariant: the displayed centred value always equals the row the drum
      // has scrolled to — never a lagged/only-on-rest value
      expect(
        await activeHour(page),
        "the value must match the row the drum is on",
      ).toBe(expectedLabel(await hourScrollTop(page)))
    }
    expect(
      await activeHour(page),
      "and the drum must have moved off the start row",
    ).not.toBe(label(START))
  })

  test("clamps at both ends — the value can't run past the list", async ({
    page,
  }) => {
    await setup(page)

    await wheel(page, ITEM_H * 40) // way past the bottom
    expect(await activeHour(page), "clamps to the last hour").toBe(
      label(LAST_HOUR),
    )
    expect(Math.round((await hourScrollTop(page)) / ITEM_H)).toBe(
      LAST_HOUR,
    )

    await wheel(page, -ITEM_H * 60) // way past the top
    expect(await activeHour(page), "clamps to 00").toBe("00")
    expect(await hourScrollTop(page)).toBeLessThanOrEqual(1)
  })

  test("a tap on an off-centre row rolls it to the centre", async ({
    page,
  }) => {
    await setup(page) // centred on START (09)
    await page
      .locator(`${HOUR} button`, {
        hasText: new RegExp(`^${label(START + 2)}$`),
      })
      .click()

    await expect
      .poll(() => activeHour(page), {
        message: "tapping a row must roll it to the centre",
        timeout: 2000,
      })
      .toBe(label(START + 2))
    expect((await hourScrollTop(page)) % ITEM_H).toBeLessThanOrEqual(1)
  })

  test("reaching the wheel's end does not scroll the page underneath it", async ({
    page,
  }) => {
    await setup(page)
    await wheel(page, ITEM_H * 40) // drive the drum to its bottom
    expect(await activeHour(page)).toBe(label(LAST_HOUR))

    const pageScroll = () =>
      page.evaluate(() => {
        const el = document.querySelector("[data-scroll-view='y']")
        return el ? el.scrollTop : window.scrollY
      })
    const before = await pageScroll()
    await wheel(page, ITEM_H * 20) // keep pushing past the bottom
    expect(
      Math.abs((await pageScroll()) - before),
      "overscroll-contain must keep the page still while the wheel bottoms out",
    ).toBeLessThanOrEqual(4)
  })
})

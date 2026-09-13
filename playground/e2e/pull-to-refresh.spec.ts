import type { CDPSession, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * PullToRefresh, measured with real touch (CDP `Input.dispatchTouchEvent`).
 *
 * The whole point is a gesture that exists ONLY at the top of a scroller and is
 * never confused with a scroll: pull past the threshold at the top → run the async
 * work exactly once; pull anywhere else → just scroll.
 *
 * Two harness notes this page cost real time to learn:
 *   1. Synthetic `dispatchEvent(new TouchEvent(...))` is NO GOOD here — Playwright
 *      delivers an empty `touches` list, and the component reads `e.touches[0]`, so
 *      the pull never registers and every test passes vacuously. CDP populates the
 *      touch points; use it.
 *   2. CDP touch DOES lift the content, but the lift is React state that renders a
 *      frame later — a single read after a rapid-fire move burst is STALE (reads
 *      ~0). Reading the lift BETWEEN moves both flushes the render and keeps the
 *      pull accumulating; the drag helper below does exactly that.
 *
 * ⚠︎ chromium here is the Android WebView engine; iOS WebKit — where the pull must
 * not fight the rubber band — stays a manual sim walk.
 */

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })
// the inner box is the LAST scroller on the page (the page root is first). Survives
// enabled=false, which drops the data-adaptv root.
const SCROLLER = '[data-scroll-view="y"]'
const LOG = "[data-lab-log] li"

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

const logTexts = (page: Page) => page.locator(LOG).allInnerTexts()
const startedCount = async (page: Page) =>
  (await logTexts(page)).filter((t) => /onRefresh started/.test(t)).length

/** translateY the inner box's content wrapper carries while pulling. */
const contentLift = (page: Page) =>
  page.evaluate(() => {
    const all = document.querySelectorAll('[data-scroll-view="y"]')
    const wrap = all[all.length - 1]?.parentElement
    if (!wrap) return 0
    const t = getComputedStyle(wrap).transform
    return t === "none" ? 0 : new DOMMatrixReadOnly(t).m42
  })

async function boxCentre(page: Page) {
  const box = await page.locator(SCROLLER).last().boundingBox()
  if (!box) throw new Error("the inner box has no layout box")
  return {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height * 0.25), // room to drag DOWN
  }
}

/** Drag the box by (dx, dy), reading the lift between moves so React renders and
 *  the pull accumulates. Returns the max lift seen. Leaves the finger down unless
 *  `release`. */
async function drag(
  page: Page,
  cdp: CDPSession,
  from: { x: number; y: number },
  dy: number,
  {
    dx = 0,
    steps = 16,
    release = true,
  }: { dx?: number; steps?: number; release?: boolean } = {},
) {
  await touch(cdp, "touchStart", from)
  let max = 0
  for (let s = 1; s <= steps; s += 1) {
    await touch(cdp, "touchMove", {
      x: Math.round(from.x + (dx * s) / steps),
      y: Math.round(from.y + (dy * s) / steps),
    })
    const l = await contentLift(page)
    if (l > max) max = l
  }
  if (release) await touch(cdp, "touchEnd")
  return max
}

test.describe("PullToRefresh under real touch", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "needs CDP touch injection — synthetic touch delivers no touch points",
  )

  async function setup(page: Page) {
    const cdp = await page.context().newCDPSession(page)
    await page.goto("/lab/pull-to-refresh")
    await awaitClientHandover(page)
    await page.locator(SCROLLER).last().waitFor()
    await page.locator(SCROLLER).last().scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
    // NO warm-up on purpose: this harness reliably pulls only on the FIRST CDP
    // gesture of a page (a throwaway warm-up drag degrades the next one to a stub).
    // So the measured drag IS the first gesture.
    //
    // That constraint used to be paid for with the describe's retries: a swallowed
    // gesture was retried into a page reload, hoping for a fresh first one. It was
    // never the harness swallowing it — the gesture landed on a page whose engine
    // had not mounted, which is why it read as "only the first drag works" and why
    // it only ever bit on a cold server. The handover above removes the need, and
    // the failure it used to hide (`maxLift` 0 — no lift at all) is now honest.
    return { cdp }
  }

  test("a pull past the threshold at the top refreshes exactly once", async ({
    page,
  }) => {
    const { cdp } = await setup(page)
    const from = await boxCentre(page)
    const maxLift = await drag(page, cdp, from, 150)
    expect(
      maxLift,
      "the content must lift well past the 80px threshold",
    ).toBeGreaterThan(80)

    await expect
      .poll(() => logTexts(page).then((t) => t.join("\n")), {
        timeout: 4000,
      })
      .toMatch(/onRefresh resolved/)
    expect(
      await startedCount(page),
      "one pull must not double-fire onRefresh",
    ).toBe(1)
  })

  test("a pull released below the threshold does not refresh", async ({
    page,
  }) => {
    const { cdp } = await setup(page)
    const from = await boxCentre(page)
    const maxLift = await drag(page, cdp, from, 45) // under the 80px threshold
    expect(maxLift, "a short pull still lifts a little").toBeGreaterThan(
      10,
    )
    expect(maxLift, "…but stays under the threshold").toBeLessThan(80)

    await page.waitForTimeout(400)
    expect(await startedCount(page), "a short pull must not refresh").toBe(
      0,
    )
    await expect
      .poll(() => contentLift(page), { timeout: 1500 })
      .toBeLessThanOrEqual(2) // sprang back
  })

  test("a pull is not armed unless the scroller is at the very top", async ({
    page,
  }) => {
    const { cdp } = await setup(page)
    const parked = await page.evaluate(() => {
      const all = document.querySelectorAll('[data-scroll-view="y"]')
      const box = all[all.length - 1] as HTMLElement
      box.scrollTop = 120
      return box.scrollTop
    })
    // confirm we parked the RIGHT (scrollable) element off the top before dragging —
    // otherwise this would vacuously "pass" by dragging a box that's still at top
    expect(
      parked,
      "the box must actually be scrolled off the top",
    ).toBeGreaterThan(50)
    await page.waitForTimeout(80)
    // a long downward drag from the parked box: it scrolls back to the top and
    // keeps going, but the gesture was gated at touchdown (scrollTop 120), so it
    // must never arm the pull — no refresh, and no residual lift once released
    const from = await boxCentre(page)
    await drag(page, cdp, from, 260, { steps: 24 })
    await page.waitForTimeout(300)
    expect(
      await startedCount(page),
      "pulling below the top must scroll, never refresh",
    ).toBe(0)
  })

  test("a horizontal drag never arms the pull", async ({ page }) => {
    const { cdp } = await setup(page)
    const from = await boxCentre(page)
    const maxLift = await drag(page, cdp, from, 12, {
      dx: 130,
      release: false,
    })
    expect(maxLift, "a sideways drag is not a pull").toBeLessThanOrEqual(2)
    await touch(cdp, "touchEnd")
    await page.waitForTimeout(200)
    expect(await startedCount(page)).toBe(0)
  })

  test("disabled: the refresher detaches — a pull does nothing", async ({
    page,
  }) => {
    const { cdp } = await setup(page)
    await page.getByRole("button", { name: /^enabled:/i }).click()
    await page.waitForTimeout(150)
    const from = await boxCentre(page)
    const maxLift = await drag(page, cdp, from, 120) // would refresh if live
    expect(
      maxLift,
      "a disabled refresher must not lift",
    ).toBeLessThanOrEqual(2)
    await page.waitForTimeout(300)
    expect(
      await startedCount(page),
      "a disabled refresher must never fire",
    ).toBe(0)
  })
})

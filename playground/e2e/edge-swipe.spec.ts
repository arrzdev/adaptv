import type { CDPSession } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * EdgeSwipeGestures — a back/forward gesture for the shells that took the OS one
 * away. The whole contract is "only an edge-started, horizontal-dominant drag past
 * the threshold counts": a swipe from the left edge fires left, from the right edge
 * fires right, and a swipe from the middle — or one too short — fires nothing.
 *
 * It reads `event.touches[0]` / `changedTouches[0]`, so — exactly like PullToRefresh
 * — Playwright's synthetic TouchEvent (empty touch list) is inert and the gesture
 * must be driven with real touch via CDP `Input.dispatchTouchEvent`. That is
 * chromium-only (the Android WebView engine); the iOS WebKit edge case, where this
 * must NOT double-fire with the platform's own swipe, stays a manual sim walk.
 *
 * The probe on the page ships disarmed and LOGS instead of navigating, so a whole
 * battery of swipes runs on one page without leaving it.
 */

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })
// serial: five of these arming a probe and firing CDP touch at one dev server in
// parallel starves it, and the arm click races hydration. One worker is instant
// and deterministic; retries absorb load from other spec files.
test.describe.configure({ mode: "serial", retries: 2 })

const LOG = "[data-lab-log] li"
const VW = 390
const MID_Y = 422 // vertically centred, well clear of any edge strip

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

/** A horizontal drag from `fromX` to `toX` at a fixed y — start, glide, release. */
async function swipe(
  cdp: CDPSession,
  fromX: number,
  toX: number,
  y = MID_Y,
) {
  await touch(cdp, "touchStart", { x: fromX, y })
  const steps = 6
  for (let s = 1; s <= steps; s += 1) {
    await touch(cdp, "touchMove", {
      x: Math.round(fromX + ((toX - fromX) * s) / steps),
      y,
    })
  }
  // release with the finger at toX — the recogniser reads changedTouches here
  await touch(cdp, "touchEnd")
}

test.describe("EdgeSwipeGestures under real touch", () => {
  let cdp: CDPSession

  test.beforeEach(async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium",
      "CDP touch injection is chromium-only",
    )
    cdp = await page.context().newCDPSession(page)
    await page.goto("/lab/edge-swipe")
    // it ships disarmed so it cannot double up with the shell's own back swipe;
    // the button label flipping to "disarm" is the unambiguous armed signal
    await page.getByRole("button", { name: "arm the probe" }).click()
    await expect(
      page.getByRole("button", { name: "disarm the probe" }),
    ).toBeVisible()
  })

  const swipeCount = async (
    page: import("@playwright/test").Page,
    re: RegExp,
  ) =>
    (await page.locator(LOG).allInnerTexts()).filter((t) => re.test(t))
      .length

  test("a swipe in from the LEFT edge fires the left handler", async ({
    page,
  }) => {
    await swipe(cdp, 8, 140) // starts inside the 30px strip, travels 132px > 56
    await expect.poll(() => swipeCount(page, /left edge swipe/)).toBe(1)
    expect(await swipeCount(page, /right edge swipe/)).toBe(0)
  })

  test("a swipe in from the RIGHT edge fires the right handler", async ({
    page,
  }) => {
    await swipe(cdp, VW - 8, VW - 140)
    await expect.poll(() => swipeCount(page, /right edge swipe/)).toBe(1)
    expect(await swipeCount(page, /left edge swipe/)).toBe(0)
  })

  test("a swipe from the MIDDLE fires nothing", async ({ page }) => {
    await swipe(cdp, VW / 2, VW / 2 + 140)
    await page.waitForTimeout(200)
    expect(await page.locator(LOG).count()).toBe(0)
  })

  test("an edge touch that does not cross the threshold fires nothing", async ({
    page,
  }) => {
    await swipe(cdp, 8, 8 + 30) // 30px < 56px threshold
    await page.waitForTimeout(200)
    expect(await page.locator(LOG).count()).toBe(0)
  })

  test("a disarmed probe fires nothing", async ({ page }) => {
    await page.getByRole("button", { name: "disarm the probe" }).click()
    await swipe(cdp, 8, 140)
    await page.waitForTimeout(200)
    expect(await page.locator(LOG).count()).toBe(0)
  })
})

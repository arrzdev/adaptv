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

/*
 * The real wiring, not the probe. Two screens mount this for real — the settings
 * page and the lab shell every /lab/* page renders through — and both must be
 * escapable with a left-edge swipe. The probe above proves the recogniser; this
 * proves the app navigates with it, which failed independently once already:
 * both armed the gesture on `(display-mode: standalone)`, and the installed app
 * they exist to serve is just as often a Capacitor WebView, which reports
 * `browser`. The gesture was dead on exactly the target that needs it.
 *
 * "Installed" is faked with `navigator.standalone` — the legacy iOS home-screen
 * signal, and the one installed-app signal a headless Chromium tab can actually
 * be given (`Emulation.setEmulatedMedia` has no `display-mode` feature, and the
 * native half of `isInstalledApp()` is a Capacitor global that belongs on a
 * simulator). It goes through the same `isInstalledApp()` both screens gate on,
 * and the assertion below checks the framework agreed — `data-adaptv-platform`
 * must read `standalone`, or the test is measuring a browser tab.
 *
 * Note the app switches to MEMORY history once installed, so a navigation shows
 * up in the rendered page, never in `page.url()`. Assert on the screen.
 */
test.describe("the app's edge-swipe back", () => {
  const BACK_TO_TASKS = "Back to tasks" // settings-only control
  const CREATE_TASK = "Create task" // home-only control

  /**
   * Wait for the client to actually take over. Every control on this page is
   * server-rendered, so `toBeVisible()` passes on inert HTML and a swipe fired at
   * that moment hits a document with no listeners on it yet — the gesture is
   * attached by an effect. The splash is SSR-rendered too and self-unmounts only
   * once the client has hydrated and the local store has seeded, so its
   * disappearance is the one honest "React is driving now" signal on the page.
   */
  async function awaitClientHandover(
    page: import("@playwright/test").Page,
  ) {
    await expect(page.locator("[data-adaptv-splash]")).toHaveCount(0)
  }

  /** Load a route with the tab claiming to be an installed (standalone) app. */
  async function gotoInstalled(
    page: import("@playwright/test").Page,
    path: string,
  ) {
    //must be in place BEFORE the load: the page reads the installed signal once
    //on mount, and the router picks its history at boot from the same signal
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, "standalone", {
        value: true,
        configurable: true,
      })
    })
    const cdp = await page.context().newCDPSession(page)
    await page.goto(path)
    await awaitClientHandover(page)
    return cdp
  }

  test("standalone: a swipe in from the LEFT edge lands on the home page", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "CDP touch injection is chromium-only",
    )
    const cdp = await gotoInstalled(page, "/settings")
    await expect(
      page.getByRole("button", { name: BACK_TO_TASKS }),
    ).toBeVisible()
    expect(
      await page.evaluate(
        () => document.documentElement.dataset.adaptvPlatform,
      ),
      "the app did not resolve as installed — the gate under test is off",
    ).toBe("standalone")

    await swipe(cdp, 8, 140)

    await expect(
      page.getByRole("button", { name: CREATE_TASK }),
    ).toBeVisible()
    await expect(
      page.getByRole("button", { name: BACK_TO_TASKS }),
    ).toHaveCount(0)
  })

  test("standalone: a lab page's swipe back lands on the testing index", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "CDP touch injection is chromium-only",
    )
    // any /lab/* page will do — the gesture lives in the shared LabPage shell,
    // not in the page, and this one carries no gesture of its own to collide with
    const cdp = await gotoInstalled(page, "/lab/text")
    await expect(
      page.getByRole("heading", { level: 1, name: "Text" }),
    ).toBeVisible()

    await swipe(cdp, 8, 140)

    await expect(
      page.getByRole("heading", { level: 1, name: "Testing" }),
    ).toBeVisible()
  })

  test("standalone: a swipe from the MIDDLE stays on settings", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "CDP touch injection is chromium-only",
    )
    const cdp = await gotoInstalled(page, "/settings")
    await expect(
      page.getByRole("button", { name: BACK_TO_TASKS }),
    ).toBeVisible()

    await swipe(cdp, VW / 2, VW / 2 + 140)

    await page.waitForTimeout(300)
    await expect(
      page.getByRole("button", { name: BACK_TO_TASKS }),
    ).toBeVisible()
  })

  test("browser tab: the edge swipe stays OFF (the browser owns that edge)", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "CDP touch injection is chromium-only",
    )
    const cdp = await page.context().newCDPSession(page)
    await page.goto("/settings")
    await awaitClientHandover(page)
    expect(
      await page.evaluate(
        () => document.documentElement.dataset.adaptvPlatform,
      ),
    ).toBe("web")
    await expect(
      page.getByRole("button", { name: BACK_TO_TASKS }),
    ).toBeVisible()

    await swipe(cdp, 8, 140)

    await page.waitForTimeout(300)
    await expect(
      page.getByRole("button", { name: BACK_TO_TASKS }),
    ).toBeVisible()
  })
})

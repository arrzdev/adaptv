import type { CDPSession } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

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
// parallel starves it. One worker is instant and deterministic.
//
// "and the arm click races hydration" used to be written here as a fact of life,
// with `retries: 2` to ride it out. It is a bug, not a fact of life, and
// `awaitClientHandover` fixes it — so the retries are gone: a red run here now
// means something real, reported the first time.
test.describe.configure({ mode: "serial" })

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

/*
 * Both describes need the hydration gate (`awaitClientHandover`,
 * e2e/support/hydrated.ts): a swipe fired early hits a document with no gesture
 * listener on it yet (it is attached by an effect), and a click hits a button whose
 * handler is not attached yet. The probe describe looked immune because it *asserts*
 * the arm click took ("arm the probe" → "disarm the probe"), but that only turns a
 * lost click into a failing `beforeEach` — which is precisely how it presented: the
 * first test of a cold run failing on a button label, with its four serial siblings
 * never running.
 */

test.describe("EdgeSwipeGestures under real touch", () => {
  let cdp: CDPSession

  test.beforeEach(async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium",
      "CDP touch injection is chromium-only",
    )
    cdp = await page.context().newCDPSession(page)
    await page.goto("/lab/edge-swipe")
    await awaitClientHandover(page)
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

  /*
   * The swipe is a BACK press, so an open overlay has to take it before the route
   * does — the order the back chain gives Android's back button. It used to call
   * `router.navigate` straight away, and on an iOS 18.0 simulator the installed app
   * left the page with the drawer still open on it, 2 of 2. The page is reached by
   * an in-app tap here, so the second swipe has history to pop, the way a user
   * gets there.
   */
  const PANEL = "[data-pwa-drawer]"

  test("standalone: with a lab drawer open, the swipe closes the drawer before it leaves the page", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "CDP touch injection is chromium-only",
    )
    const cdp = await gotoInstalled(page, "/lab")
    expect(
      await page.evaluate(
        () => document.documentElement.dataset.adaptvPlatform,
      ),
    ).toBe("standalone")
    await page
      .getByRole("link", { name: /^Drawer\b/ })
      .first()
      .click()
    await expect(
      page.getByRole("heading", { level: 1, name: "Drawer" }),
    ).toBeVisible()
    await page.getByRole("button", { name: "Open basic drawer" }).click()
    await expect(page.locator(PANEL)).toBeVisible()

    await swipe(cdp, 8, 140)

    await expect(page.locator(PANEL)).toHaveCount(0)
    await expect(
      page.getByRole("heading", { level: 1, name: "Drawer" }),
    ).toBeVisible()

    //with nothing open the same swipe is back again: it pops the tap that got here,
    //rather than pushing the fallback on top of it
    await swipe(cdp, 8, 140)

    await expect(
      page.getByRole("heading", { level: 1, name: "Testing" }),
    ).toBeVisible()
    expect(
      await page.evaluate(() =>
        (
          window as unknown as {
            __TSR_ROUTER__: { history: { canGoBack(): boolean } }
          }
        ).__TSR_ROUTER__.history.canGoBack(),
      ),
    ).toBe(false)
  })

  test("standalone: with a settings drawer open, the swipe closes the drawer and stays on settings", async ({
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
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .click()
    await expect(page.locator(PANEL)).toBeVisible()

    await swipe(cdp, 8, 140)

    await expect(page.locator(PANEL)).toHaveCount(0)
    await expect(
      page.getByRole("button", { name: BACK_TO_TASKS }),
    ).toBeVisible()

    //the gesture is still live, and the press the drawer consumed left nothing behind:
    //with no history on a cold launch, the next swipe reaches the fallback
    await swipe(cdp, 8, 140)

    await expect(
      page.getByRole("button", { name: CREATE_TASK }),
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

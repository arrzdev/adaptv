import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

// Screen-level guards for the shell's full-screen overlays. Unlike smoke.spec,
// these assert on what the user can actually reach.

const SPLASH_SELECTOR = "[data-adaptv-splash]"

// A cold start straight into a 404 used to leave the launch splash mounted: the
// not-found boundary is the root route, so no layout route below it mounts, so the
// provider that flips the app's bootstrap gate never runs and the splash — which
// self-unmounts off that gate — never returned null. On native the leftover
// overlay (fixed, z-100, opaque, pointer-events on) covered the 404 permanently;
// on the web it was invisible only because the critical-CSS policy renders it
// `display: none` off the platform stamp, which is why this asserts on the element
// being GONE rather than on what it looks like.
test("the splash unmounts on a 404 route too", async ({ page }) => {
  await page.goto("/lab/definitely-not-a-route")

  // the 404 screen is up
  const home = page.getByRole("link", { name: /back home/i })
  await expect(home).toBeVisible()

  // no splash left in the DOM at all — the check that fails on web too, where a
  // leftover splash is display:none and therefore invisible but still covering.
  // Deliberately NOT the hydration gate: the not-found page renders no splash at all,
  // so the gate would resolve on the server's HTML and this is the claim itself.
  await expect.poll(() => page.locator(SPLASH_SELECTOR).count()).toBe(0)

  // and the 404 is genuinely reachable: this click fails if any overlay is
  // intercepting pointer events over the button
  await home.click()
  await expect(page).toHaveURL(/\/$/)
})

// Guards the test above against going vacuous — and with it the hydration gate every
// spec waits on (e2e/support/hydrated.ts). All of them pass for free if
// `data-adaptv-splash` is ever renamed, so pin the name to the one place the build
// also writes it: the pre-paint splash policy in the critical CSS.
test("the splash attribute the guards query is the one the shell ships", async ({
  page,
}) => {
  await page.goto("/")

  const criticalCss = await page.evaluate(() =>
    [...document.querySelectorAll("head style")]
      .map((style) => style.textContent ?? "")
      .join(""),
  )
  expect(criticalCss).toContain("data-adaptv-splash")
})

test.describe("full-screen chrome", () => {
  test("a bad route renders the app's own 404, not the router's error page", async ({
    page,
  }) => {
    await page.goto("/lab/screens")
    await awaitClientHandover(page)
    await page.getByRole("link", { name: /client navigation/i }).click()

    //the app's screen, identified by content it and only it renders
    await expect(
      page.getByText("404", { exact: false }).first(),
    ).toBeVisible()
    const back = page.getByRole("link", { name: /back home/i })
    await expect(back, "the 404 must offer a way out").toBeVisible()

    //a raw router error or a blank page is the failure — assert neither
    const body = (await page.locator("body").innerText()).toLowerCase()
    expect(body).not.toContain("unexpected error")
    expect(
      body.trim().length,
      "a blank page is the other failure",
    ).toBeGreaterThan(20)
  })

  test("the server-rendered 404 matches the client-navigated one", async ({
    page,
  }) => {
    //different code path: this one never runs the client router's not-found handling
    await page.goto("/lab/definitely-not-a-route")
    await expect(
      page.getByText("404", { exact: false }).first(),
    ).toBeVisible()
    await expect(
      page.getByRole("link", { name: /back home/i }),
    ).toBeVisible()
  })

  test("Back home from the 404 lands on a working app", async ({
    page,
  }) => {
    await page.goto("/lab/definitely-not-a-route")
    //No hydration gate, on purpose: it would be VACUOUS here. The not-found page
    //renders no splash (no layout route mounts under the root boundary), so the gate
    //resolves on the server's HTML — measured: no splash in any frame, and React
    //attaching ~2s after `goto` returns. The click still proves the claim, because
    //Back home is a real `<a href>`: before hydration it is a document navigation to
    //`/`, after it a client one, and both must land on a working app.
    await page.getByRole("link", { name: /back home/i }).click()

    await expect(page.locator("[data-adaptv-screen] > *")).toBeVisible()
    //…and the shell is genuinely alive, not a rendered husk
    await expect(page.locator("[data-app-shell]")).toBeVisible()
    expect(new URL(page.url()).pathname).not.toContain(
      "definitely-not-a-route",
    )
  })

  test("the splash overlay leaves nothing behind after boot", async ({
    page,
  }) => {
    /*
     * The overlay self-unmounts by returning null, so by the time any route exists it
     * should be gone. If it is not, it is a `fixed inset-0` element over the whole app
     * silently swallowing every tap — which presents as "the app stopped responding",
     * never as "the splash is still there".
     */
    await page.goto("/lab/screens")
    await page.locator("[data-adaptv-screen]").waitFor()

    await awaitClientHandover(page)

    //the page's own live readout must agree — if it does not, one of the two is lying
    await expect(page.getByText("gone, as expected")).toBeVisible()
  })

  test("the orientation readout reports a real orientation", async ({
    page,
  }) => {
    /*
     * Deliberately NOT "it tracks the window". `useOrientation` wraps
     * `screen.orientation`, which on a desktop browser reports the MONITOR — so it
     * reads landscape however narrow the window is, and resizing never moves it. That
     * is the API behaving correctly for a device-first framework, and the page now
     * says so. What is still worth pinning is that the value is real rather than the
     * SSR placeholder: a readout stuck on the server's `portrait-primary` guess would
     * mean the hook never hydrated, and no manual pass on a desktop would catch it.
     */
    await page.goto("/lab/screens")
    //the readout is the hook's CLIENT value; before hydration it is the SSR placeholder
    await awaitClientHandover(page)

    const orientation = await page.evaluate(
      () => (screen.orientation as ScreenOrientation | undefined)?.type,
    )
    expect(orientation).toBeTruthy()
    await expect(
      page.getByText(orientation as string, { exact: true }),
    ).toBeVisible()
  })
})

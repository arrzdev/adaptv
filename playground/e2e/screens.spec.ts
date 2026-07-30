import { expect, test } from "@playwright/test"

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
  // leftover splash is display:none and therefore invisible but still covering
  await expect.poll(() => page.locator(SPLASH_SELECTOR).count()).toBe(0)

  // and the 404 is genuinely reachable: this click fails if any overlay is
  // intercepting pointer events over the button
  await home.click()
  await expect(page).toHaveURL(/\/$/)
})

// Guards the test above against going vacuous. Both assertions there pass for free
// if `data-adaptv-splash` is ever renamed, so pin the name to the one place the
// build also writes it: the pre-paint splash policy in the critical CSS.
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

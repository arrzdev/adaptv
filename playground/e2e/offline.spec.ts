import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * Offline — the whole-screen fallback. Two things matter here and both are
 * headless-testable without a device:
 *
 *   1. reachability flips when the CONTEXT goes offline, with no reload — this is
 *      the one signal a browser can give honestly, and `context.setOffline` drives
 *      the exact `online`/`offline` events `useIsOffline()` listens to;
 *   2. the accepted `error` prop — which the lab deliberately loads with a fake
 *      token — is NEVER painted onto the screen. This is the screen users
 *      screenshot into support tickets, so a leaked token is a security bug, and
 *      that makes it worth a test rather than a code comment.
 */

const SCREEN = '[data-adaptv="offline"]'

/**
 * Wait for the client to take over before pressing anything.
 *
 * The offline screen and both of its buttons are server-rendered, so the
 * `waitFor()` below is satisfied by inert HTML: a click fired in that window
 * lands on a button whose handler is not attached yet, so "custom copy"
 * never swaps the copy and "Try again" never moves the counter — and the
 * assertion then reports the DEFAULT screen as though the component had
 * ignored its props. It is not load flake: Playwright boots its own dev
 * server and tears it down per run, so the FIRST test to reach this route
 * pays the cold transform cost and loses the race while every test after it
 * wins. A dev session left running hides it entirely, because
 * `reuseExistingServer` then hands the suite a warm server.
 *
 * The splash is server-rendered too and self-unmounts only once the client
 * has hydrated and the local store has seeded, so its disappearance is the
 * one honest "React is driving now" signal on the page. Given a generous
 * timeout on purpose — the case it exists for is a cold server, where the
 * route's first transform can take longer than the 5s default.
 */
async function awaitClientHandover(page: Page) {
  await expect(page.locator("[data-adaptv-splash]")).toHaveCount(0, {
    timeout: 20_000,
  })
}

test.describe("Offline", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/offline")
    await awaitClientHandover(page)
    await page.locator(SCREEN).first().waitFor()
  })

  test("reachability flips with the network, no reload", async ({
    page,
    browserName,
  }) => {
    // WebKit's `setOffline` blocks the network but does NOT dispatch the JS
    // `online`/`offline` events the hook listens to, so the flip cannot be driven
    // there — this asserts the hook's reactivity, not an engine difference, so
    // chromium is the honest place to prove it. (The coarse-reachability caveat the
    // page documents is a device concern, walked on the simulator.)
    test.skip(
      browserName !== "chromium",
      "setOffline fires no online/offline events in WebKit",
    )
    // the live row reads `String(useIsOffline())` — the only true/false on the page
    await expect(page.getByText("false", { exact: true })).toBeVisible()

    await page.context().setOffline(true)
    await expect(page.getByText("true", { exact: true })).toBeVisible()
    // still the same document — a flip, not a navigation
    await expect(page).toHaveURL(/\/lab\/offline$/)

    await page.context().setOffline(false)
    await expect(page.getByText("false", { exact: true })).toBeVisible()
  })

  test("retry runs the recovery action", async ({ page }) => {
    // the default screen's button; onRetry increments the counter in the row below
    const row = page
      .getByText("onRetry calls", { exact: true })
      .locator("..")
    await expect(row).toContainText("0")
    await page.getByRole("button", { name: "Try again" }).click()
    await expect(row).toContainText("1")
    await page.getByRole("button", { name: "Try again" }).click()
    await expect(row).toContainText("2")
  })

  test("never renders the error object, and swaps copy wholesale", async ({
    page,
  }) => {
    // the custom copy passes error={new Error("https://api.example.com?token=SECRET")}
    await page.getByRole("button", { name: "custom copy" }).click()

    // the copy changed — title, description and label all swapped
    await expect(page.locator(SCREEN)).toContainText(
      "Can't reach ChopChop",
    )
    await expect(
      page.getByRole("button", { name: "Retry now" }),
    ).toBeVisible()

    // …but nothing from the error leaked onto the screen
    await expect(page.locator("body")).not.toContainText("SECRET")
    await expect(page.locator("body")).not.toContainText("api.example.com")
  })
})

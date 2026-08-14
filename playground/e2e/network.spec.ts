import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * Network — the reachability capability. On the web it is `navigator.onLine`, which
 * `context.setOffline` drives directly: it fires the same online/offline events the
 * hook and the `subscribeOnline` pair listen to. chromium-only — WebKit's setOffline
 * blocks the network without dispatching those events. The coarse-vs-accurate signal
 * split (a captive portal still reads online on the web) is a device fact, walked on
 * the sim; here the page even reports "coarse" honestly.
 */

/**
 * Wait for the client to take over before driving the network.
 *
 * The reachability row is server-rendered as its initial value, and
 * `useIsOnline` / `subscribeOnline` only start listening once their effects
 * run. Flip the context offline before that and the events fire into a page
 * with no subscribers: the row keeps showing the server's value and the
 * subscription log stays empty, which reads as the capability not being
 * reactive at all. It is not load flake: Playwright boots its own dev server
 * and tears it down per run, so the FIRST test to reach this route pays the
 * cold transform cost and loses the race while every test after it wins. A
 * dev session left running hides it, because `reuseExistingServer` then hands
 * the suite a warm server.
 *
 * The splash is server-rendered too and self-unmounts only once the client
 * has hydrated and the local store has seeded, so its disappearance is the
 * one honest "React is driving now" signal on the page. Given a generous
 * timeout on purpose — a cold route's first transform can outrun the 5s
 * default, and a tight timeout here would re-create the flake it removes.
 */
async function awaitClientHandover(page: Page) {
  await expect(page.locator("[data-adaptv-splash]")).toHaveCount(0, {
    timeout: 20_000,
  })
}

test.describe("Network reachability", () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium",
      "setOffline fires no online/offline events in WebKit",
    )
    await page.goto("/lab/network")
    await awaitClientHandover(page)
  })

  test("the reachability row and the subscription flip with the network", async ({
    page,
  }) => {
    await expect(page.getByText("online", { exact: true })).toBeVisible()

    await page.context().setOffline(true)
    await expect(page.getByText("offline", { exact: true })).toBeVisible()
    // subscribeOnline logged exactly this change (one event, at the top)
    await expect(page.locator("[data-lab-log] li").first()).toContainText(
      "getOnline() → false",
    )

    await page.context().setOffline(false)
    await expect(page.getByText("online", { exact: true })).toBeVisible()
    await expect(page.locator("[data-lab-log] li").first()).toContainText(
      "getOnline() → true",
    )
  })

  test("the web target reports its coarse signal quality honestly", async ({
    page,
  }) => {
    await expect(page.getByText("coarse (navigator.onLine)")).toBeVisible()
  })
})

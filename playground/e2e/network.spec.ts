import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Network — the reachability capability. On the web it is `navigator.onLine`, which
 * `context.setOffline` drives directly: it fires the same online/offline events the
 * hook and the `subscribeOnline` pair listen to. chromium-only — WebKit's setOffline
 * blocks the network without dispatching those events. The coarse-vs-accurate signal
 * split (a captive portal still reads online on the web) is a device fact, walked on
 * the sim; here the page even reports "coarse" honestly.
 */

/*
 * The reachability row is server-rendered as its initial value, and `useIsOnline` /
 * `subscribeOnline` only start listening once their effects run. Flip the context
 * offline before the hydration gate (`awaitClientHandover`, e2e/support/hydrated.ts)
 * and the events fire into a page with no subscribers: the row keeps showing the
 * server's value and the subscription log stays empty, which reads as the capability
 * not being reactive at all.
 */

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

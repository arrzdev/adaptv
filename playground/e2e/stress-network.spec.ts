import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Network under a toggle storm — twenty `setOffline` flips in two seconds.
 *
 * `network.spec.ts` flips the context once each way. Here the reachability row
 * and the raw subscription are driven through twenty flips faster than any
 * network interface bounces, and the contract is the one `src/capabilities/
 * network.ts` states: one notification per event, the row reads the latest
 * `navigator.onLine`, and the last flip wins — whichever way the storm ends.
 *
 * chromium-only, like network.spec.ts: WebKit's `setOffline` blocks the network
 * without dispatching the online/offline events the capability listens to.
 * The premise — that the engine really dispatched one event per flip — is
 * counted by a listener the test installs beside the app's, so a coalescing
 * engine fails by name rather than passing on fewer events.
 */

test.describe("Network under a toggle storm", () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium",
      "setOffline fires no online/offline events in WebKit",
    )
    await page.goto("/lab/network")
    await awaitClientHandover(page)
    await expect(page.getByText("online", { exact: true })).toBeVisible()
    await page.evaluate(() => {
      const seen: string[] = []
      window.addEventListener("online", () => seen.push("online"))
      window.addEventListener("offline", () => seen.push("offline"))
      ;(window as { __netEvents?: string[] }).__netEvents = seen
    })
  })

  const events = (page: import("@playwright/test").Page) =>
    page.evaluate(
      () => (window as { __netEvents?: string[] }).__netEvents ?? [],
    )

  test("twenty flips are twenty log lines in order, and the row ends online", async ({
    page,
  }) => {
    const context = page.context()
    for (let flip = 0; flip < 20; flip += 1) {
      await context.setOffline(flip % 2 === 0)
    }

    await expect
      .poll(() => events(page), { message: "the premise: 20 events" })
      .toHaveLength(20)
    await expect(page.getByText("online", { exact: true })).toBeVisible()

    //the log is newest-first and holds 40 lines, so all twenty are there —
    //read once the app's own twenty lines have committed, not the test's count
    await expect(page.locator("[data-lab-log] li")).toHaveCount(20)
    const lines = await page.locator("[data-lab-log] li").allInnerTexts()
    const values = lines.map((line) => line.split("getOnline() → ")[1])
    expect(values).toEqual(
      Array.from({ length: 20 }, (_, index) =>
        index % 2 === 0 ? "true" : "false",
      ),
    )
  })

  test("a storm that ends offline leaves the row offline, and coming back is one line", async ({
    page,
  }) => {
    const context = page.context()
    for (let flip = 0; flip < 19; flip += 1) {
      await context.setOffline(flip % 2 === 0)
    }
    await expect.poll(() => events(page)).toHaveLength(19)
    await expect(page.getByText("offline", { exact: true })).toBeVisible()
    await expect(page.locator("[data-lab-log] li").first()).toContainText(
      "getOnline() → false",
    )

    await context.setOffline(false)
    await expect.poll(() => events(page)).toHaveLength(20)
    await expect(page.getByText("online", { exact: true })).toBeVisible()
    await expect(page.locator("[data-lab-log] li")).toHaveCount(20)
    const lines = await page.locator("[data-lab-log] li").allInnerTexts()
    expect(lines[0]).toContain("getOnline() → true")
  })
})

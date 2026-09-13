import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Geolocation — the four-state permission exemplar every other gated capability
 * copies. Playwright models the permission side directly: no grant → the Permissions
 * API reports `prompt`; grant → `granted`. That is the state machine this page exists
 * to demonstrate. The actual position READ hangs under Playwright (the Capacitor web
 * plugin does not consume Playwright's setGeolocation mock), and `denied` /
 * `unavailable` are OS states Playwright cannot fake — all three are walked on the
 * sim. chromium — WebKit historically has no geolocation Permissions query.
 */

test.describe("Geolocation permission model", () => {
  test.beforeEach(async ({ browserName }) => {
    test.skip(
      browserName !== "chromium",
      "geolocation grant + Permissions query are reliable on chromium",
    )
  })

  test("reports `prompt` before access is granted", async ({ page }) => {
    await page.goto("/lab/geolocation")
    await awaitClientHandover(page)
    await page.getByRole("button", { name: "Check (no prompt)" }).click()
    await expect(
      page.getByText("state", { exact: true }).locator(".."),
    ).toContainText("prompt")
  })

  test("resolves to `granted` once the permission is granted", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["geolocation"])
    await page.goto("/lab/geolocation")
    await awaitClientHandover(page)

    await page.getByRole("button", { name: "Check (no prompt)" }).click()
    await expect(
      page.getByText("state", { exact: true }).locator(".."),
    ).toContainText("granted")
  })
})

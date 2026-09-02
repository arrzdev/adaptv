import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * Privacy screen — the app's content kept out of the switcher and, on Android,
 * out of captures. A browser has neither, and the honest answer is what this
 * spec pins: support reads `unsupported`, the state reads `—` (nothing to
 * ask), the caveat says why in words, and every button resolves the word
 * `unsupported` rather than throwing or pretending. The native behaviours are
 * measured on the simulator and the emulator, not here.
 */

async function awaitClientHandover(page: Page) {
  await expect(page.locator("[data-adaptv-splash]")).toHaveCount(0, {
    timeout: 20_000,
  })
}

test.describe("Privacy screen", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/privacy-screen")
    await awaitClientHandover(page)
  })

  test("a browser reads unsupported, with the reason in words", async ({
    page,
  }) => {
    await expect(page.getByTestId("privacy-support")).toHaveText(
      "unsupported",
      { timeout: 5_000 },
    )
    await expect(page.getByTestId("privacy-enabled")).toHaveText("—")
    await expect(page.getByTestId("privacy-caveat")).toContainText(
      "No browser exposes a way",
    )
    await expect(page.getByTestId("privacy-last")).toHaveText("—")
  })

  test("every switch resolves the word unsupported and moves nothing", async ({
    page,
  }) => {
    await expect(page.getByTestId("privacy-support")).toHaveText(
      "unsupported",
      { timeout: 5_000 },
    )
    for (const id of [
      "privacy-enable",
      "privacy-enable-obscure",
      "privacy-disable",
    ]) {
      await page.getByTestId(id).click()
      await expect(page.getByTestId("privacy-last")).toHaveText(
        "unsupported",
      )
      await expect(page.getByTestId("privacy-enabled")).toHaveText("—")
    }
  })
})

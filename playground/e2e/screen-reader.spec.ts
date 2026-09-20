import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Screen reader — the status is the OS's answer on native and `unknown` on the
 * web, where no browser exposes whether a reader runs. What a browser CAN do
 * is announce: a polite ARIA live region that a running reader speaks and an
 * absent one ignores. The spec pins both halves: the honest word, and the
 * region's existence, attributes and text after an announcement — including
 * that a repeated announcement is a fresh mutation, because a live region
 * announces changes and the same text set twice is not one.
 */

test.describe("Screen reader", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/screen-reader")
    await awaitClientHandover(page)
  })

  test("a browser reads unknown and has no live region until something is announced", async ({
    page,
  }) => {
    await expect(page.getByTestId("reader-status")).toHaveText("unknown")
    await expect(page.getByTestId("reader-last")).toHaveText("—")
    await expect(page.locator("[data-adaptv-announcer]")).toHaveCount(0)
  })

  test("announce writes one polite live region and reads announced, twice", async ({
    page,
  }) => {
    await page.getByTestId("reader-announce").click()
    await expect(page.getByTestId("reader-last")).toHaveText("announced")
    const region = page.locator("[data-adaptv-announcer]")
    await expect(region).toHaveCount(1)
    await expect(region).toHaveAttribute("role", "status")
    await expect(region).toHaveAttribute("aria-live", "polite")
    await expect(region).toHaveText("Two items saved")

    await page.getByTestId("reader-text").fill("Done")
    await page.getByTestId("reader-announce").click()
    await expect(region).toHaveText("Done")
    await expect(page.locator("[data-adaptv-announcer]")).toHaveCount(1)
    await expect(page.getByTestId("reader-status")).toHaveText("unknown")
  })
})

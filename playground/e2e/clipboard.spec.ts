import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Clipboard — read and write are two capabilities, not one. Copy is ungated on a
 * secure origin (localhost qualifies), so it is the direction a headless browser can
 * drive: grant the permission, copy, and read the bytes back out. Paste is
 * permission/gesture-gated — a real dialog on Chromium, a Safari paste button on
 * WebKit — so it stays a sim/manual check. chromium: Playwright's clipboard grants
 * and readText are reliable there.
 */

/*
 * Without the hydration gate (`awaitClientHandover`, e2e/support/hydrated.ts) a click
 * lands on a copy button whose handler is not attached yet, `copy()` never runs, and
 * the outcome row still reads "not attempted yet" when the assertion looks. Only the
 * empty-string test ever flaked: the other one waits on "Copy available", and
 * `canWrite` starts false and is set in an effect, so that wait was an accidental
 * hydration barrier.
 */

test.describe("Clipboard copy", () => {
  test.beforeEach(async ({ context, browserName, page }) => {
    test.skip(
      browserName !== "chromium",
      "clipboard grants + readText are reliable on chromium",
    )
    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    await page.goto("/lab/clipboard")
    await awaitClientHandover(page)
  })

  const outcome = (page: Page) =>
    page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: "Last outcome" }) })

  test("copy is available and writes the text to the clipboard", async ({
    page,
  }) => {
    await expect(page.getByText("Copy available")).toBeVisible()

    await page.getByLabel("Text to copy").fill("hello-adaptv-clipboard")
    await page.getByRole("button", { name: "Copy", exact: true }).click()

    await expect(outcome(page)).toContainText("ok")
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "hello-adaptv-clipboard",
    )
  })

  test("copying an empty string is a no-op, not a throw", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: "Copy an empty string" })
      .click()

    await expect(outcome(page)).toContainText("ok")
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "",
    )
  })
})

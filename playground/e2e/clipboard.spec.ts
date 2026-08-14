import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * Clipboard — read and write are two capabilities, not one. Copy is ungated on a
 * secure origin (localhost qualifies), so it is the direction a headless browser can
 * drive: grant the permission, copy, and read the bytes back out. Paste is
 * permission/gesture-gated — a real dialog on Chromium, a Safari paste button on
 * WebKit — so it stays a sim/manual check. chromium: Playwright's clipboard grants
 * and readText are reliable there.
 */

/**
 * Wait for the client to take over before pressing anything.
 *
 * Both copy buttons are server-rendered, so Playwright's own actionability
 * check — and any `waitFor()`/`toBeVisible()` — is satisfied by inert HTML:
 * a click fired in that window lands on a button whose handler is not
 * attached yet, `copy()` never runs, and the outcome row still reads "not
 * attempted yet" when the assertion looks. It presents as the component
 * being broken, and it is not load flake: Playwright boots its own dev
 * server and tears it down per run, so the FIRST test to reach this route
 * pays the cold transform cost and loses the race while every test after it
 * wins. A dev session left running hides it entirely, because
 * `reuseExistingServer` then hands the suite a warm server.
 *
 * (Which is why only the empty-string test ever flaked: the other one waits
 * on "Copy available", and `canWrite` starts false and is set in an effect,
 * so that wait was an accidental hydration barrier.)
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

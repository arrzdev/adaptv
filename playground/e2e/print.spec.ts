import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Print — one call, `window.print()`, and an outcome that says what the engine did
 * with it. The two headless engines answer it differently, and both answers are
 * real behaviour rather than harness noise:
 *
 *   chromium: headless Chromium runs the print pipeline with no dialog, and fires
 *   `beforeprint` and `afterprint` synchronously inside the call — about 2 ms end
 *   to end. The accessor sees `afterprint` and resolves `opened`.
 *
 *   webkit: headless WebKit (the iPhone 13 descriptor) returns from the call at
 *   once and never fires either event. Nothing arrives within the 1.5 s wait, so
 *   the accessor resolves `silent` — the same answer a real WKWebView would give
 *   if it were not already refused up front as `unsupported`.
 *
 * Both are `available` (window.print exists, neither is a native WebView), which
 * is the point: availability says the call can be made, the outcome says what it
 * did.
 */

/** What each headless engine measurably does with `window.print()`. */
const MEASURED_OUTCOME: Record<"chromium" | "webkit", string> = {
  chromium: "opened",
  webkit: "silent",
}

function expectedOutcome(browserName: string): string {
  if (browserName in MEASURED_OUTCOME) {
    return MEASURED_OUTCOME[browserName as keyof typeof MEASURED_OUTCOME]
  }
  throw new Error(`no measured print outcome for engine "${browserName}"`)
}

test.describe("Print", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/print")
    await awaitClientHandover(page)
  })

  test("reads available with no outcome before the first call", async ({
    page,
  }) => {
    await expect(page.getByTestId("print-status")).toHaveText("available")
    await expect(page.getByTestId("print-last")).toHaveText("—")
    await expect(page.getByTestId("print-printing")).toHaveText("false")
  })

  test("resolves the outcome this engine was measured to give", async ({
    page,
    browserName,
  }) => {
    const outcome = expectedOutcome(browserName)

    await page.getByTestId("print-open").click()

    await expect(page.getByTestId("print-last")).toHaveText(outcome)
    await expect(page.locator("[data-lab-log] li")).toHaveText([
      new RegExp(`outcome → ${outcome}$`),
      /print\(\) called$/,
    ])
  })

  test("printing reads false once the outcome is in", async ({
    page,
    browserName,
  }) => {
    const outcome = expectedOutcome(browserName)

    await page.getByTestId("print-open").click()

    await expect(page.getByTestId("print-last")).toHaveText(outcome)
    await expect(page.getByTestId("print-printing")).toHaveText("false")
    await expect(page.getByTestId("print-open")).toBeEnabled()
  })

  test("a second press reaches the engine again", async ({
    page,
    browserName,
  }) => {
    const outcome = expectedOutcome(browserName)
    //Count the calls that reach the engine: the page logs every press whether
    //or not the accessor hands back an earlier outcome instead of calling.
    await page.evaluate(() => {
      const w = window as Window & { __printCalls?: number }
      const engine = window.print.bind(window)
      w.__printCalls = 0
      window.print = () => {
        w.__printCalls = (w.__printCalls ?? 0) + 1
        engine()
      }
    })

    await page.getByTestId("print-open").click()
    await expect(page.getByTestId("print-last")).toHaveText(outcome)
    await expect(page.getByTestId("print-open")).toBeEnabled()
    await page.getByTestId("print-open").click()
    await expect(page.locator("[data-lab-log] li")).toHaveCount(4)

    expect(
      await page.evaluate(
        () => (window as Window & { __printCalls?: number }).__printCalls,
      ),
    ).toBe(2)
  })
})

import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Safe area — one contract (four --adaptv-inset-* variables) and ~90 utilities
 * built on it. The page grades itself against the REAL device inset, so these
 * assertions hold on any target: with no notch every inset is 0 and `0 == 0` is a
 * real pass; the -safe-offset-N / -safe-or-N arithmetic still has to add its 16px
 * and hold its 32px floor.
 *
 * Two things are asserted: useInsets() agrees with the measured CSS on every side
 * (a mismatch means one of the two read paths is broken), and the utility families
 * compute the arithmetic they claim — proven by a lower bound that is true whatever
 * the inset is, so it never assumes a headless 0.
 */

/** Read a padding-probe row: its measured px and the px the page expected. */
async function probeRow(page: Page, label: string) {
  const row = page.getByText(label, { exact: true }).locator("..")
  await expect(row).toContainText("expected") // wait past "measuring…"
  const text = await row.innerText()
  const m = text.match(/([\d.]+)px · expected ([\d.]+)px/)
  if (!m) throw new Error(`no measurement for ${label}: ${text}`)
  return { measured: Number(m[1]), expected: Number(m[2]) }
}

test.describe("Safe area", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/safe-area")
    await awaitClientHandover(page)
  })

  test("useInsets agrees with the measured CSS on every side", async ({
    page,
  }) => {
    // all four sides resolve, and each grades itself `agrees`
    await expect(page.getByText(/· agrees/)).toHaveCount(4)
    await expect(page.getByText("DISAGREES")).toHaveCount(0)
  })

  test("the -safe-offset and -safe-or families compute their arithmetic", async ({
    page,
  }) => {
    // pt-safe is the raw inset (0 on a device with no notch)
    const base = await probeRow(page, "pt-safe")
    expect(base.measured).toBeCloseTo(base.expected, 0)

    // pt-safe-offset-4 = inset + 16px, so it is always at least 16
    const offset = await probeRow(page, "pt-safe-offset-4")
    expect(offset.measured).toBeCloseTo(offset.expected, 0)
    expect(offset.measured).toBeGreaterThanOrEqual(15.5)

    // pt-safe-or-8 = max(inset, 32px), so it never drops below its 32px floor
    const or = await probeRow(page, "pt-safe-or-8")
    expect(or.measured).toBeCloseTo(or.expected, 0)
    expect(or.measured).toBeGreaterThanOrEqual(31.5)
  })
})

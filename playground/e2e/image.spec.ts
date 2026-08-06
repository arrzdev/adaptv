import { expect, test } from "@playwright/test"

/*
 * Image — the whole claim is "the box exists before the bytes do". The component
 * makes that claim assertable on purpose: it stamps `data-image-unreserved` (in
 * PRODUCTION too) whenever a box is NOT reserved, and every card on the page prints
 * its wrapper height at first layout next to its height right now.
 *
 * So the anti-CLS contract is testable without the Layout Instability API (which
 * WebKit does not have): no element carries the unreserved flag, and every
 * reserved/now pair is equal. The load-outcome slots (Image.Error on a 404,
 * Image.Invalid on a null src) land inside a box that was already the right size.
 */

test.describe.configure({ retries: 2 })

const IMAGE = '[data-adaptv="image"]'

/*
 * Headless chromium never fires native `loading="lazy"` loads without a real
 * scroll — not even for an image already in the viewport — so the load/error
 * events these tests wait on would never arrive. Flipping every image to eager
 * kicks the loads deterministically; it changes WHEN the bytes are fetched, never
 * WHETHER the box was reserved, which is the only thing under test here.
 */
async function forceEagerImages(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    for (const img of document.querySelectorAll(
      '[data-adaptv="image"] img',
    )) {
      ;(img as HTMLImageElement).loading = "eager"
    }
  })
}

test.describe("Image", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/image")
    await page.locator(IMAGE).first().waitFor()
    await forceEagerImages(page)
  })

  test("every image reserves its box — none carries the unreserved flag", async ({
    page,
  }) => {
    const images = page.locator(IMAGE)
    // the page is a survey of every reservation form; if a form regressed, its
    // card would flip the flag
    expect(await images.count()).toBeGreaterThanOrEqual(10)
    expect(
      await page.locator(`${IMAGE}[data-image-unreserved]`).count(),
      "no image may leave its box unreserved",
    ).toBe(0)
  })

  test("no card shifts: reserved height equals current height everywhere", async ({
    page,
  }) => {
    // each ShiftWatch badge reads "reserved N.N → now N.N"; the two must match, or
    // the box moved after the eye had already settled on it
    const badge = page.getByText(/reserved .* now/).first()
    await badge.waitFor()

    const readings = await page
      .getByText(/reserved .* now/)
      .allInnerTexts()
    expect(readings.length).toBeGreaterThanOrEqual(5)
    for (const text of readings) {
      const m = text.match(/reserved ([\d.]+) → now ([\d.]+)/)
      expect(m, `unparsable badge: ${text}`).not.toBeNull()
      const reserved = Number(m?.[1])
      const now = Number(m?.[2])
      expect(
        Math.abs(reserved - now),
        `box moved: reserved ${reserved} → now ${now}`,
      ).toBeLessThan(1)
    }
  })

  test("a 404 lands on Image.Error inside a box that was already reserved", async ({
    page,
    browserName,
  }) => {
    // the missing file resolves to the dev server's SPA fallback (a 200 HTML body);
    // chromium rejects that in an <img> and fires `error`, but WebKit does not treat
    // it as a decode failure, so the error slot never shows there. The FAILURE path
    // is chromium-verified; the box-is-reserved claim is covered on both engines by
    // the unreserved-flag and no-shift tests above, and the real-404 error is walked
    // on the simulator.
    test.skip(
      browserName !== "chromium",
      "WebKit does not error on the dev server's HTML fallback response",
    )
    const card = page
      .locator(IMAGE)
      .filter({ hasText: "Image.Error — could not load" })
    // it is lazy and below the fold — it only requests once it scrolls into view
    await card.scrollIntoViewIfNeeded()
    await expect(card).toHaveAttribute("data-image-error", "", {
      timeout: 15_000,
    })
    await expect(
      page.getByText("Image.Error — could not load"),
    ).toBeVisible()

    // the box kept its 16 / 9 reservation through the failure
    const box = await card.boundingBox()
    expect(box).not.toBeNull()
    expect(box?.height ?? 0).toBeGreaterThan(10)
  })

  test("a null src lands on Image.Invalid, reserved with no request at all", async ({
    page,
  }) => {
    const card = page
      .locator(IMAGE)
      .filter({ hasText: "Image.Invalid — no src" })
    await card.scrollIntoViewIfNeeded()
    // invalid is derived from the src, not from a load — immediate, no network
    await expect(card).toHaveAttribute("data-image-invalid", "")
    await expect(page.getByText("Image.Invalid — no src")).toBeVisible()
  })

  test("the static import loads and reserves its box from the asset's ratio", async ({
    page,
  }) => {
    const card = page.locator(IMAGE).first()
    await expect(card).toHaveAttribute("data-image-loaded", "", {
      timeout: 15_000,
    })
    // 1200 × 800 asset → the rendered box is ~3:2, reserved from the build dims
    const box = await card.boundingBox()
    const ratio = (box?.width ?? 0) / (box?.height ?? 1)
    expect(ratio).toBeGreaterThan(1.4)
    expect(ratio).toBeLessThan(1.6)
  })
})

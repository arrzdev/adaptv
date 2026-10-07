import type { Locator, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Dropdown — the whole component is "land in the right place". So every test opens
 * a menu in a hostile position and asserts the RESOLVED box stays inside the
 * viewport: flips above when there's no room below, shifts in from an edge, escapes
 * an overflow-clipped carousel, and caps + scrolls when it's too tall.
 *
 * This is the payoff of the pure engine (dropdown-position.ts, unit-tested): here
 * we prove it wired to real layout, in a real browser. The trigger is a plain
 * button, so a click opens it — no gesture engine, deterministic. chromium is
 * enough; positioning is geometry, not an engine-specific behaviour.
 */

test.use({ viewport: { width: 390, height: 844 } })
// this page mounts several menus; six of these hammering one dev server in parallel
// starves it and the menu never paints in time. Serial (one worker) is instant and
// deterministic.
//
// This used to carry `retries: 2` as well, "to absorb load from other spec files".
// It was not absorbing load — it was hiding the hydration race `awaitClientHandover`
// now closes, and it hid it well enough that the failure survived as folklore. No
// retries here on purpose: if this describe goes red, something is genuinely wrong
// and the run should say so the first time.
test.describe.configure({ mode: "serial" })

const VW = 390
const VH = 844
const PAD = 8 // DROPDOWN_VIEWPORT_PADDING
const CONTENT = '[data-adaptv="dropdown"]'

const triggerFor = (page: Page, label: string) =>
  page.getByRole("button", { name: label, exact: true })
const content = (page: Page): Locator => page.locator(CONTENT)

/*
 * Without the hydration gate (`awaitClientHandover`, e2e/support/hydrated.ts) the
 * click lands on a trigger whose handler is not attached yet, `open` never flips, and
 * the menu this spec is entirely about never mounts — the failure is `waitFor()` on
 * the content timing out, which reads as "the dropdown is broken". That is also why
 * the serial describe only ever lost its first test.
 */

async function openMenu(page: Page, label: string) {
  const t = triggerFor(page, label)
  await t.scrollIntoViewIfNeeded()
  await t.click()
  await content(page).waitFor()
}

/** Assert a box sits fully inside the safe viewport (1px slack for rounding). */
function expectInsideViewport(
  box: { x: number; y: number; width: number; height: number } | null,
  msg: string,
) {
  if (!box) throw new Error(`${msg}: no box`)
  expect(box.x, `${msg}: left edge`).toBeGreaterThanOrEqual(PAD - 1)
  expect(box.x + box.width, `${msg}: right edge`).toBeLessThanOrEqual(
    VW - PAD + 1,
  )
  expect(box.y, `${msg}: top edge`).toBeGreaterThanOrEqual(PAD - 1)
  expect(box.y + box.height, `${msg}: bottom edge`).toBeLessThanOrEqual(
    VH - PAD + 1,
  )
}

test.describe("Dropdown positioning", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/dropdown")
    await awaitClientHandover(page)
    await triggerFor(page, "Actions").waitFor()
  })

  test("opens below and start-aligned when there is room @tailwind", async ({
    page,
  }) => {
    await openMenu(page, "Actions")
    await expect(content(page)).toHaveAttribute("data-side", "bottom")

    // measure the trigger AFTER opening — openMenu scrolls it into view, so its
    // pre-scroll rect is meaningless against the (scrolled) menu position
    const t = await triggerFor(page, "Actions").boundingBox()
    const box = await content(page).boundingBox()
    expectInsideViewport(box, "default menu")
    expect(box?.x, "left edge aligned to the trigger").toBeCloseTo(
      t?.x ?? 0,
      0,
    )
    expect(box?.y, "sits below the trigger").toBeGreaterThan(
      (t?.y ?? 0) + (t?.height ?? 0),
    )
  })

  test("flips ABOVE when the trigger has no room below", async ({
    page,
  }) => {
    const t = triggerFor(page, "Near the bottom")
    // pin the trigger to the very bottom of the viewport — no room beneath it
    await t.evaluate((el) => el.scrollIntoView({ block: "end" }))
    await page.waitForTimeout(150)
    const tb = await t.boundingBox()
    await t.click()
    await content(page).waitFor()

    await expect(content(page)).toHaveAttribute("data-side", "top")
    const box = await content(page).boundingBox()
    expectInsideViewport(box, "flipped menu")
    expect(
      (box?.y ?? 0) + (box?.height ?? 0),
      "opens above the trigger",
    ).toBeLessThanOrEqual((tb?.y ?? 0) + 1)
  })

  test("shifts IN so a right-edge menu never spills off screen @tailwind", async ({
    page,
  }) => {
    await openMenu(page, "Right-edge menu")
    const box = await content(page).boundingBox()
    expectInsideViewport(box, "right-edge menu")
    // it genuinely reached the right side (shifted, not just narrow in the middle)
    expect(
      (box?.x ?? 0) + (box?.width ?? 0),
      "hugs the right edge without crossing it",
    ).toBeGreaterThan(VW / 2)
  })

  test("escapes an overflow-clipped carousel and stays in the viewport", async ({
    page,
  }) => {
    // scroll the strip so its last card sits at the clipped right edge
    await page
      .locator(".overflow-x-auto")
      .first()
      .evaluate((el) => {
        el.scrollLeft = el.scrollWidth
      })
    await page.waitForTimeout(120)
    await openMenu(page, "Card five")

    const box = await content(page).boundingBox()
    // the menu is fixed-positioned: it floats over the page, fully in the viewport,
    // rather than being sliced by the strip's overflow
    expectInsideViewport(box, "carousel menu")
    expect(
      box?.width,
      "not clipped to a sliver by the strip",
    ).toBeGreaterThan(100)
  })

  test("a too-tall menu caps its height and scrolls inside", async ({
    page,
  }) => {
    await openMenu(page, "Long menu")
    const box = await content(page).boundingBox()
    expectInsideViewport(box, "long menu")
    const scrolls = await content(page).evaluate(
      (el) =>
        (el as HTMLElement).scrollHeight >
        (el as HTMLElement).clientHeight + 2,
    )
    expect(scrolls, "content past the cap scrolls, not overflows").toBe(
      true,
    )
  })

  test("dismisses on outside press, on Escape, and selecting an item", async ({
    page,
  }) => {
    // outside press
    await openMenu(page, "Actions")
    await page.getByRole("heading", { name: "Dropdown" }).click()
    await expect(content(page)).toBeHidden()

    // Escape
    await openMenu(page, "Actions")
    await page.keyboard.press("Escape")
    await expect(content(page)).toBeHidden()

    // selecting an item fires + closes
    await openMenu(page, "Actions")
    await page.getByRole("menuitem", { name: "Archive" }).click()
    await expect(content(page)).toBeHidden()
    expect(
      (await page.locator("[data-lab-log] li").allInnerTexts()).join("\n"),
    ).toMatch(/Actions → Archive/)
  })
})

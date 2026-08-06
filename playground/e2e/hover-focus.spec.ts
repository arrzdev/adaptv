import { expect, test } from "@playwright/test"

/*
 * hover: and focus — two corrections that only show when they are missing. The
 * headline is WCAG 2.4.7: a KEYBOARD focus must draw a ring, a mouse click must not,
 * and that regressed here once already. Plus adaptv's own half — a hover tint must
 * not out-rank a focus ring (`&:hover:not(:is(:focus, :focus-within))`).
 *
 * These ride the UA's :focus-visible and (hover: hover) heuristics, which are
 * reliable on a desktop mouse engine and deliberately different on touch (no hover
 * at all; a tap focuses without a ring). So this runs on chromium with a desktop,
 * hover-capable viewport; the touch side (no sticky hover after a tap) is a sim walk.
 */

test.use({ viewport: { width: 1280, height: 800 } })
test.describe.configure({ retries: 2 })

test.describe("hover: and focus", () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium",
      "desktop :focus-visible / (hover: hover) heuristics — touch is a sim walk",
    )
    await page.goto("/lab/hover-focus")
  })

  test("a keyboard focus draws the WCAG ring", async ({ page }) => {
    // the documented regression was "no outline at all when you Tab" — assert the
    // positive: a KEYBOARD focus draws the ring. (The other half — a mouse CLICK
    // drawing none — hangs on the UA's pointer-vs-keyboard :focus-visible heuristic,
    // which Playwright's synthetic click does not reproduce, so it stays a sim walk.)
    const button = page.getByRole("button", {
      name: "button",
      exact: true,
    })
    // land on the control just before it, then Tab so the button gets keyboard focus
    await page.locator("select").focus()
    await page.keyboard.press("Tab")
    await expect(button).toBeFocused()
    // :where(:focus-visible) { outline: 2px solid var(--adaptv-ring) }
    expect(
      Number.parseFloat(
        await button.evaluate((el) => getComputedStyle(el).outlineWidth),
      ),
    ).toBeGreaterThanOrEqual(2)
  })

  test("a hover tint never out-ranks a focus ring", async ({ page }) => {
    const input = page.getByPlaceholder(
      "Tab to me, then hover me with the mouse",
    )
    const bg = () =>
      input.evaluate((el) => getComputedStyle(el).backgroundColor)

    const resting = await bg()
    await input.focus() // ring up
    await input.hover() // mouse over the focused control
    // the deliberately-loud red hover tint must NOT appear while focused
    expect(await bg()).toBe(resting)
  })
})

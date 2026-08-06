import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * Checkbox & Switch — a hidden native input for semantics under a painted box,
 * toggled by a pointer gesture engine (the same one swipeable uses).
 *
 * This file pins the parts that are DETERMINISTIC headless: indeterminate
 * resolving to checked, the uncontrolled default, disabled inertness, and Space
 * toggling exactly once. The onCheckedChange CONTRACT under a controlled/frozen
 * owner, the pointer tap, and the Switch DRAG are left to a real-finger sim walk —
 * the gesture engine does not respond to synthetic pointer / mouse / CDP-touch
 * events reliably in headless Playwright (they perform only the native DOM toggle),
 * so a "controlled tap" test here would be pinning an artefact, not the contract.
 *
 * chromium is enough — semantics, not engine-specific rendering.
 */

const LOG = "[data-lab-log] li"
const logJoin = (page: Page) =>
  page
    .locator(LOG)
    .allInnerTexts()
    .then((t) => t.join("\n"))

const input = (page: Page, role: "checkbox" | "switch", name: string) =>
  page.getByRole(role, { name, exact: true })

test.describe("Checkbox & Switch semantics", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/toggles")
    await input(page, "checkbox", "Controlled checkbox").waitFor()
  })

  test("the indeterminate checkbox starts mixed and resolves its first toggle to CHECKED", async ({
    page,
  }) => {
    const ind = input(page, "checkbox", "Indeterminate checkbox")
    await expect(ind, "starts mixed").toBeChecked({ indeterminate: true })
    await ind.focus()
    await page.keyboard.press("Space")
    // the ASK is the point: the first activation must resolve to TRUE. (The visual
    // stays off — this lab holds checked={false} and only clears indeterminate — so
    // the value reported is what matters, not the owner's kept state.)
    await expect
      .poll(() => logJoin(page), {
        message:
          "resolving to unchecked would silently lose the user's intent",
      })
      .toMatch(/resolved to true/)
    expect(await logJoin(page), "must not resolve to false").not.toMatch(
      /resolved to false/,
    )
  })

  test("Space toggles a focused control exactly once per press", async ({
    page,
  }) => {
    const sw = input(page, "switch", "Lab switch")
    await expect(sw).not.toBeChecked()
    await sw.focus()
    await page.keyboard.press("Space")
    await expect(sw, "one Space press toggles once").toBeChecked()
    await page.keyboard.press("Space")
    await expect(sw, "…and again, exactly once").not.toBeChecked()
  })

  test("an uncontrolled checkbox owns its own state", async ({ page }) => {
    const un = input(page, "checkbox", "Uncontrolled checkbox")
    await expect(un, "defaultChecked").toBeChecked()
    await un.focus()
    await page.keyboard.press("Space")
    await expect(un, "it flips itself with no owner").not.toBeChecked()
  })

  test("a checkbox exposes a proper accessible role and name", async ({
    page,
  }) => {
    // the whole point of the hidden native input: real semantics for AT + tests
    await expect(
      input(page, "checkbox", "Controlled checkbox"),
    ).toHaveAttribute("type", "checkbox")
    await expect(input(page, "switch", "Lab switch")).toHaveAttribute(
      "role",
      "switch",
    )
  })

  test("disabled controls are inert — cannot be activated, and never fire", async ({
    page,
  }) => {
    const cb = input(page, "checkbox", "Disabled checkbox")
    const sw = input(page, "switch", "Disabled switch")
    await expect(cb).toBeDisabled()
    await expect(sw).toBeDisabled()
    // force a click past actionability; a disabled control must swallow it
    await cb.click({ force: true })
    await sw.click({ force: true })
    await page.waitForTimeout(150)
    expect(
      await logJoin(page),
      "a disabled control must never fire onCheckedChange",
    ).not.toMatch(/THIS MUST NEVER APPEAR/)
  })
})

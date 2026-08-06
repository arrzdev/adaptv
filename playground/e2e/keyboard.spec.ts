import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * Keyboard — the primary keyboard-contract page. A headless browser has no on-screen
 * keyboard, so it is driven through adaptv's keyboard test seam
 * (window.__adaptvKeyboardMock + adaptv:keyboard-mock, installed pre-mount), the same
 * seam AvoidKeyboard uses. Asserts the two CSS contracts the page publishes —
 * --adaptv-keyboard-height and the data-keyboard-open flag — track the mock and AGREE
 * with the hook (the page grades that itself), and that a box keyed purely on the
 * <html> flag reacts with no JS on the element at all.
 */

test.describe.configure({ retries: 2 })

const KEYBOARD_EVENT = "adaptv:keyboard-mock"

async function setKeyboard(page: Page, isOpen: boolean, height: number) {
  await page.evaluate(
    ({ o, h, evt }) => {
      ;(
        window as unknown as { __adaptvKeyboardMock?: unknown }
      ).__adaptvKeyboardMock = { isOpen: o, height: h }
      window.dispatchEvent(new Event(evt))
    },
    { o: isOpen, h: height, evt: KEYBOARD_EVENT },
  )
}

test.describe("Keyboard contract", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      ;(
        window as unknown as { __adaptvKeyboardMock?: unknown }
      ).__adaptvKeyboardMock = { isOpen: false, height: 0 }
    })
    await page.goto("/lab/keyboard")
    await page.getByLabel("Keyboard test field").waitFor()
  })

  test("the height variable and the flag track the keyboard and agree with the hook", async ({
    page,
  }) => {
    const heightVar = page
      .getByText("--adaptv-keyboard-height", { exact: true })
      .locator("..")
    const agrees = page.getByText("agrees with the hook").locator("..")
    const flag = page
      .getByText("html[data-keyboard-open]", { exact: true })
      .locator("..")
    const tint = page.getByText(/This box carries/).locator("..")

    // at rest
    await expect(heightVar).toContainText("0px")
    await expect(agrees).toContainText("yes")
    const restBg = await tint.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    )

    // raise the mock keyboard
    await setKeyboard(page, true, 300)
    await expect(heightVar).toContainText("300px")
    await expect(flag).toContainText("present")
    await expect(agrees).toContainText("yes")
    // the pure-CSS box keyed on <html>[data-keyboard-open] reacts on its own
    await expect
      .poll(() =>
        tint.evaluate((el) => getComputedStyle(el).backgroundColor),
      )
      .not.toBe(restBg)

    // dismiss
    await setKeyboard(page, false, 0)
    await expect(heightVar).toContainText("0px")
    await expect(flag).toContainText("absent")
    await expect(agrees).toContainText("yes")
  })
})

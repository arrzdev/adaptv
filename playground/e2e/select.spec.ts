import type { Locator, Page } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import { expect, test } from "./support/reload-guard"

/*
 * Select — a listbox on a combobox trigger, with a hidden native <select> for
 * forms. This file pins the CONTRACT the lab page renders: the roles and the
 * data-* stamps, the keyboard walk (arrows skip a disabled option, Enter picks,
 * Escape abandons, focus comes home to the trigger), typeahead, outside-press
 * dismissal, the form path through the native element, a clipped trigger whose
 * list still lands inside the viewport, and a disabled root that will not open.
 *
 * Values are read back through `[data-lab-readout]` spans only. The page owns
 * the wiring (onValueChange counts, FormData, the native element's .value) and
 * reports it as text; the suite never reaches into the component's DOM for a
 * value it can ask the page for.
 *
 * Both projects: the trigger is a plain button and the list is keyboard- and
 * click-driven, so nothing here depends on the gesture engine. The webkit
 * project is the phone-sized one, which is where the height cap and the clipped
 * case actually bite.
 */

const readout = (page: Page, name: string): Locator =>
  page.locator(`[data-lab-readout='${name}']`)

const trigger = (page: Page, name: string): Locator =>
  page.getByRole("combobox", { name, exact: true })
const listbox = (page: Page): Locator => page.getByRole("listbox")
const option = (page: Page, label: string): Locator =>
  page.getByRole("option", { name: label, exact: true })

const root = (page: Page, name: string): Locator =>
  page
    .locator('[data-adaptv="select"]')
    .filter({ has: trigger(page, name) })

async function open(page: Page, name: string) {
  const t = trigger(page, name)
  await t.scrollIntoViewIfNeeded()
  await t.click()
  await listbox(page).waitFor()
}

test.describe("Select", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/select")
    await awaitClientHandover(page)
    await trigger(page, "Fruit").waitFor()
  })

  test("opens on click and stamps every part", async ({ page }) => {
    const t = trigger(page, "Fruit")
    await expect(t).toHaveAttribute("aria-haspopup", "listbox")
    await expect(t).toHaveAttribute("aria-expanded", "false")
    await expect(t, "no value yet").toHaveAttribute("data-placeholder", "")
    await expect(readout(page, "fruit-open")).toHaveText("closed")

    await open(page, "Fruit")

    await expect(t).toHaveAttribute("aria-expanded", "true")
    await expect(listbox(page)).toBeVisible()
    await expect(listbox(page)).toHaveAttribute(
      "data-adaptv",
      "select-content",
    )
    await expect(listbox(page), "placed").toHaveAttribute(
      "data-side",
      /^(top|bottom)$/,
    )
    await expect(root(page, "Fruit")).toHaveAttribute(
      "data-select-open",
      "",
    )
    await expect(readout(page, "fruit-open")).toHaveText("open")
    await expect(listbox(page).getByRole("option")).toHaveCount(12)
    await expect(option(page, "Banana")).toHaveAttribute(
      "data-disabled",
      "",
    )
  })

  test("a click on an option picks it, closes the list, and reports once", async ({
    page,
  }) => {
    await open(page, "Fruit")
    await option(page, "Blueberry").click()

    await expect(readout(page, "fruit")).toHaveText("blueberry")
    await expect(readout(page, "fruit-changes")).toHaveText("1")
    await expect(listbox(page)).toHaveCount(0)
    await expect(readout(page, "fruit-open")).toHaveText("closed")
    const t = trigger(page, "Fruit")
    await expect(t).toHaveAttribute("aria-expanded", "false")
    await expect(t, "the trigger shows the option's label").toHaveText(
      "Blueberry",
    )
    await expect(t, "no longer a placeholder").not.toHaveAttribute(
      "data-placeholder",
      "",
    )
  })

  test("the keyboard opens, walks past a disabled option, picks, and comes home", async ({
    page,
  }) => {
    const t = trigger(page, "Fruit")
    await t.focus()
    await page.keyboard.press("ArrowDown")
    await listbox(page).waitFor()
    await expect(
      option(page, "Apple"),
      "opens on the first option",
    ).toHaveAttribute("data-highlighted", "")

    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("ArrowDown")
    await expect(
      option(page, "Blueberry"),
      "two steps from Apple: Avocado, then over Banana",
    ).toHaveAttribute("data-highlighted", "")
    await expect(
      option(page, "Banana"),
      "a disabled option is never highlighted",
    ).not.toHaveAttribute("data-highlighted", "")

    await page.keyboard.press("Enter")
    await expect(readout(page, "fruit")).toHaveText("blueberry")
    await expect(listbox(page)).toHaveCount(0)
    await expect(t, "focus returns to the trigger").toBeFocused()
    await expect(t).toHaveText("Blueberry")
  })

  test("typing a label prefix highlights it, and Enter picks it", async ({
    page,
  }) => {
    await open(page, "Fruit")
    await page.keyboard.type("ch")
    await expect(option(page, "Cherry")).toHaveAttribute(
      "data-highlighted",
      "",
    )
    await page.keyboard.press("Enter")
    await expect(readout(page, "fruit")).toHaveText("cherry")
    await expect(listbox(page)).toHaveCount(0)
  })

  test("Escape closes without changing the value and refocuses the trigger", async ({
    page,
  }) => {
    await open(page, "Fruit")
    await page.keyboard.press("ArrowDown")
    await page.keyboard.press("Escape")

    await expect(listbox(page)).toHaveCount(0)
    await expect(readout(page, "fruit")).toHaveText("none")
    await expect(readout(page, "fruit-changes")).toHaveText("0")
    await expect(trigger(page, "Fruit")).toBeFocused()
    await expect(trigger(page, "Fruit")).toHaveAttribute(
      "aria-expanded",
      "false",
    )
  })

  test("a press outside closes the list", async ({ page }) => {
    await open(page, "Fruit")
    await page
      .getByRole("heading", { name: "Select", exact: true })
      .click()
    await expect(listbox(page)).toHaveCount(0)
    await expect(readout(page, "fruit-open")).toHaveText("closed")
    await expect(readout(page, "fruit")).toHaveText("none")
  })

  test("the controlled one follows its owner", async ({ page }) => {
    await expect(readout(page, "controlled")).toHaveText("none")
    await page
      .getByRole("button", { name: "set cherry", exact: true })
      .click()
    await expect(readout(page, "controlled")).toHaveText("cherry")
    await expect(trigger(page, "Controlled")).toHaveText("Cherry")
    await expect(
      readout(page, "controlled-changes"),
      "an owner's set is not a user change",
    ).toHaveText("0")

    await open(page, "Controlled")
    await option(page, "Mango").click()
    await expect(readout(page, "controlled")).toHaveText("mango")
    await expect(readout(page, "controlled-changes")).toHaveText("1")

    await page.getByRole("button", { name: "clear", exact: true }).click()
    await expect(readout(page, "controlled")).toHaveText("none")
    await expect(trigger(page, "Controlled")).toHaveAttribute(
      "data-placeholder",
      "",
    )
  })

  test("a form gets the value through the hidden native select", async ({
    page,
  }) => {
    const native = page.locator('select[name="size"]')
    await expect(native).toHaveCount(1)
    await expect(native).toHaveAttribute("aria-hidden", "true")
    await expect(native).toHaveAttribute("tabindex", "-1")

    await open(page, "Size")
    await option(page, "M").click()
    await page.getByRole("button", { name: "submit", exact: true }).click()

    await expect(readout(page, "form-size")).toHaveText("m")
    await expect(readout(page, "native-size")).toHaveText("m")
  })

  test("a clipped trigger still opens its list inside the viewport", async ({
    page,
  }) => {
    await open(page, "Clipped")
    await expect(readout(page, "clipped-side")).toHaveText(
      /^(top|bottom)$/,
    )

    const viewport = page.viewportSize()
    if (!viewport) throw new Error("no viewport")
    const box = await listbox(page).boundingBox()
    if (!box) throw new Error("clipped list: no box")
    expect(box.y, "top edge").toBeGreaterThanOrEqual(0)
    expect(box.y + box.height, "bottom edge").toBeLessThanOrEqual(
      viewport.height,
    )
    expect(box.x, "left edge").toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, "right edge").toBeLessThanOrEqual(
      viewport.width,
    )
    expect(
      box.height,
      "not sliced to a sliver by the clipping box",
    ).toBeGreaterThan(60)
  })

  test("a disabled one will not open", async ({ page }) => {
    const t = trigger(page, "Disabled")
    await expect(t).toBeDisabled()
    await expect(t).toHaveText("Mango")
    await expect(root(page, "Disabled")).toHaveAttribute(
      "data-disabled",
      "",
    )

    await t.click({ force: true })
    await page.waitForTimeout(150)
    await expect(t).toHaveAttribute("aria-expanded", "false")
    await expect(listbox(page)).toHaveCount(0)
    await expect(readout(page, "disabled-value")).toHaveText("mango")
  })
})

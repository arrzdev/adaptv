import type { Locator, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * RadioGroup — native radios laid over their items, measured in the two engines
 * adaptv ships on (chromium = Android WebView, webkit = iOS). The unit suite pins
 * the class contract and the selection rules; this spec asks the ENGINE:
 *
 *   - the radio's box IS its item: at least as large, at the same origin, and the
 *     element under the item's centre is the radio (the sr-only speck PR #132
 *     measured on Switch and Checkbox is what this refuses);
 *   - a click at each item's centre selects it, is not intercepted, and reports
 *     exactly one change — the gesture engine on the item never swallows it;
 *   - two instances mounted with no name are two browser radio groups;
 *   - the arrow keys move the selection, skip a disabled option, and Tab leaves
 *     the group in one press — the browser's own radio behaviour, which the item's
 *     press handling must not break;
 *   - a required group blocks submission, a chosen value submits under its name,
 *     and a form reset moves the painted state with the radios;
 *   - under dir=rtl the box sits at the inline start.
 *
 * Two engine differences were measured here and are pinned per engine rather than
 * papered over, because the group adds no key handling of its own: past the last
 * radio Chromium wraps and WebKit stops, and under rtl Chromium flips
 * ArrowLeft/ArrowRight while WebKit does not. And WebKit's default Tab order has
 * no radios in it at all (Safari's "Press Tab to highlight each item" is off).
 *
 * Layout and keyboard are real only in a browser, so every test runs on both
 * projects. The webkit project is the iPhone 13 descriptor (portrait, touch), so
 * the rotate guard never covers the page. No retries, no warm-ups, no async
 * waitForFunction predicates (playground-touch-e2e-patterns,
 * playwright-waitforfunction-not-awaited).
 */

function group(page: Page, name: string): Locator {
  return page.getByRole("radiogroup", { name, exact: true })
}

function radio(page: Page, groupName: string, name: string): Locator {
  return group(page, groupName).getByRole("radio", { name, exact: true })
}

async function changes(page: Page): Promise<number> {
  return Number(await page.getByTestId("controlled-changes").innerText())
}

/** The focused element's group label and radio value, or its tag. */
function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement
    if (!(el instanceof HTMLInputElement) || el.type !== "radio")
      return el?.tagName ?? "none"
    const owner = el.closest("[role='radiogroup']")
    return `${owner?.getAttribute("aria-label")}:${el.value}`
  })
}

test.describe("RadioGroup", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/radio-group")
    await awaitClientHandover(page)
    await group(page, "Billing").waitFor()
  })

  test("each radio's accessible box is its whole item, and the radio is what its centre hits", async ({
    page,
  }) => {
    const items = group(page, "Billing").locator("[data-part='item']")
    await expect(items).toHaveCount(3)
    for (let i = 0; i < 3; i++) {
      const item = items.nth(i)
      const input = item.locator("input[type='radio']")
      await item.scrollIntoViewIfNeeded()
      const itemBox = await item.boundingBox()
      const box = await input.boundingBox()
      if (!itemBox || !box) throw new Error(`item ${i} has no box`)
      //the painted item is a real row, not a zero box that makes this vacuous
      expect(itemBox.width, "the item has width").toBeGreaterThan(40)
      expect(itemBox.height, "the item has height").toBeGreaterThan(16)
      //what VoiceOver, TalkBack and automation read as the radio's frame
      expect(box.width, "as wide as the item").toBeGreaterThanOrEqual(
        itemBox.width - 0.5,
      )
      expect(box.height, "as tall as the item").toBeGreaterThanOrEqual(
        itemBox.height - 0.5,
      )
      expect(Math.abs(box.x - itemBox.x)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(box.y - itemBox.y)).toBeLessThanOrEqual(0.5)
      //covering it must not paint a native radio over the painted one
      await expect(input).toHaveCSS("opacity", "0")
      const hit = await page.evaluate(
        ({ x, y }) => {
          const target = document.elementFromPoint(x, y)
          return target instanceof HTMLInputElement
            ? `${target.type}:${target.value}`
            : (target?.tagName ?? null)
        },
        {
          x: itemBox.x + itemBox.width / 2,
          y: itemBox.y + itemBox.height / 2,
        },
      )
      expect(hit).toBe(`radio:${await input.getAttribute("value")}`)
    }
  })

  test("a click at the centre of each item selects it, once per click", async ({
    page,
  }) => {
    const order = ["Yearly", "Lifetime", "Monthly"] as const
    await expect(radio(page, "Billing", "Monthly")).toBeChecked()
    expect(await changes(page)).toBe(0)
    for (const [i, name] of order.entries()) {
      //Playwright aims at the centre of the radio and refuses if anything else
      //would take the click there
      await radio(page, "Billing", name).click({ timeout: 5_000 })
      await expect(radio(page, "Billing", name)).toBeChecked()
      await expect(page.getByTestId("controlled-value")).toHaveText(
        name.toLowerCase(),
      )
      await expect(page.getByTestId("controlled-changes")).toHaveText(
        String(i + 1),
      )
    }
    //a trailing duplicate of any click above would land before the next report:
    //one more click must take the count from 3 to exactly 4
    await radio(page, "Billing", "Yearly").click({ timeout: 5_000 })
    await expect(radio(page, "Billing", "Yearly")).toBeChecked()
    await expect(page.getByTestId("controlled-changes")).toHaveText("4")
    expect(await changes(page), "exactly one change per click").toBe(4)
  })

  test("a click on the selected item reports nothing", async ({
    page,
  }) => {
    await radio(page, "Billing", "Monthly").click({ timeout: 5_000 })
    //no fixed wait for "nothing": a click that does report must count exactly one,
    //which it cannot if the first click had reported too
    await radio(page, "Billing", "Yearly").click({ timeout: 5_000 })
    await expect(radio(page, "Billing", "Yearly")).toBeChecked()
    await expect(page.getByTestId("controlled-changes")).toHaveText("1")
    expect(await changes(page)).toBe(1)
  })

  test("a refused selection stays unchecked, and is still reported once", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: "freeze the controlled group" })
      .click()
    await radio(page, "Billing", "Yearly").click({ timeout: 5_000 })
    await expect(page.getByTestId("controlled-changes")).toHaveText("1")
    await expect(radio(page, "Billing", "Monthly")).toBeChecked()
    await expect(radio(page, "Billing", "Yearly")).not.toBeChecked()
  })

  test("two instances with no name are independent", async ({ page }) => {
    const left = radio(page, "Left size", "Large")
    const right = radio(page, "Right size", "Small")
    const leftName = await left.getAttribute("name")
    const rightName = await right.getAttribute("name")
    expect(leftName, "an id-derived name").toBeTruthy()
    expect(leftName).not.toBe(rightName)

    await left.click({ timeout: 5_000 })
    await expect(page.getByTestId("instance-left-value")).toHaveText(
      "large",
    )
    await right.click({ timeout: 5_000 })
    await expect(page.getByTestId("instance-right-value")).toHaveText(
      "small",
    )
    await expect(left, "the left group kept Large").toBeChecked()
    await expect(right).toBeChecked()
    await expect(
      page.getByTestId("instance-left-value"),
      "and never heard of the right group's choice",
    ).toHaveText("large")
  })

  test("the arrow keys move the selection with focus, and Space selects a focused radio", async ({
    page,
    browserName,
  }) => {
    await radio(page, "Billing", "Monthly").focus()
    await page.keyboard.press("ArrowDown")
    await expect(radio(page, "Billing", "Yearly")).toBeChecked()
    await expect(radio(page, "Billing", "Yearly")).toBeFocused()
    await expect(page.getByTestId("controlled-changes")).toHaveText("1")
    await page.keyboard.press("ArrowRight")
    await expect(radio(page, "Billing", "Lifetime")).toBeChecked()
    await expect(page.getByTestId("controlled-changes")).toHaveText("2")
    //past the last radio the engines differ, and the group keeps each one's own
    //behaviour: Chromium wraps to the first, WebKit stays on the last (measured,
    //both projects) and reports nothing, because nothing changed
    await page.keyboard.press("ArrowDown")
    if (browserName === "webkit") {
      await expect(radio(page, "Billing", "Lifetime")).toBeChecked()
      //the stop reported nothing: the next arrow that moves counts exactly one
      await page.keyboard.press("ArrowUp")
      await expect(radio(page, "Billing", "Yearly")).toBeChecked()
      await expect(page.getByTestId("controlled-changes")).toHaveText("3")
      await page.keyboard.press("ArrowDown")
    } else {
      await expect(radio(page, "Billing", "Monthly")).toBeChecked()
      await page.keyboard.press("ArrowUp")
    }
    await expect(radio(page, "Billing", "Lifetime")).toBeChecked()
    await expect(page.getByTestId("controlled-changes")).toHaveText("4")

    //focus without selection (programmatic), then Space selects it, once
    await radio(page, "Billing", "Yearly").focus()
    await expect(radio(page, "Billing", "Lifetime")).toBeChecked()
    await page.keyboard.press("Space")
    await expect(radio(page, "Billing", "Yearly")).toBeChecked()
    await expect(page.getByTestId("controlled-changes")).toHaveText("5")
    //a duplicate report of the Space would land before this arrow's
    await page.keyboard.press("ArrowUp")
    await expect(radio(page, "Billing", "Monthly")).toBeChecked()
    await expect(page.getByTestId("controlled-changes")).toHaveText("6")
    expect(await changes(page), "one change per key").toBe(6)
  })

  test("Tab enters a group at its selected radio and leaves it in one press", async ({
    page,
    browserName,
  }) => {
    //start on the right size group's selected radio, the control before Billing
    await radio(page, "Right size", "Medium").focus()
    await page.keyboard.press("Tab")
    if (browserName === "webkit") {
      //WebKit's default keyboard-focus model (Safari's, with "Press Tab to
      //highlight each item" off) keeps radios and buttons out of the Tab order
      //altogether: from a focused radio, Tab goes to the document. The group adds
      //nothing to the order and takes nothing out, so what is pinned here is that
      //it leaves the group; entering by Tab is a Safari setting, walked on the sim
      expect(await focused(page), "Tab left the group").toBe("BODY")
      return
    }
    expect(
      await focused(page),
      "Tab lands on Billing's selected radio",
    ).toBe("Billing:monthly")
    //the keyboard focus ring is drawn on the item, since the radio is invisible
    const item = group(page, "Billing")
      .locator("[data-part='item']")
      .first()
    await expect(item).toHaveCSS("outline-style", "solid")
    await expect(item).toHaveCSS("outline-width", "2px")

    await page.keyboard.press("Tab")
    const after = await focused(page)
    expect(
      after.startsWith("Billing:"),
      `focus left the group (${after})`,
    ).toBe(false)
    await expect(item).toHaveCSS("outline-style", "none")
    await page.keyboard.press("Shift+Tab")
    expect(
      await focused(page),
      "Shift+Tab comes back to the selection",
    ).toBe("Billing:monthly")
  })

  test("a disabled option is skipped by the arrow keys and inert to a click", async ({
    page,
  }) => {
    const beta = radio(page, "Letters", "Beta")
    await expect(beta).toBeDisabled()
    await radio(page, "Letters", "Alpha").focus()
    await page.keyboard.press("ArrowDown")
    await expect(radio(page, "Letters", "Gamma")).toBeChecked()
    await expect(radio(page, "Letters", "Gamma")).toBeFocused()
    await page.keyboard.press("ArrowUp")
    await expect(radio(page, "Letters", "Alpha")).toBeChecked()

    const log = page.locator("[data-lab-log] li")
    await expect(log).toHaveCount(2)
    await beta.click({ force: true })
    await expect(beta).not.toBeChecked()
    await expect(radio(page, "Letters", "Alpha")).toBeChecked()

    //a disabled group: every radio disabled, a forced click changes nothing
    const locked = group(page, "Locked")
    await expect(locked).toHaveAttribute("aria-disabled", "true")
    await radio(page, "Locked", "Off").click({ force: true })
    await expect(radio(page, "Locked", "On")).toBeChecked()

    //no fixed wait for "nothing": one click that does report must add exactly one
    //log line, which it cannot if either forced click above had logged too
    await radio(page, "Letters", "Gamma").click({ timeout: 5_000 })
    await expect(radio(page, "Letters", "Gamma")).toBeChecked()
    await expect(log.first()).toContainText("letters → gamma")
    await expect(log).toHaveCount(3)
    expect(await page.locator("[data-lab-log]").innerText()).not.toMatch(
      /THIS MUST NEVER APPEAR/,
    )
  })

  test("a required group blocks submission, and the chosen value submits under its name", async ({
    page,
  }) => {
    const output = page.getByTestId("form-output")
    const submit = page.getByRole("button", { name: "Submit" })
    const monthly = radio(page, "Plan", "Monthly")
    const yearly = radio(page, "Plan", "Yearly")
    //the output reads "not submitted" from the start, so it proves nothing on its
    //own: wait for the browser's refusal itself, the `invalid` event on the radio
    await monthly.evaluate((el) => {
      el.addEventListener("invalid", () => {
        el.setAttribute("data-e2e-invalid", "")
      })
    })
    await submit.click()
    await expect(monthly, "the browser refused the empty group").toHaveAttribute(
      "data-e2e-invalid",
      "",
    )
    await expect(output).toHaveText("not submitted")
    expect(
      await monthly.evaluate(
        (el) => (el as HTMLInputElement).validity.valueMissing,
      ),
    ).toBe(true)

    await yearly.click({ timeout: 5_000 })
    await submit.click()
    await expect(output).toHaveText("plan=yearly&source=lab")

    //a reset puts the radios back on their default (none here), and the item's
    //state follows: no stale data-checked, no dot, and FormData agrees
    const yearlyItem = group(page, "Plan").locator("[data-part='item']").nth(1)
    await expect(yearlyItem).toHaveAttribute("data-checked", "")
    await page.getByRole("button", { name: "Reset" }).click()
    await expect(yearly).not.toBeChecked()
    await expect(yearlyItem).not.toHaveAttribute("data-checked", "")
    await expect(yearlyItem.locator("[data-part='indicator']")).toHaveCSS(
      "opacity",
      "0",
    )
    //the form's own reset handler clears the readout; the radios are empty again
    await expect(output).toHaveText("not submitted")
    expect(
      await yearly.evaluate(
        (el) => (el as HTMLInputElement).validity.valueMissing,
      ),
    ).toBe(true)
    await yearly.click({ timeout: 5_000 })
    await expect(yearlyItem).toHaveAttribute("data-checked", "")
    await submit.click()
    await expect(output).toHaveText("plan=yearly&source=lab")
  })

  test("under dir=rtl the box sits at the inline start, and each engine keeps its own arrow direction", async ({
    page,
    browserName,
  }) => {
    const items = group(page, "Direction").locator("[data-part='item']")
    const first = items.first()
    await first.scrollIntoViewIfNeeded()
    const box = await first.locator("[data-part='box']").boundingBox()
    const text = await first.locator("span").last().boundingBox()
    if (!box || !text) throw new Error("the rtl item has no box")
    expect(box.x, "the circle is right of its text").toBeGreaterThan(
      text.x,
    )
    const second = await items.nth(1).boundingBox()
    const firstBox = await first.boundingBox()
    if (!second || !firstBox) throw new Error("no item boxes")
    expect(
      second.x,
      "the second option is left of the first",
    ).toBeLessThan(firstBox.x)

    //measured: Chromium flips the horizontal arrows under rtl, so ArrowLeft moves
    //to the next option, the one drawn to the left; WebKit does not flip them, so
    //ArrowRight stays "next" in either direction. The group leaves both engines'
    //own behaviour alone, and this pins that it does
    await radio(page, "Direction", "One").focus()
    await page.keyboard.press(
      browserName === "webkit" ? "ArrowRight" : "ArrowLeft",
    )
    await expect(radio(page, "Direction", "Two")).toBeChecked()
    await expect(radio(page, "Direction", "Two")).toBeFocused()
  })

  test("under forced colors the box keeps an outline and the mark keeps a colour", async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== "chromium", "forced colors emulation is CDP")
    await page.emulateMedia({ forcedColors: "active" })
    const item = group(page, "Billing")
      .locator("[data-part='item']")
      .first()
    const paint = await item.evaluate((el) => {
      const box = el.querySelector("[data-part='box']") as HTMLElement
      const mark = el.querySelector("[data-part='indicator'] circle")
      const boxStyle = getComputedStyle(box)
      return {
        outline: boxStyle.outlineStyle,
        outlineColor: boxStyle.outlineColor,
        background: boxStyle.backgroundColor,
        fill: mark ? getComputedStyle(mark).fill : null,
      }
    })
    expect(paint.outline).toBe("solid")
    expect(paint.outlineColor).not.toBe(paint.background)
    expect(paint.fill, "the dot paints in a real colour").not.toBe(
      paint.background,
    )
    expect(paint.fill).not.toBe("none")
  })
})

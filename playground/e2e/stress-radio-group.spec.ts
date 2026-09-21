import type { Locator, Page } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import { expect, test } from "./support/reload-guard"

/*
 * RadioGroup under stress. radio-group.spec.ts asks the engine the contract's
 * questions once each; this file asks them at the edges and in bursts, and after
 * every step reads the WHOLE roving state back: exactly one radio `:checked`,
 * exactly one item stamped `data-checked`, focus on the checked radio, no
 * `tabindex` and no `aria-checked` written by the group (the radios are native,
 * so the browser owns both — src/components/radio-group.tsx: "nothing is
 * re-implemented"), and the change counter moved by exactly what moved.
 *
 * What the source promises, and so what is asserted:
 *
 *   - The arrow keys, Tab, Space and form submission are the browser's own radio
 *     behaviour. Past either end the engines differ and the group keeps each
 *     one's: Chromium wraps, WebKit stops (measured in radio-group.spec.ts for
 *     the last radio; pinned here for the first as well). Home and End are not
 *     radio keys in either engine, so they move nothing.
 *   - A disabled item is skipped by the arrows in BOTH directions and inert to a
 *     click; a disabled group takes nothing.
 *   - `onValueChange` fires once per selection the user makes and never for a
 *     re-selection or a stop at the end (WebKit) — so a 20-key mash reports
 *     exactly the number of moves the engine made.
 *   - Two rapid clicks on the same radio report once; alternating clicks report
 *     each.
 *
 * Doctrine as in stress-select.spec.ts: `awaitClientHandover` in every
 * beforeEach, no retries, no warm-ups, no sleeps, and the premise of each burst
 * (the first press moved) asserted before the burst's outcome. Layout and
 * keyboard are real only in a browser, so every test runs on both projects; the
 * webkit project is the iPhone 13 descriptor (portrait), so the rotate guard
 * never covers the page.
 */

function group(page: Page, name: string): Locator {
  return page.getByRole("radiogroup", { name, exact: true })
}

function radio(page: Page, groupName: string, name: string): Locator {
  return group(page, groupName).getByRole("radio", { name, exact: true })
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

/**
 * The whole roving state of one group, read in one evaluate so no step can
 * slip between the reads: the checked values, the items stamped `data-checked`,
 * whether the browser wrote `tabindex`/`aria-checked` anywhere (the group must
 * not), and which radio has focus.
 */
function roving(page: Page, groupName: string) {
  return group(page, groupName).evaluate((root) => {
    const radios = [
      ...root.querySelectorAll<HTMLInputElement>("input[type='radio']"),
    ]
    return {
      checked: radios.filter((r) => r.checked).map((r) => r.value),
      stamped: [
        ...root.querySelectorAll("[data-part='item'][data-checked]"),
      ].map((item) => item.querySelector("input")?.value ?? "?"),
      tabindexed: radios.filter((r) => r.hasAttribute("tabindex")).length,
      ariaChecked: radios.filter((r) => r.hasAttribute("aria-checked"))
        .length,
      focused:
        document.activeElement instanceof HTMLInputElement
          ? document.activeElement.value
          : (document.activeElement?.tagName ?? "none"),
    }
  })
}

const LABELS: Record<string, string> = {
  monthly: "Monthly",
  yearly: "Yearly",
  lifetime: "Lifetime",
  alpha: "Alpha",
  beta: "Beta",
  gamma: "Gamma",
}
const labelOf = (value: string) => LABELS[value] ?? value

async function expectRoving(
  page: Page,
  groupName: string,
  value: string,
  msg: string,
  focused: string = value,
) {
  await expect(radio(page, groupName, labelOf(value))).toBeChecked()
  const state = await roving(page, groupName)
  expect(state, msg).toEqual({
    checked: [value],
    stamped: [value],
    tabindexed: 0,
    ariaChecked: 0,
    focused,
  })
}

/**
 * Where focus is after a CLICK on a radio: the radio on Chromium; on WebKit a
 * click focuses no radio (nor a button) — Safari's own rule, which the group does
 * not fight ("nothing is re-implemented") — so it stays where it was, the body.
 */
const focusAfterClick = (browserName: string, value: string) =>
  browserName === "webkit" ? "BODY" : value

test.describe("RadioGroup under stress", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/radio-group")
    await awaitClientHandover(page)
    await group(page, "Billing").waitFor()
  })

  test("the arrows at both ends: Chromium wraps, WebKit stops, and only a move reports", async ({
    page,
    browserName,
  }) => {
    const changes = page.getByTestId("controlled-changes")
    await radio(page, "Billing", "Monthly").focus()
    await expectRoving(page, "Billing", "monthly", "start")

    //up from the first
    await page.keyboard.press("ArrowUp")
    if (browserName === "webkit") {
      await expectRoving(
        page,
        "Billing",
        "monthly",
        "WebKit stops at the first",
      )
      await expect(changes).toHaveText("0")
    } else {
      await expectRoving(
        page,
        "Billing",
        "lifetime",
        "Chromium wraps to the last",
      )
      await expect(changes).toHaveText("1")
    }

    //down from the last
    await radio(page, "Billing", "Lifetime").focus()
    await page.keyboard.press("Space")
    await expectRoving(
      page,
      "Billing",
      "lifetime",
      "Space selected the focused radio",
    )
    const beforeDown = Number(await changes.innerText())
    await page.keyboard.press("ArrowDown")
    if (browserName === "webkit") {
      await expectRoving(
        page,
        "Billing",
        "lifetime",
        "WebKit stops at the last",
      )
      await expect(changes).toHaveText(String(beforeDown))
    } else {
      await expectRoving(
        page,
        "Billing",
        "monthly",
        "Chromium wraps to the first",
      )
      await expect(changes).toHaveText(String(beforeDown + 1))
    }
    //a left/right pair moves the same way as up/down in both engines
    await page.keyboard.press("ArrowRight")
    const afterRight = await roving(page, "Billing")
    expect(afterRight.checked).toHaveLength(1)
    expect(afterRight.focused).toBe(afterRight.checked[0])
    await page.keyboard.press("ArrowLeft")
    const afterLeft = await roving(page, "Billing")
    expect(afterLeft.checked).toHaveLength(1)
    expect(afterLeft.focused).toBe(afterLeft.checked[0])
  })

  test("Home and End move nothing: they are not radio keys in either engine", async ({
    page,
  }) => {
    await radio(page, "Billing", "Yearly").focus()
    await page.keyboard.press("Space")
    await expectRoving(
      page,
      "Billing",
      "yearly",
      "premise: Yearly selected",
    )
    await page.keyboard.press("Home")
    await expectRoving(page, "Billing", "yearly", "Home changed nothing")
    await page.keyboard.press("End")
    await expectRoving(page, "Billing", "yearly", "End changed nothing")
    await expect(page.getByTestId("controlled-changes")).toHaveText("1")
  })

  test("a disabled item in the middle is skipped in both directions, and a click on it does nothing", async ({
    page,
    browserName,
  }) => {
    const log = page.locator("[data-lab-log] li")
    const beta = radio(page, "Letters", "Beta")
    await expect(beta).toBeDisabled()
    await radio(page, "Letters", "Alpha").focus()
    await expectRoving(page, "Letters", "alpha", "start")

    await page.keyboard.press("ArrowDown")
    await expectRoving(page, "Letters", "gamma", "down skips Beta")
    await page.keyboard.press("ArrowUp")
    await expectRoving(page, "Letters", "alpha", "up skips Beta")
    await page.keyboard.press("ArrowRight")
    await expectRoving(page, "Letters", "gamma", "right skips Beta")
    await page.keyboard.press("ArrowLeft")
    await expectRoving(page, "Letters", "alpha", "left skips Beta")
    await expect(log).toHaveCount(4)

    //past the end with a disabled last-but-one: Chromium wraps over it, WebKit stops
    await page.keyboard.press("ArrowUp")
    if (browserName === "webkit") {
      await expectRoving(page, "Letters", "alpha", "WebKit stops at Alpha")
      await expect(log).toHaveCount(4)
    } else {
      await expectRoving(
        page,
        "Letters",
        "gamma",
        "Chromium wraps to Gamma",
      )
      await expect(log).toHaveCount(5)
    }

    //a forced click on the disabled item selects nothing and never focuses Beta.
    //The engines blur the active element on a press on a disabled control
    //(focus lands on body on both) — native input semantics, so focus is
    //read but not pinned here
    const before = await roving(page, "Letters")
    await beta.click({ force: true })
    await expect(beta).not.toBeChecked()
    const { focused, ...after } = await roving(page, "Letters")
    expect(focused).not.toBe("beta")
    expect(after).toEqual({
      checked: before.checked,
      stamped: before.stamped,
      tabindexed: 0,
      ariaChecked: 0,
    })
    //no fixed wait for "nothing": the next real selection must add exactly one
    //line, which it cannot if the forced click above had logged too
    const lines = await log.count()
    const other = before.checked[0] === "alpha" ? "Gamma" : "Alpha"
    await radio(page, "Letters", other).click({ timeout: 5_000 })
    await expect(log.first()).toContainText(
      `letters → ${other.toLowerCase()}`,
    )
    await expect(log).toHaveCount(lines + 1)
  })

  test("twenty ArrowDowns in a burst land on a deterministic radio with the roving state intact", async ({
    page,
    browserName,
  }) => {
    const changes = page.getByTestId("controlled-changes")
    await radio(page, "Billing", "Monthly").focus()
    //premise: the first press moves
    await page.keyboard.press("ArrowDown")
    await expectRoving(page, "Billing", "yearly", "the first press moved")
    await expect(changes).toHaveText("1")

    for (let i = 0; i < 19; i++) await page.keyboard.press("ArrowDown")
    //20 presses from Monthly over 3 radios: Chromium wraps → index 20 % 3 = 2,
    //Lifetime, 20 changes; WebKit stops at the last → Lifetime, 2 changes
    await expectRoving(page, "Billing", "lifetime", "after the burst")
    await expect(changes).toHaveText(browserName === "webkit" ? "2" : "20")

    //and the group is still keyboard-sane: one more press behaves like the first
    await page.keyboard.press("ArrowUp")
    await expectRoving(
      page,
      "Billing",
      "yearly",
      "after the burst, up works",
    )
    await expect(changes).toHaveText(browserName === "webkit" ? "3" : "21")
  })

  test("focus order after a burst: Tab leaves in one press and Shift+Tab returns to the NEW selection", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === "webkit",
      "WebKit's default Tab order has no radios in it (Safari's 'Press Tab to highlight each item' is off)",
    )
    await radio(page, "Billing", "Monthly").focus()
    for (let i = 0; i < 20; i++) await page.keyboard.press("ArrowDown")
    await expectRoving(page, "Billing", "lifetime", "after the burst")
    await page.keyboard.press("Tab")
    const after = await focused(page)
    expect(
      after.startsWith("Billing:"),
      `focus left the group (${after})`,
    ).toBe(false)
    await page.keyboard.press("Shift+Tab")
    expect(await focused(page), "Shift+Tab comes back to Lifetime").toBe(
      "Billing:lifetime",
    )
    await expectRoving(
      page,
      "Billing",
      "lifetime",
      "Shift+Tab selected nothing",
    )
  })

  test("rapid clicks: alternating radios report each, the same radio twice reports once", async ({
    page,
    browserName,
  }) => {
    const changes = page.getByTestId("controlled-changes")
    const yearly = radio(page, "Billing", "Yearly")
    const monthly = radio(page, "Billing", "Monthly")
    for (let i = 0; i < 5; i++) {
      await yearly.click({ timeout: 5_000 })
      await monthly.click({ timeout: 5_000 })
    }
    await expectRoving(
      page,
      "Billing",
      "monthly",
      "ten alternating clicks",
      focusAfterClick(browserName, "monthly"),
    )
    await expect(changes).toHaveText("10")

    //a double click on the same radio: the second click is a re-selection and
    //fires no `change`
    await yearly.dblclick({ timeout: 5_000 })
    await expectRoving(
      page,
      "Billing",
      "yearly",
      "a same-radio double click",
      focusAfterClick(browserName, "yearly"),
    )
    await expect(changes).toHaveText("11")

    //ten native clicks alternating in ONE task (no device delivers this): a
    //consistency check only. React restores a controlled radio's `checked`
    //after each event from props it has not re-rendered yet, so the count is
    //the engine's, not a promise — what must hold is that the DOM, the stamp
    //and the readout agree once the task is over.
    const burstChanges = await yearly.evaluate((el) => {
      const root = el.closest("[role='radiogroup']")
      const m = root?.querySelector<HTMLInputElement>(
        "input[value='monthly']",
      )
      let n = 0
      const count = () => n++
      root?.addEventListener("change", count)
      for (let i = 0; i < 5; i++) {
        m?.click()
        ;(el as HTMLInputElement).click()
      }
      root?.removeEventListener("change", count)
      return n
    })
    const settled = await roving(page, "Billing")
    expect(settled.checked, "one checked radio").toHaveLength(1)
    expect(settled.stamped, "the stamp follows the checked radio").toEqual(
      settled.checked,
    )
    await expect(page.getByTestId("controlled-value")).toHaveText(
      settled.checked[0] ?? "",
    )
    expect(Number(await changes.innerText())).toBeGreaterThanOrEqual(11)
    console.log(
      `[stress-radio-group] same-task alternating burst: ${burstChanges} native change events, landed on ${settled.checked[0]}`,
    )
  })

  test("a refusing owner under a burst: the DOM stays on the owner's value after every click", async ({
    page,
    browserName,
  }) => {
    await page
      .getByRole("button", { name: "freeze the controlled group" })
      .click()
    const changes = page.getByTestId("controlled-changes")
    for (let i = 0; i < 5; i++) {
      await radio(page, "Billing", "Yearly").click({ timeout: 5_000 })
      await expect(changes).toHaveText(String(i + 1))
      //the owner keeps the value (React restores `checked` from props); the
      //press still focused the radio it landed on where a click focuses at all
      await expect(radio(page, "Billing", "Monthly")).toBeChecked()
      expect(
        await roving(page, "Billing"),
        `refused click ${i + 1}`,
      ).toEqual({
        checked: ["monthly"],
        stamped: ["monthly"],
        tabindexed: 0,
        ariaChecked: 0,
        focused: focusAfterClick(browserName, "yearly"),
      })
    }
    await expect(page.getByTestId("controlled-value")).toHaveText(
      "monthly",
    )
  })

  test("a disabled group under a burst of clicks and keys takes nothing", async ({
    page,
  }) => {
    const locked = group(page, "Locked")
    await expect(locked).toHaveAttribute("aria-disabled", "true")
    const off = radio(page, "Locked", "Off")
    for (let i = 0; i < 5; i++) await off.click({ force: true })
    await off.evaluate((el) => {
      for (let i = 0; i < 5; i++) (el as HTMLInputElement).click()
    })
    await expect(radio(page, "Locked", "On")).toBeChecked()
    await expect(off).not.toBeChecked()
    const state = await roving(page, "Locked")
    expect(state.checked).toEqual(["on"])
    expect(state.stamped).toEqual(["on"])
    //the log list is not rendered while empty, so count matching rows
    await expect(
      page.locator("[data-lab-log] li", {
        hasText: "THIS MUST NEVER APPEAR",
      }),
    ).toHaveCount(0)
  })

  test("long session: 100 arrow presses stay deterministic and report exactly the moves", async ({
    page,
    browserName,
  }) => {
    const changes = page.getByTestId("controlled-changes")
    await radio(page, "Billing", "Monthly").focus()
    for (let i = 0; i < 100; i++) await page.keyboard.press("ArrowDown")
    //Chromium: 100 wraps from Monthly → index 100 % 3 = 1, Yearly, 100 changes;
    //WebKit: stops at Lifetime after 2 moves
    if (browserName === "webkit") {
      await expectRoving(page, "Billing", "lifetime", "after 100 presses")
      await expect(changes).toHaveText("2")
    } else {
      await expectRoving(page, "Billing", "yearly", "after 100 presses")
      await expect(changes).toHaveText("100")
    }
    await expect(page.getByTestId("controlled-value")).toHaveText(
      browserName === "webkit" ? "lifetime" : "yearly",
    )
  })
})

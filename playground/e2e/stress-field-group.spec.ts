import type { Locator, Page } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import { expect, test } from "./support/reload-guard"

/*
 * FieldGroup under stress — two hundred rows, a checkbox in a label row, and a
 * disabled row rendered as a link.
 *
 * Doctrine, same as `field-group.spec.ts`: both engines (the label activation and
 * the `:first-child` / `:last-child` resolution are the browser's), the hydration
 * gate in every `beforeEach`, the reload guard armed, no retries. Navigation is
 * counted at the source — `history.pushState` is wrapped before the page loads, so
 * "navigates exactly once" is one push and not a guess from a URL that may have
 * been rewritten on arrival.
 *
 * What is measured:
 * - the "Two hundred rows" section: its DOM node count, that every child of the
 *   rows box is a row, that `first:` / `last:` round exactly one row's top and one
 *   row's bottom, and that on every one of the 200 rows the corner the browser
 *   painted agrees with what `getFieldItemPosition(index, 200)` printed.
 * - the "Testing" link row: one click, one push, lands on `/lab`.
 * - the "Disabled navigation" row (`disabled render={<Link/>}`): the row carries
 *   `data-disabled` + `aria-disabled` together, and — the lab brief's own word —
 *   is INERT: no push, no navigation, not in the tab order.
 * - the "Checkbox row" (`render={<label/>}` around a Checkbox, the idiom the
 *   FieldGroup docs give for a row that is its control's label): a click on the
 *   row's title toggles the checkbox exactly once, the DOM `checked` agrees.
 */

const PAGE = "/lab/field-group"
const ROOT = '[data-adaptv="field-group"]'

const readout = (page: Page, name: string) =>
  page.locator(`[data-readout="${name}"]`)

function driver(page: Page) {
  const root = page.locator(ROOT)
  const section = (title: string) =>
    root.locator('[data-part="section"]', {
      has: page.locator('[data-part="header"]', { hasText: title }),
    })
  const rows = (title: string) =>
    section(title).locator('[data-part="rows"]')
  const row = (title: string, label: string) =>
    rows(title).locator('[data-part="row"]', {
      has: page.locator('[data-part="title"]', { hasText: label }),
    })
  const title = (sectionTitle: string, label: string) =>
    row(sectionTitle, label).locator('[data-part="title"]')
  return { root, section, rows, row, title }
}

const pushes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __pushes: number }).__pushes)

const radii = (locator: Locator) =>
  locator.evaluate((el) => {
    const s = getComputedStyle(el)
    return {
      topLeft: Number.parseFloat(s.borderTopLeftRadius),
      bottomLeft: Number.parseFloat(s.borderBottomLeftRadius),
    }
  })

test.describe("FieldGroup under stress", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const host = window as unknown as { __pushes: number }
      host.__pushes = 0
      const push = history.pushState.bind(history)
      history.pushState = (...args) => {
        host.__pushes += 1
        return push(...args)
      }
    })
    await page.goto(PAGE)
    await awaitClientHandover(page)
    await page.locator(ROOT).waitFor()
  })

  test("two hundred rows: a small DOM, only rows in the box, one rounded top, one rounded bottom, and the helper agrees with the browser on every row", async ({
    page,
  }) => {
    const { section, rows } = driver(page)
    const box = rows("Two hundred rows")
    await expect(box.locator(":scope > *")).toHaveCount(200)
    await expect(box.locator(':scope > [data-part="row"]')).toHaveCount(
      200,
    )

    const nodes = await section("Two hundred rows").evaluate(
      (el) => el.querySelectorAll("*").length,
    )
    test.info().annotations.push({
      type: "dom-200-rows",
      description: `${nodes} elements in the section for 200 rows (${(nodes / 200).toFixed(2)} per row)`,
    })
    //row + label column + title + control span = 4 per row, plus the section's
    //own header, rows box and footer
    expect(nodes, "no hidden wrappers per row").toBeLessThanOrEqual(
      200 * 4 + 3,
    )

    //one read over all 200 rows: what the browser painted vs what the helper said
    const verdict = await box.evaluate((el) => {
      const children = Array.from(el.children) as HTMLElement[]
      let roundedTop = 0
      let roundedBottom = 0
      const disagreements: string[] = []
      children.forEach((child, index) => {
        const s = getComputedStyle(child)
        const top = Number.parseFloat(s.borderTopLeftRadius) > 0
        const bottom = Number.parseFloat(s.borderBottomLeftRadius) > 0
        if (top) roundedTop += 1
        if (bottom) roundedBottom += 1
        const printed = child
          .querySelector('[data-readout="position"]')
          ?.textContent?.trim()
        const painted =
          top && bottom
            ? "only"
            : top
              ? "leading"
              : bottom
                ? "trailing"
                : "middle"
        if (printed !== painted)
          disagreements.push(
            `${index}: printed ${printed}, painted ${painted}`,
          )
        if (child.getAttribute("data-index") !== String(index))
          disagreements.push(
            `${index}: data-index ${child.getAttribute("data-index")}`,
          )
      })
      return { roundedTop, roundedBottom, disagreements }
    })
    expect(verdict.roundedTop, "first: rounds exactly one top").toBe(1)
    expect(verdict.roundedBottom, "last: rounds exactly one bottom").toBe(
      1,
    )
    expect(verdict.disagreements, "helper and browser agree").toEqual([])

    const { row } = driver(page)
    expect(
      (await radii(row("Two hundred rows", "Row 0"))).topLeft,
    ).toBeGreaterThan(0)
    expect(
      (await radii(row("Two hundred rows", "Row 199"))).bottomLeft,
    ).toBeGreaterThan(0)
    await expect(readout(page, "position").nth(0)).toHaveText("leading")
    await expect(readout(page, "position").nth(100)).toHaveText("middle")
    await expect(readout(page, "position").nth(199)).toHaveText("trailing")
  })

  test("a link row navigates exactly once on click", async ({ page }) => {
    const { rows } = driver(page)
    const link = rows("Framework").locator('a[data-adaptv="link"]')
    await expect(link).toHaveAttribute("href", "/lab")
    expect(await pushes(page), "premise: nothing pushed yet").toBe(0)
    await link.click()
    await expect(page).toHaveURL(/\/lab$/)
    await awaitClientHandover(page)
    expect(await pushes(page), "one click, one push").toBe(1)
  })

  test("a disabled row rendered as a link carries data-disabled and aria-disabled together, and is inert: no navigation, not in the tab order", async ({
    page,
  }) => {
    const { row, title } = driver(page)
    const disabled = row("Stress probes", "Disabled navigation")
    expect(await disabled.evaluate((el) => el.tagName)).toBe("A")
    await expect(disabled).toHaveAttribute("data-disabled", "")
    await expect(disabled).toHaveAttribute("aria-disabled", "true")
    await expect(disabled).toHaveAttribute("href", "/lab")

    //what a disabled Link is: out of the tab order and a not-allowed cursor
    await expect(
      disabled,
      "a disabled link is not tabbable (Link's own disabled sets tabindex=-1)",
    ).toHaveAttribute("tabindex", "-1")

    //force: Playwright reads aria-disabled as disabled and would otherwise wait
    await title("Stress probes", "Disabled navigation").click({
      force: true,
    })
    await page.waitForTimeout(300)
    await expect(page, "no navigation").toHaveURL(/\/lab\/field-group$/)
    expect(await pushes(page), "no push").toBe(0)
  })

  test("a checkbox in a label row toggles once from the row's title, and the DOM agrees", async ({
    page,
  }) => {
    const { row, title } = driver(page)
    const checkbox = page.getByRole("checkbox", {
      name: "Checkbox row",
      exact: true,
    })
    expect(
      await row("Stress probes", "Checkbox row").evaluate(
        (el) => el.tagName,
      ),
      "render={<label />}",
    ).toBe("LABEL")
    await expect(checkbox).not.toBeChecked()
    await expect(readout(page, "pref-checkbox")).toHaveText("off")
    await expect(readout(page, "checkbox-toggles")).toHaveText("0")

    //the title text, away from the box: the browser's label activation
    //clicking the checkbox, a click no press on the checkbox produced
    await title("Stress probes", "Checkbox row").click()
    await expect(readout(page, "pref-checkbox")).toHaveText("on")
    await expect(readout(page, "checkbox-toggles")).toHaveText("1")
    await expect(checkbox, "the DOM agrees with the state").toBeChecked()

    await title("Stress probes", "Checkbox row").click()
    await expect(readout(page, "pref-checkbox")).toHaveText("off")
    await expect(readout(page, "checkbox-toggles")).toHaveText("2")
    await expect(checkbox).not.toBeChecked()
  })
})

test.describe("FieldGroup under stress, under a finger", () => {
  //a portrait touch context: the 1280x720 desktop project with hasTouch reads
  //as a landscape phone and the rotate guard covers the page
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE)
    await awaitClientHandover(page)
    await page.locator(ROOT).waitFor()
  })

  test("a tap on the checkbox row's title toggles its checkbox once", async ({
    page,
  }) => {
    const { title } = driver(page)
    const checkbox = page.getByRole("checkbox", {
      name: "Checkbox row",
      exact: true,
    })
    const target = title("Stress probes", "Checkbox row")
    await target.scrollIntoViewIfNeeded()
    const box = await target.boundingBox()
    if (!box) throw new Error("the Checkbox row title has no box")
    await page.touchscreen.tap(
      box.x + box.width / 2,
      box.y + box.height / 2,
    )
    await expect(readout(page, "pref-checkbox")).toHaveText("on")
    await expect(readout(page, "checkbox-toggles")).toHaveText("1")
    await expect(checkbox).toBeChecked()
  })
})

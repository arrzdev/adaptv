import type { Locator, Page } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import { expect, test } from "./support/reload-guard"

/*
 * FieldGroup — the grouped settings form. adaptv ships the STRUCTURE (which
 * element is the section, which box holds only the rows, which row is a
 * <label>) and none of the paint, so what this file pins is that structure and
 * the one behaviour that falls out of it: the corners a consumer's `first:` /
 * `last:` / `only:` paint are correct ONLY if the rows box holds nothing but
 * rows, and a row rendered as a <label> reaches its switch from anywhere on the
 * row ONLY if the browser's own label activation gets through.
 *
 * Both engines run it: the label activation and the `:first-child` / `:only-child`
 * resolution are the browser's, not React's, and WebKit's is the one that ships
 * on iOS.
 */

const PAGE = "/lab/field-group"
const ROOT = '[data-adaptv="field-group"]'

const readout = (page: Page, name: string) =>
  page.locator(`[data-readout="${name}"]`)

/**
 * The page's structure as locators, keyed by the section titles the page
 * renders. A section is found by the text of its header rather than by index so
 * a reordered page fails on the title and not on a silently wrong row.
 */
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
  const sw = (label: string) =>
    page.getByRole("switch", { name: label, exact: true })
  return { root, section, rows, row, title, sw }
}

const radii = (locator: Locator) =>
  locator.evaluate((el) => {
    const s = getComputedStyle(el)
    return {
      topLeft: Number.parseFloat(s.borderTopLeftRadius),
      topRight: Number.parseFloat(s.borderTopRightRadius),
      bottomLeft: Number.parseFloat(s.borderBottomLeftRadius),
      bottomRight: Number.parseFloat(s.borderBottomRightRadius),
    }
  })

test.describe("FieldGroup structure", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE)
    await awaitClientHandover(page)
    await page.locator(ROOT).waitFor()
  })

  test("a section is labelled by its own header", async ({ page }) => {
    const { section } = driver(page)
    const preferences = section("Preferences")
    expect(await preferences.evaluate((el) => el.tagName)).toBe("SECTION")
    const labelledBy = await preferences.getAttribute("aria-labelledby")
    expect(labelledBy, "aria-labelledby is stamped").toBeTruthy()
    //the id must RESOLVE, and to the header — an aria-labelledby that points at
    //nothing is worse than none, because AT reads the section as unnamed while
    //the markup claims otherwise
    const header = page.locator(`[id="${labelledBy}"]`)
    await expect(header).toHaveAttribute("data-part", "header")
    await expect(header).toHaveText("Preferences")
  })

  test("a slotted header carries the section's id, and a section without one is not labelled", async ({
    page,
  }) => {
    const { section } = driver(page)
    //the third section uses <FieldGroup.Header> with its own markup; the id
    //still lands on it, so the badge inside is part of the accessible name
    const oneRow = section("One row")
    const labelledBy = await oneRow.getAttribute("aria-labelledby")
    expect(labelledBy).toBeTruthy()
    const header = page.locator(`[id="${labelledBy}"]`)
    await expect(header).toHaveAttribute("data-part", "header")
    await expect(header).toContainText("One row")
    await expect(header).toContainText("only:")
  })

  test("the rows box holds only rows — three of them, all rows", async ({
    page,
  }) => {
    const { rows } = driver(page)
    const box = rows("Preferences")
    const children = box.locator(":scope > *")
    await expect(children).toHaveCount(3)
    //every child is a row, so `first:` / `last:` on a row read the group and
    //not a header or footer that leaked into the box
    await expect(box.locator(':scope > [data-part="row"]')).toHaveCount(3)
    //and the header and footer sit OUTSIDE it
    await expect(box.locator('[data-part="header"]')).toHaveCount(0)
    await expect(box.locator('[data-part="footer"]')).toHaveCount(0)
  })

  test("first:/last:/only: paint the grouped corners with no data-position @tailwind", async ({
    page,
  }) => {
    const { row } = driver(page)
    const first = await radii(row("Preferences", "Dark mode"))
    const middle = await radii(row("Preferences", "Animations"))
    const last = await radii(row("Preferences", "Haptics"))
    expect(first.topLeft, "first row: top corners").toBeGreaterThan(0)
    expect(first.topRight).toBeGreaterThan(0)
    expect(first.bottomLeft, "first row: bottom corners square").toBe(0)
    expect(middle.topLeft, "middle row: square").toBe(0)
    expect(middle.bottomLeft).toBe(0)
    expect(last.bottomLeft, "last row: bottom corners").toBeGreaterThan(0)
    expect(last.bottomRight).toBeGreaterThan(0)
    expect(last.topLeft, "last row: top corners square").toBe(0)

    const only = await radii(row("One row", "Alone in its section"))
    expect(only.topLeft, "only row: all four").toBeGreaterThan(0)
    expect(only.topRight).toBeGreaterThan(0)
    expect(only.bottomLeft).toBeGreaterThan(0)
    expect(only.bottomRight).toBeGreaterThan(0)

    //the component stamps nothing of its own for this
    await expect(
      page.locator(`${ROOT} [data-position]`),
      "no data-position attribute anywhere",
    ).toHaveCount(0)
  })

  test("a label row's own parts are stamped, and a slot wins over the shorthand", async ({
    page,
  }) => {
    const { row } = driver(page)
    const dark = row("Preferences", "Dark mode")
    expect(
      await dark.evaluate((el) => el.tagName),
      "render={<label />}",
    ).toBe("LABEL")
    await expect(dark.locator('[data-part="label"]')).toHaveCount(1)
    await expect(dark.locator('[data-part="title"]')).toHaveText(
      "Dark mode",
    )
    await expect(dark.locator('[data-part="description"]')).toHaveText(
      "Follows the row, not the track",
    )

    const slotted = row("Slots", "Slotted label")
    const description = slotted.locator('[data-part="description"]')
    await expect(description).toHaveText(
      "a description that brought its own markup",
    )
    //the element form keeps its own className — that is why it exists
    await expect(description).toHaveClass(/italic/)
  })

  test("getFieldItemPosition classifies index/total", async ({ page }) => {
    await expect(readout(page, "pos-0-1")).toHaveText("only")
    await expect(readout(page, "pos-0-3")).toHaveText("leading")
    await expect(readout(page, "pos-1-3")).toHaveText("middle")
    await expect(readout(page, "pos-2-3")).toHaveText("trailing")
  })
})

test.describe("FieldGroup behaviour", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE)
    await awaitClientHandover(page)
    await page.locator(ROOT).waitFor()
  })

  test("clicking the row's title toggles its switch, once", async ({
    page,
  }) => {
    const { title, sw } = driver(page)
    await expect(readout(page, "pref-dark")).toHaveText("off")
    await expect(readout(page, "toggles")).toHaveText("0")
    await expect(sw("Dark mode")).not.toBeChecked()

    //the TITLE text, deliberately far from the track: this is the browser's
    //label activation clicking the checkbox, which the switch's engine hands to
    //toggle() as a click no press of its own produced
    await title("Preferences", "Dark mode").click()

    await expect(readout(page, "pref-dark")).toHaveText("on")
    await expect(sw("Dark mode")).toBeChecked()
    //once. a label activation that ALSO fires the track's engine would count 2
    await expect(readout(page, "toggles")).toHaveText("1")

    await title("Preferences", "Dark mode").click()
    await expect(readout(page, "pref-dark")).toHaveText("off")
    await expect(readout(page, "toggles")).toHaveText("2")
  })

  test("a disabled row is inert", async ({ page }) => {
    const { row, title, sw } = driver(page)
    const haptics = row("Preferences", "Haptics")
    await expect(haptics).toHaveAttribute("data-disabled", "")
    await expect(haptics).toHaveAttribute("aria-disabled", "true")
    await expect(sw("Haptics")).toBeDisabled()

    await title("Preferences", "Haptics").click({ force: true })
    //nothing to wait for on the negative — give the page one tick to be wrong
    await page.waitForTimeout(150)
    await expect(readout(page, "pref-haptics")).toHaveText("off")
    await expect(readout(page, "toggles")).toHaveText("0")
    await expect(sw("Haptics")).not.toBeChecked()
  })

  test("Tab visits the switches and the link, never a row", async ({
    page,
    browserName,
  }) => {
    //the webkit project is an iPhone: Safari's Tab does not walk the page, the
    //same reason hover-focus and cascade keep their keyboard walks on chromium
    test.skip(
      browserName !== "chromium",
      "a keyboard walk is a desktop UA",
    )
    //walk the tab order from the top of the document until the link is reached,
    //recording what was focused. the disabled switch is not focusable — that is
    //the browser's rule for a disabled input and the contract wants it kept
    const visited: { part: string | null; name: string | null }[] = []
    await page.evaluate(() => {
      ;(document.activeElement as HTMLElement | null)?.blur()
    })
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.press("Tab")
      const active = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        if (!el || el === document.body) return null
        return {
          part: el.getAttribute("data-part"),
          name:
            el.getAttribute("aria-label") ??
            el.querySelector('[data-part="title"]')?.textContent ??
            null,
          inGroup: el.closest('[data-adaptv="field-group"]') !== null,
          isLink: el.getAttribute("data-adaptv") === "link",
        }
      })
      if (!active) continue
      if (active.part === "row" && !active.isLink) {
        throw new Error(
          `Tab landed on a row div: ${JSON.stringify(active)}`,
        )
      }
      if (active.inGroup)
        visited.push({ part: active.part, name: active.name })
      if (active.inGroup && active.isLink) break
    }
    expect(visited.map((v) => v.name)).toEqual([
      "Dark mode",
      "Animations",
      "Testing",
    ])
  })

  test("the navigation row is a real link to the testing index, and back returns", async ({
    page,
  }) => {
    const { rows } = driver(page)
    const box = rows("Framework")
    const link = box.locator('a[data-adaptv="link"]')
    await expect(link).toHaveAttribute("href", "/lab")
    //the row's part lands on the anchor: Link spreads what the row hands it, so
    //the rows box still holds only rows when one of them is a link
    await expect(link).toHaveAttribute("data-part", "row")
    await expect(box.locator(":scope > *")).toHaveCount(1)
    await expect(box.locator(':scope > [data-part="row"]')).toHaveCount(1)
    await expect(link.locator('[data-part="title"]')).toHaveText("Testing")

    //a plain click navigates headless: the engine's onClickCapture only swallows
    //a press it read as moved / held / cancelled, and Link overrides the engine's
    //swallow-everything onClick. (An older note in the harness memory says Link
    //cannot be driven headless; measured here, it can.)
    await link.click()
    await expect(page).toHaveURL(/\/lab$/)
    await awaitClientHandover(page)
    await page.getByRole("button", { name: "Back to Testing" }).click()
    await expect(page).toHaveURL(/\/lab\/field-group$/)
  })
})

test.describe("FieldGroup under a finger", () => {
  //a portrait touch context: the 1280x720 desktop project with hasTouch reads
  //as a landscape phone and the rotate guard covers the page
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE)
    await awaitClientHandover(page)
    await page.locator(ROOT).waitFor()
  })

  test("a tap on the row's title toggles its switch", async ({ page }) => {
    const { title, sw } = driver(page)
    await expect(readout(page, "pref-animations")).toHaveText("on")
    const target = title("Preferences", "Animations")
    await target.scrollIntoViewIfNeeded()
    const box = await target.boundingBox()
    if (!box) throw new Error("the Animations title has no box")
    await page.touchscreen.tap(
      box.x + box.width / 2,
      box.y + box.height / 2,
    )
    await expect(readout(page, "pref-animations")).toHaveText("off")
    await expect(sw("Animations")).not.toBeChecked()
    await expect(readout(page, "toggles")).toHaveText("1")
  })
})

import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Locale under runtime changes — twenty `languagechange` events in a row, on
 * both engines.
 *
 * `locale.spec.ts` pins the record per browser context. Here the source moves
 * under a running page, the way a browser's language setting does: the test
 * overrides `navigator.language` / `navigator.languages` and dispatches the
 * `languagechange` event `src/capabilities/locale.ts` binds. The contract there:
 * the record is stable until the tag or the list moves, every real move is one
 * notification, a change that lands on the same tag is swallowed, and the
 * derived fields (direction, separators) follow the tag in the same render.
 * The lab page counts every tag it sees, so twenty moves are a counter of
 * twenty and a log of twenty-one.
 */

const field = (page: Page, name: string) =>
  page.getByTestId(`locale-${name}`)

/** Install the override once, then move the language N times, one task each. */
function move(page: Page, tags: string[]) {
  return page.evaluate(async (tags) => {
    const seam = window as { __lang?: { current: string } }
    if (!seam.__lang) {
      seam.__lang = { current: navigator.language }
      Object.defineProperty(Navigator.prototype, "language", {
        configurable: true,
        get: () => seam.__lang?.current,
      })
      Object.defineProperty(Navigator.prototype, "languages", {
        configurable: true,
        get: () => [seam.__lang?.current],
      })
    }
    for (const tag of tags) {
      seam.__lang.current = tag
      if (navigator.language !== tag) {
        throw new Error("the navigator.language override did not take")
      }
      window.dispatchEvent(new Event("languagechange"))
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }, tags)
}

test.describe("Locale under runtime changes", () => {
  test.use({ locale: "en-US" })

  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/locale")
    await awaitClientHandover(page)
    await expect(field(page, "languageTag")).toHaveText("en-US")
    await expect(field(page, "changes")).toHaveText("0")
  })

  test("twenty moves are twenty changes, in order, and the last tag wins", async ({
    page,
  }) => {
    const tags = Array.from({ length: 20 }, (_, index) =>
      index % 2 === 0 ? "pt-PT" : "fr-CA",
    )
    await move(page, tags)
    await expect(field(page, "changes")).toHaveText("20")
    await expect(field(page, "languageTag")).toHaveText("fr-CA")
    await expect(field(page, "region")).toHaveText("CA")
    await expect(page.getByTestId("locale-log").locator("li")).toHaveText([
      "en-US",
      ...tags,
    ])
    //the formatted samples follow the record, in the same render
    await expect(page.getByTestId("locale-sample-number")).toHaveText(
      new Intl.NumberFormat("fr-CA").format(1234567.89),
    )
  })

  test("a change that lands on the same tag is swallowed", async ({
    page,
  }) => {
    await move(page, ["de-DE", "de-DE", "de-DE"])
    await expect(field(page, "languageTag")).toHaveText("de-DE")
    await expect(field(page, "changes")).toHaveText("1")
    await expect(page.getByTestId("locale-log").locator("li")).toHaveText([
      "en-US",
      "de-DE",
    ])
  })

  test("direction follows the tag, both ways", async ({ page }) => {
    for (let round = 0; round < 5; round += 1) {
      await move(page, ["ar-EG"])
      await expect(field(page, "direction")).toHaveText("rtl")
      await expect(
        page.getByTestId("locale-direction-sample"),
      ).toHaveAttribute("dir", "rtl")
      await move(page, ["en-GB"])
      await expect(field(page, "direction")).toHaveText("ltr")
      await expect(
        page.getByTestId("locale-direction-sample"),
      ).toHaveAttribute("dir", "ltr")
    }
    await expect(field(page, "changes")).toHaveText("10")
  })
})

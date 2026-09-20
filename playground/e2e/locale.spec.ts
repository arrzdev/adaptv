import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * Locale — the record the app runs in. Playwright's `locale` context option sets
 * both `navigator.language` and the engine's Intl default, which is exactly the
 * pair the capability derives from on the web, so each describe below is one
 * browser "set to" a language: what the tag reads, what the derived fields (clock,
 * week, separators, direction) say, and that the samples format through the tag.
 * The live half — `languagechange` — is driven by stubbing `navigator.language`
 * and dispatching the event by hand; a real browser fires the same event when the
 * user changes the language list. The per-app language switch on iOS and Android
 * is a device fact, walked on the sim.
 */

/**
 * Wait for the client to take over before reading anything.
 *
 * The record is server-rendered as the server's snapshot and only becomes this
 * browser's once the hook's subscription runs. Read before that and the row still
 * shows the server's value; dispatch `languagechange` before that and it fires into
 * a page with no subscribers. The splash is server-rendered too and self-unmounts
 * only once the client has hydrated and the local store has seeded, so its
 * disappearance is the one honest "React is driving now" signal on the page. Given
 * a generous timeout on purpose — the first test to reach a cold route pays its
 * transform cost, and a tight timeout here would re-create the flake it removes.
 */
async function awaitClientHandover(page: Page) {
  await expect(page.locator("[data-adaptv-splash]")).toHaveCount(0, {
    timeout: 20_000,
  })
}

const field = (page: Page, name: string) =>
  page.getByTestId(`locale-${name}`)

test.describe("Locale in the browser's own language", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/locale")
    await awaitClientHandover(page)
  })

  test("the tag is navigator.language, left-to-right, with no change counted", async ({
    page,
  }) => {
    const language = await page.evaluate(() => navigator.language)
    await expect(field(page, "languageTag")).toHaveText(language)
    await expect(field(page, "direction")).toHaveText("ltr")
    await expect(field(page, "changes")).toHaveText("0")
    await expect(field(page, "log").locator("li")).toHaveText([language])
  })

  test("languagechange re-reads the record in place", async ({ page }) => {
    await page.evaluate(() => {
      Object.defineProperty(navigator, "language", {
        get: () => "pt-PT",
        configurable: true,
      })
      window.dispatchEvent(new Event("languagechange"))
    })
    await expect(field(page, "changes")).toHaveText("1")
    await expect(field(page, "languageTag")).toHaveText("pt-PT")
    await expect(field(page, "hourCycle")).toHaveText("h23")
    await expect(field(page, "log").locator("li").last()).toHaveText(
      "pt-PT",
    )
  })
})

test.describe("Locale set to pt-PT", () => {
  test.use({ locale: "pt-PT" })

  test("a 24-hour clock, a Sunday week start, a comma decimal", async ({
    page,
  }) => {
    await page.goto("/lab/locale")
    await awaitClientHandover(page)
    await expect(field(page, "languageTag")).toHaveText("pt-PT")
    await expect(field(page, "hourCycle")).toHaveText("h23")
    //CLDR puts Portugal's first day on Sunday — not Monday like the rest of the
    //continent; pinned after reading getWeekInfo() on both engines
    await expect(field(page, "firstWeekday")).toHaveText("7")
    await expect(field(page, "decimalSeparator")).toHaveText(",")
    await expect(field(page, "sample-time")).toHaveText("15:07")
  })
})

test.describe("Locale set to de-DE", () => {
  test.use({ locale: "de-DE" })

  test("a Monday week start, a comma decimal, a dot grouping", async ({
    page,
  }) => {
    await page.goto("/lab/locale")
    await awaitClientHandover(page)
    await expect(field(page, "languageTag")).toHaveText("de-DE")
    await expect(field(page, "firstWeekday")).toHaveText("1")
    await expect(field(page, "decimalSeparator")).toHaveText(",")
    await expect(field(page, "groupingSeparator")).toHaveText(".")
  })
})

test.describe("Locale set to ar-EG", () => {
  test.use({ locale: "ar-EG" })

  test("right-to-left, a Saturday week start, a Friday–Saturday weekend", async ({
    page,
  }) => {
    await page.goto("/lab/locale")
    await awaitClientHandover(page)
    //the tag is whatever the engine hands out for this context — chromium says
    //"ar-EG", WebKit collapses it to a bare "ar" (measured on the run that pinned
    //this); the record must echo the engine, and every derived field below is
    //the same for both, because CLDR's default region for Arabic is Egypt
    const language = await page.evaluate(() => navigator.language)
    await expect(field(page, "languageTag")).toHaveText(language)
    await expect(field(page, "language")).toHaveText("ar")
    await expect(field(page, "direction")).toHaveText("rtl")
    await expect(field(page, "firstWeekday")).toHaveText("6")
    await expect(field(page, "weekend")).toHaveText("5,6")
    //the direction lands on the paragraph, never on the document
    await expect(field(page, "direction-sample")).toHaveAttribute(
      "dir",
      "rtl",
    )
    await expect(page.locator("html")).not.toHaveAttribute("dir", "rtl")
  })
})

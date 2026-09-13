import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Device — what the web path reports, on both engines.
 *
 * `getLanguageTag()` is the mutable half of the capability and the one a browser
 * answers fully, so it is pinned against the browser context's locale. Two locales,
 * neither of them the machine's, so a tag that came from anywhere but the context
 * (a default, the host's own locale, a value cached across pages) cannot pass both.
 *
 * ⚠︎ Which two matters on WebKit. It hands the page its own nearest supported tag,
 * not the context's: measured with Playwright's WebKit, `de-CH` reads `de-DE`,
 * `nl-BE` reads `nl-NL` and `ja-JP` reads `ja`, while Chromium passes every one
 * through. That is the engine's answer, and `getLanguageTag()` reporting it is
 * correct — so the locales below are ones both engines pass through unchanged, and
 * the premise line says so on its own if that ever stops being true.
 *
 * The immutable record is pinned for the web too: `platform` is `web`, and the
 * fields no browser reports come back as the explicit gap ("not reported here" is
 * how the lab row renders `null`) rather than an empty string or a guess.
 */

/** The value cell of a lab row — the label's own sibling, so a label can never satisfy it. */
const value = (page: Page, label: string) =>
  page
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::*[1]")

for (const locale of ["pt-PT", "fr-CA"]) {
  test.describe(`Device language tag under ${locale}`, () => {
    test.use({ locale })

    test("getLanguageTag() follows the browser context's locale", async ({
      page,
    }) => {
      await page.goto("/lab/device")
      await awaitClientHandover(page)
      //the premise: the context really did set the browser's language
      expect(await page.evaluate(() => navigator.language)).toBe(locale)

      await expect(value(page, "getLanguageTag()")).toHaveText(locale)
    })
  })
}

test.describe("Device record on the web", () => {
  test("reports the web platform and leaves what a browser cannot know as null", async ({
    page,
  }) => {
    await page.goto("/lab/device")
    await awaitClientHandover(page)
    await expect(value(page, "state")).toHaveText("resolved")

    await expect(value(page, "platform")).toHaveText("web")
    for (const label of ["manufacturer", "isVirtual", "getDeviceId()"]) {
      await expect(value(page, label)).toHaveText("not reported here")
    }
  })
})

import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Device — what the web path reports, on both engines.
 *
 * The record is immutable for the life of the process, and the one field a
 * user CAN change from Settings — the language — is not in it at all: it lives
 * in the locale capability, and `locale.spec.ts` pins it against the browser
 * context's locale. What is pinned here is the web half of the record:
 * `platform` is `web`, and the fields no browser reports come back as the
 * explicit gap ("not reported here" is how the lab row renders `null`) rather
 * than an empty string or a guess.
 */

/** The value cell of a lab row — the label's own sibling, so a label can never satisfy it. */
const value = (page: Page, label: string) =>
  page
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::*[1]")

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

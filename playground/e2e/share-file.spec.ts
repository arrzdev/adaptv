import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * A stored file through the share sheet. Headless chromium has no sheet, so
 * `navigator.share` and `navigator.canShare` are stubbed before the document
 * and the payload they receive is the assertion: the File the page wrote
 * through the filesystem capability, with its name, type and byte count. The
 * sheet itself is a device row. webkit is skipped because Playwright's WebKit
 * refuses its origin-private file system (see filesystem.spec.ts), so there is
 * no stored file to share there.
 */

type Captured = {
  title?: string
  files: Array<{ name: string; type: string; size: number }>
}

declare global {
  interface Window {
    __shared?: Captured
  }
}

async function awaitClientHandover(page: Page) {
  await expect(page.locator("[data-adaptv-splash]")).toHaveCount(0, {
    timeout: 20_000,
  })
}

test.describe("Share a stored file", () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium",
      "OPFS round-trips on chromium only",
    )
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "canShare", {
        configurable: true,
        value: () => true,
      })
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data: ShareData) => {
          window.__shared = {
            title: data.title,
            files: (data.files ?? []).map((f) => ({
              name: f.name,
              type: f.type,
              size: f.size,
            })),
          }
        },
      })
    })
    await page.goto("/lab/share")
    await awaitClientHandover(page)
  })

  test("the sheet receives the file the page wrote, by name, type and size", async ({
    page,
  }) => {
    await expect(page.getByTestId("share-stored-write")).toHaveText(
      "written",
    )
    await page.getByRole("button", { name: "Share a stored file" }).click()
    await expect(
      page.locator("section").filter({
        has: page.getByRole("heading", { name: "Open the sheet" }),
      }),
    ).toContainText("shared")
    expect(await page.evaluate(() => window.__shared)).toEqual({
      title: "adaptv",
      files: [{ name: "share.txt", type: "text/plain", size: 26 }],
    })
  })
})

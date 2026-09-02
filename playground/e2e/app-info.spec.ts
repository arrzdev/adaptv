import { expect, test } from "@playwright/test"

/*
 * The app naming its own build. On the web the interesting assertion is a
 * negative one: version and build must read "none", because a page has no
 * installed version and printing the JS bundle's tag there would mean the same
 * row says a different kind of thing on each target. The name and the id are
 * checked against the manifest the app actually serves, not against a literal,
 * so the test follows a consumer that renames its app.
 */
test.describe("App info", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/app-info")
    await expect(page.locator("[data-adaptv-splash]")).toHaveCount(0, {
      timeout: 20_000,
    })
  })

  test("the name and the id are the ones the served manifest carries", async ({
    page,
  }) => {
    const manifest = await page.evaluate(async () => {
      const href = document
        .querySelector('link[rel="manifest"]')
        ?.getAttribute("href")
      if (!href) return null
      const response = await fetch(href)
      return (await response.json()) as {
        name?: string
        short_name?: string
        id?: string
      }
    })
    expect(manifest).not.toBeNull()
    const name = manifest?.name ?? manifest?.short_name
    expect(name).toBeTruthy()
    await expect(page.getByTestId("app-info-name")).toHaveText(name ?? "")
    if (manifest?.id)
      await expect(page.getByTestId("app-info-id")).toHaveText(manifest.id)
  })

  test("a page has no store version and says so twice, then explains it once", async ({
    page,
  }) => {
    await expect(page.getByTestId("app-info-version")).toHaveText("none")
    await expect(page.getByTestId("app-info-build")).toHaveText("none")
    await expect(page.getByTestId("app-info-caveat")).toContainText(
      "no installed version",
    )
  })

  test("the rows resolve without a reload, and none of them is an empty string", async ({
    page,
  }) => {
    for (const id of [
      "app-info-name",
      "app-info-id",
      "app-info-version",
      "app-info-build",
    ]) {
      const text = (
        (await page.getByTestId(id).textContent()) ?? ""
      ).trim()
      expect(text.length).toBeGreaterThan(0)
    }
  })
})

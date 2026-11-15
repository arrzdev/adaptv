import { expect, test } from "@playwright/test"

//A control that swaps what is shown must say which choice is current (WCAG 4.1.2): the
//sidebar's Guides / Reference switch is a pair of toggle buttons with `aria-pressed`, not
//buttons whose state lives only in their classes. File tabs (a code panel with several
//samples) do the same; that case is unit-tested in `code.test.tsx`.
test.describe("segmented controls expose the selected choice", () => {
  test("the sidebar's Guides / Reference switch", async ({ page }) => {
    await page.goto("/docs/routing")
    await expect(page.locator("h1").first()).toBeVisible()
    const nav = page.getByRole("group", { name: "Docs section" })
    const guides = nav.getByRole("button", { name: "Guides" })
    const reference = nav.getByRole("button", { name: "Reference" })
    await expect(guides).toHaveAttribute("aria-pressed", "true")
    await expect(reference).toHaveAttribute("aria-pressed", "false")

    await reference.click()
    await expect(reference).toHaveAttribute("aria-pressed", "true")
    await expect(guides).toHaveAttribute("aria-pressed", "false")
  })

  //every docs code block holds one file: its name is a title, not a button that never
  //changes state
  test("a code sample's file name is not a button", async ({ page }) => {
    await page.goto("/docs/routing")
    await expect(page.locator("h1").first()).toBeVisible()
    await expect(page.getByText("src/routing/config.ts").first()).toBeVisible()
    await expect(
      page.getByRole("button", { name: "src/routing/config.ts" }),
    ).toHaveCount(0)
  })
})

import { expect, test } from "@playwright/test"

// Smoke self-test: the app responds, mounts content, and throws no uncaught
// errors. Minimal "is it alive" check to run headlessly against a local
// (ideally isolated) dev server — not an exhaustive user-flow suite.
test("app shell boots and mounts", async ({ page }) => {
  const pageErrors: string[] = []
  page.on("pageerror", (err) => pageErrors.push(err.message))

  const response = await page.goto("/")
  expect(response?.ok(), `navigation status: ${response?.status()}`).toBe(
    true,
  )

  // The app rendered something into the document (not a blank / error shell).
  await expect
    .poll(() => page.evaluate(() => document.body.childElementCount))
    .toBeGreaterThan(0)

  expect(pageErrors, `uncaught errors:\n${pageErrors.join("\n")}`).toEqual(
    [],
  )
})

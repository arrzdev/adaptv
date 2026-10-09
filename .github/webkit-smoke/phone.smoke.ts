import { expect, test } from "@playwright/test"

// The webkit smoke: launch, navigate, keyboard, back, in WebKit at an iPhone 15 size. The
// same steps as .github/android-smoke/smoke.sh, so both halves cover the same flow. Every
// step leaves a screenshot in SMOKE_OUT, pass or fail.
const out = process.env.SMOKE_OUT ?? "./test-results"

test("the scaffolded app launches, navigates, opens the keyboard and goes back", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`)
  })
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`))
  // A red run shows what the page looked like and said.
  let step = 0
  const shot = (name: string) =>
    page.screenshot({
      path: `${out}/${String(++step).padStart(2, "0")}-${name}.png`,
    })

  await test.step("launch", async () => {
    await page.goto("/")
    await expect(page.getByText("smoke home")).toBeVisible()
    await shot("launch")
  })

  await test.step("navigate", async () => {
    await page.getByText("open form").tap()
    await expect(page.getByText("smoke form")).toBeVisible()
    await shot("navigate")
  })

  await test.step("keyboard", async () => {
    // A tap focuses the input as a finger would; typing goes through the focused element,
    // which is what the soft keyboard feeds. WebKit on Linux draws no soft keyboard, so
    // focus plus input reaching React state is what this step can prove.
    const input = page.locator("#smoke-input")
    await input.tap()
    await expect(input).toBeFocused()
    await page.keyboard.type("adaptv")
    await expect(page.getByText("echo:adaptv")).toBeVisible()
    await shot("keyboard")
  })

  await test.step("back", async () => {
    await page.keyboard.press("Escape")
    await page.evaluate(() =>
      (document.activeElement as HTMLElement)?.blur(),
    )
    await page.goBack()
    await expect(page.getByText("smoke home")).toBeVisible()
    await shot("back")
  })

  expect(errors, "console errors").toEqual([])
})

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return
  await page.screenshot({ path: `${out}/fail.png` }).catch(() => {})
  const text = await page
    .locator("body")
    .innerText()
    .catch(() => "(no body)")
  console.log(`url: ${page.url()}\nbody: ${text}`)
})

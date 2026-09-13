import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Input & TextArea — the parts that are decidable without a real keyboard.
 *
 * This is a DESKTOP context on purpose (no hasTouch): `onSubmitKey` fires on Enter
 * only on non-touch devices, and here we drive the physical Enter. The keyboard
 * HEIGHT, the data-keyboard-open flag and the iOS caret-repaint patch all need a
 * real on-screen keyboard and are a sim/device walk — this file pins the rest:
 * the submit key firing exactly once, the slots, autoResize's cap, and disabled.
 *
 * No touch, no CDP — plain Playwright typing. Deterministic once it waits for the
 * client to take over; see `awaitClientHandover` for why the wait below is not it.
 */

//The "DESKTOP context" above was a claim, not a setting — and the webkit project is
//an iPhone profile, so it ran this file WITH touch. `onSubmitKey` is deliberately
//gated on `!isTouchDevice()` (a soft keyboard's Enter is a newline, not a submit),
//so the engine correctly did nothing and the test read it as the handler never
//firing: a hard webkit failure on every run, from a suppression working as designed.
//Pin the context the file says it needs instead of asserting against a device that
//can never satisfy it.
test.use({ hasTouch: false, isMobile: false })

const LOG = "[data-lab-log] li"
const logTexts = (page: Page) => page.locator(LOG).allInnerTexts()

/*
 * Without the hydration gate (`awaitClientHandover`, e2e/support/hydrated.ts) a
 * keypress reaches an input React is not listening to yet: `onSubmitKey` never runs
 * and the log stays empty, so the count reads 0 where 1 was expected — which looks
 * like the handler being broken, or like a double-fire guard eating the event.
 */

test.describe("Input & TextArea (no keyboard needed)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/fields")
    await awaitClientHandover(page)
    await page.getByRole("searchbox", { name: "Search field" }).waitFor()
  })

  test("the submit key fires exactly once on Enter — never while typing", async ({
    page,
  }) => {
    const search = page.getByRole("searchbox", { name: "Search field" })
    await search.click()
    await search.pressSequentially("hello", { delay: 10 })

    // typing must NOT submit
    expect(
      (await logTexts(page)).filter((t) => /onSubmitKey/.test(t)).length,
      "typing must not fire the submit key",
    ).toBe(0)

    await search.press("Enter")
    await expect
      .poll(
        async () =>
          (await logTexts(page)).filter((t) => /onSubmitKey/.test(t))
            .length,
        { message: "Enter fires it exactly once", timeout: 2000 },
      )
      .toBe(1)
    expect((await logTexts(page))[0]).toContain('onSubmitKey("hello")')

    // a second Enter fires it again (once more), not twice
    await search.press("Enter")
    await expect
      .poll(
        async () =>
          (await logTexts(page)).filter((t) => /onSubmitKey/.test(t))
            .length,
        { timeout: 2000 },
      )
      .toBe(2)
  })

  test("the trailing clear slot appears only with text and clears the field", async ({
    page,
  }) => {
    const search = page.getByRole("searchbox", { name: "Search field" })
    const clear = page.getByRole("button", {
      name: "Clear the search field",
    })

    await expect(clear, "no clear button when empty").toBeHidden()
    await search.click()
    await search.pressSequentially("adaptv", { delay: 20 })
    await expect(search).toHaveValue("adaptv")
    await expect(clear, "clear button appears with text").toBeVisible()

    await clear.click()
    await expect(search).toHaveValue("")
    await expect(clear, "clear button gone once empty again").toBeHidden()
  })

  test("autoResize grows with lines, then caps at maxRows and scrolls", async ({
    page,
  }) => {
    const area = page.getByRole("textbox", {
      name: "Auto-resizing text area",
    })
    const h = () => area.evaluate((el) => (el as HTMLElement).clientHeight)
    const scrollH = () =>
      area.evaluate((el) => (el as HTMLElement).scrollHeight)

    await area.fill("one\ntwo")
    await page.waitForTimeout(120)
    const twoLines = await h()

    await area.fill("one\ntwo\nthree\nfour")
    // autoResize recomputes on a frame after the input event — poll for the grow
    await expect
      .poll(() => h(), {
        message: "it must grow as lines are added",
        timeout: 2000,
      })
      .toBeGreaterThan(twoLines)
    const fourLines = await h()

    // well past maxRows (5)
    await area.fill(
      Array.from({ length: 14 }, (_, i) => `line ${i}`).join("\n"),
    )
    await page.waitForTimeout(120)
    const manyLines = await h()
    // capped: 14 lines is not ~3.5× the 4-line height — it plateaus near 5 rows
    expect(
      manyLines,
      "it must STOP growing at maxRows, not track the content",
    ).toBeLessThan(fourLines * 2)
    expect(
      (await scrollH()) - manyLines,
      "and past the cap the content scrolls inside it",
    ).toBeGreaterThan(20)
  })

  test("a disabled field cannot be edited", async ({ page }) => {
    const disabled = page.getByRole("textbox", { name: "Disabled field" })
    await expect(disabled).toBeDisabled()
    await expect(disabled).toHaveValue("cannot be edited")
  })

  test("the plain wrapper is controlled — typing updates its value", async ({
    page,
  }) => {
    const field = page.getByRole("textbox", { name: "Plain text field" })
    await field.pressSequentially("controlled", { delay: 10 })
    await expect(field).toHaveValue("controlled")
  })
})

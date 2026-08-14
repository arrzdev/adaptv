import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * Text — a run of text with the three platform quirks a <p> does not get. Two of
 * them are assertable in a headless browser (the third, iOS Dynamic Type, needs a
 * real device and the OS text-size slider, so it lives on the page as a live number
 * instead):
 *
 *   - the line clamp: an INLINE style the component writes, so it is deterministic
 *     regardless of the engine's computed-style quirks — and the box grows/shrinks
 *     by whole lines, which is engine-agnostic;
 *   - the `selectable` opt-in and the `data-scale-with-system` presence marker;
 *   - `render` as a prop: it produces a REAL element (an <h3>, a <label>), not a
 *     wrapper — and a rendered <label> still focuses its control.
 */

/**
 * Wait for the client to take over before pressing anything.
 *
 * The paragraph and the clamp buttons are all server-rendered, so the
 * `waitFor()` below is satisfied by inert HTML: a click fired in that window
 * lands on a button whose handler is not attached yet, `numberOfLines` never
 * changes, and the assertion reads the page's default clamp ("2") instead of
 * the "1" it just asked for. It is not load flake — Playwright boots its own
 * dev server and tears it down per run, so the FIRST test to reach this
 * route pays the cold transform cost and loses the race while every test
 * after it wins. A dev session left running hides it entirely, because
 * `reuseExistingServer` then hands the suite a warm server. Only the one
 * test here that presses a button was ever affected; the other three assert
 * on markup the server already emitted.
 *
 * The splash is server-rendered too and self-unmounts only once the client
 * has hydrated and the local store has seeded, so its disappearance is the
 * one honest "React is driving now" signal on the page. Given a generous
 * timeout on purpose — the case it exists for is a cold server, where the
 * route's first transform can take longer than the 5s default.
 */
async function awaitClientHandover(page: Page) {
  await expect(page.locator("[data-adaptv-splash]")).toHaveCount(0, {
    timeout: 20_000,
  })
}

test.describe("Text", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/text")
    await awaitClientHandover(page)
    await page.locator('p[data-adaptv="text"]').first().waitFor()
  })

  test("numberOfLines clamps and grows by whole lines", async ({
    page,
  }) => {
    const p = page.locator('p[data-adaptv="text"]').first()
    // the inline style the component writes — not the computed value, so it reads
    // the same on every engine. `0`/none removes it entirely.
    const clamp = () =>
      p.evaluate((el) => (el as HTMLElement).style.webkitLineClamp)
    const height = () => p.evaluate((el) => el.clientHeight)

    await page.getByRole("button", { name: "1 line" }).click()
    expect(await clamp()).toBe("1")
    const oneLine = await height()

    await page.getByRole("button", { name: "2 lines" }).click()
    expect(await clamp()).toBe("2")
    const twoLines = await height()

    await page.getByRole("button", { name: "3 lines" }).click()
    expect(await clamp()).toBe("3")
    const threeLines = await height()

    await page.getByRole("button", { name: "none" }).click()
    expect(await clamp()).toBe("") // no clamp → no inline property at all
    const unclamped = await height()

    expect(oneLine).toBeLessThan(twoLines)
    expect(twoLines).toBeLessThan(threeLines)
    expect(threeLines).toBeLessThan(unclamped)
  })

  test("selectable text is not caught by the no-select reset", async ({
    page,
  }) => {
    const selectable = page.getByText(/must select on every target/)
    // the `selectable` utility forces user-select back on; on a browser tab the
    // app-wide reset is not even installed, so the weakest true claim is "not none"
    expect(
      await selectable.evaluate(
        (el) => getComputedStyle(el).webkitUserSelect,
      ),
    ).not.toBe("none")
  })

  test("data-scale-with-system marks the opt-in and is absent by default", async ({
    page,
  }) => {
    // opt-in default is off: the plain row carries no attribute at all
    const plain = page.getByText(/always its built size/)
    expect(await plain.getAttribute("data-scale-with-system")).toBeNull()

    // a presence marker: the opt-in ADDS it as an empty string
    const opted = page.getByText(/the same size/)
    await expect(opted).toHaveAttribute("data-scale-with-system", "")
  })

  test("render produces a real element, and a rendered label focuses its control", async ({
    page,
  }) => {
    // render={<h3 />} → an actual <h3>, still tagged as a Text
    await expect(page.locator('h3[data-adaptv="text"]')).toHaveCount(1)

    const label = page.locator('label[for="lab-text-field"]')
    await expect(label).toHaveAttribute("data-adaptv", "text")
    await label.click()
    await expect(page.locator("#lab-text-field")).toBeFocused()
  })
})

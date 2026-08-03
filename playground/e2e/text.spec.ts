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
 *   - the `selectable` opt-in and the `data-dynamic-type` presence attribute;
 *   - `render` as a prop: it produces a REAL element (an <h3>, a <label>), not a
 *     wrapper — and a rendered <label> still focuses its control.
 */

test.describe.configure({ retries: 2 })

test.describe("Text", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/text")
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

  test("data-dynamic-type is present by default and removed by the opt-out", async ({
    page,
  }) => {
    const unsized = page.getByText(/this is the one that can follow/)
    await expect(unsized).toHaveAttribute("data-dynamic-type", "")

    const opted = page.getByText(/opted out/)
    // a presence attribute: the opt-out REMOVES it rather than setting "false"
    expect(await opted.getAttribute("data-dynamic-type")).toBeNull()
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

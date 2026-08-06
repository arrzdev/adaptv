import { expect, test } from "@playwright/test"

/*
 * active: — adaptv redefines the built-in `active:` variant so one class string
 * (`active:scale-95 active:bg-primary/20`) reaches BOTH the engine element (via
 * `&[data-pressed]`) and a plain <button> (via `&:active:not([data-press-engine])`).
 *
 * The engine WRITING data-pressed on a real press, and native :active on a real
 * finger, are gesture/UA behaviour the page itself calls un-scriptable (there is no
 * "simulate" button) — those are the press-visual CDP spec, the unit-pinned timers,
 * and the sim. What IS assertable headlessly is the piece this page is really about:
 * the marker wiring, and that the variant's ENGINE branch actually compiles — stamp
 * data-pressed by hand and the styles must land, or the engine button would animate
 * for no one even with a perfectly working engine.
 */

test.describe.configure({ retries: 2 })

const ENGINE = "hold me, drag off, drag back"
const PLAIN = /a plain .*button.*, same class string/

test.describe("active: variant", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/press-states")
  })

  test("the engine Button carries the marker; the plain button does not", async ({
    page,
  }) => {
    // the marker is what routes active: to [data-pressed] instead of :active
    await expect(
      page.getByRole("button", { name: ENGINE }),
    ).toHaveAttribute("data-press-engine", "")
    expect(
      await page
        .getByRole("button", { name: PLAIN })
        .getAttribute("data-press-engine"),
    ).toBeNull()
  })

  test("active: reaches the engine's [data-pressed] branch", async ({
    page,
  }) => {
    const button = page.getByRole("button", { name: ENGINE })
    const bg = () =>
      button.evaluate((el) => getComputedStyle(el).backgroundColor)

    const atRest = await bg()

    // stamp what the engine writes on a press — active:bg-primary/20 must apply
    await button.evaluate((el) => el.setAttribute("data-pressed", ""))
    await expect.poll(bg).not.toBe(atRest)

    // and it must be cleanly clearable (native :active cannot be — the whole point)
    await button.evaluate((el) => el.removeAttribute("data-pressed"))
    await expect.poll(bg).toBe(atRest)
  })
})

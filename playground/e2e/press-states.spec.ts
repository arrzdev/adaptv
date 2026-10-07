import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

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

const ENGINE = "hold me, drag off, drag back"
const PLAIN = /a plain .*button.*, same class string/

test.describe("active: variant", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/press-states")
    await awaitClientHandover(page)
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

  test("active: reaches the engine's [data-pressed] branch @tailwind", async ({
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

  test("a key press inside the pressed floor never strands the visual", async ({
    page,
  }) => {
    // a pointer press that painted and was released early leaves its hide
    // pending for the 150ms floor; Enter on the same control resets the engine
    // inside that window, and the flag must still leave. Mouse, not touch: the
    // engine treats them alike, and both projects can drive it.
    const button = page.getByRole("button", { name: ENGINE })
    await button.scrollIntoViewIfNeeded()
    const box = await button.boundingBox()
    if (!box) throw new Error("the engine button has no box")
    // the premise, read the instant the key arrives: painted and focused
    await button.evaluate((el) => {
      const w = window as unknown as { __atKey?: unknown }
      window.addEventListener(
        "keydown",
        () => {
          w.__atKey = {
            pressed: el.hasAttribute("data-pressed"),
            focused: document.activeElement === el,
          }
        },
        { capture: true, once: true },
      )
    })
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await button.evaluate(
      (el) =>
        new Promise<void>((resolve) => {
          const tick = () =>
            el.hasAttribute("data-pressed")
              ? resolve()
              : requestAnimationFrame(tick)
          tick()
        }),
    )
    await page.mouse.up()
    // WebKit blurs even a focused button on mousedown: focus after the release
    await button.focus()
    await page.keyboard.press("Enter")
    const atKey = await page.evaluate(
      () => (window as unknown as { __atKey?: unknown }).__atKey,
    )
    expect(
      atKey,
      "Enter must land inside the floor, on the focused button",
    ).toEqual({ pressed: true, focused: true })
    await expect(button).not.toHaveAttribute("data-pressed")
  })
})

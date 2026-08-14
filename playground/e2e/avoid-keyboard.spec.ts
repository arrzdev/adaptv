import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * AvoidKeyboard — a desktop browser has no on-screen keyboard, so the ONLY way to
 * exercise this headlessly is adaptv's keyboard test seam: set
 * `window.__adaptvKeyboardMock` (installed before the hook mounts) and dispatch
 * `adaptv:keyboard-mock`, and every useKeyboard consumer reports the mock and
 * nothing else. That lets a scripted raise/dismiss drive the whole thing frame by
 * frame — the same seam the drawer's keyboard harness uses.
 *
 * What is asserted: the publication contract (the `--adaptv-keyboard-height`
 * variable and the `data-keyboard-open` flag on <html> track the mock and collapse
 * on dismiss), and that the wrapper actually RESERVES room on the chosen axis while
 * the keyboard covers it and gives it back when it lifts. The exact pixel amount is
 * geometry (overlap of this element's bottom with the keyboard), which is the pure
 * unit-tested math and a device concern — here we prove the wiring, with a keyboard
 * tall enough that the overlap is unambiguously positive.
 */

const KEYBOARD_EVENT = "adaptv:keyboard-mock"

async function setKeyboard(page: Page, isOpen: boolean, height: number) {
  await page.evaluate(
    ({ o, h, evt }) => {
      ;(
        window as unknown as { __adaptvKeyboardMock?: unknown }
      ).__adaptvKeyboardMock = { isOpen: o, height: h }
      window.dispatchEvent(new Event(evt))
    },
    { o: isOpen, h: height, evt: KEYBOARD_EVENT },
  )
}

const rootHeightVar = (page: Page) =>
  page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--adaptv-keyboard-height")
      .trim(),
  )
const rootKeyboardOpen = (page: Page) =>
  page.evaluate(() =>
    document.documentElement.hasAttribute("data-keyboard-open"),
  )

/**
 * Wait for the client to take over before touching the page.
 *
 * The whole lab page is server-rendered, so the `waitFor()` below is
 * satisfied by inert HTML. That matters for exactly one control here: the
 * `behavior:` toggle. A click fired before its handler is attached leaves
 * the wrapper on `padding`, so the reservation lands where the test says it
 * must not and `marginBottom` reads 0 — which looks like the component
 * ignoring its own prop. (The other two tests survive without this because
 * `setKeyboard` only dispatches an event and they poll for the result, so a
 * late hydration still converges.) It is not load flake: Playwright boots
 * its own dev server and tears it down per run, so the FIRST test to reach
 * this route pays the cold transform cost and loses the race while every
 * test after it wins. A dev session left running hides it entirely, because
 * `reuseExistingServer` then hands the suite a warm server.
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

test.describe("AvoidKeyboard driven by the keyboard seam", () => {
  test.beforeEach(async ({ page }) => {
    // install the mock BEFORE the hook's effect runs, or it never enters mock mode
    await page.addInitScript(() => {
      ;(
        window as unknown as { __adaptvKeyboardMock?: unknown }
      ).__adaptvKeyboardMock = { isOpen: false, height: 0 }
    })
    await page.goto("/lab/avoid-keyboard")
    await awaitClientHandover(page)
    await page.getByLabel("Field one").waitFor()
  })

  test("publishes the height variable and the open flag, and collapses on dismiss", async ({
    page,
  }) => {
    // at rest: the variable is defined (0px) and the flag is absent
    expect(await rootHeightVar(page)).toBe("0px")
    expect(await rootKeyboardOpen(page)).toBe(false)

    await setKeyboard(page, true, 320)
    await expect.poll(() => rootHeightVar(page)).toBe("320px")
    expect(await rootKeyboardOpen(page)).toBe(true)

    await setKeyboard(page, false, 0)
    await expect.poll(() => rootHeightVar(page)).toBe("0px")
    expect(await rootKeyboardOpen(page)).toBe(false)
  })

  test("reserves room on padding while the keyboard covers it, then gives it back", async ({
    page,
  }) => {
    const box = page
      .locator("div.h-72")
      .filter({ has: page.getByLabel("Field one") })
    await box.scrollIntoViewIfNeeded()
    const padBottom = () =>
      box.evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))

    const atRest = await padBottom()

    // a keyboard tall enough that this element's bottom is unambiguously overlapped
    await setKeyboard(page, true, 700)
    await expect.poll(padBottom).toBeGreaterThan(atRest + 100)

    await setKeyboard(page, false, 0)
    await expect.poll(padBottom).toBeCloseTo(atRest, 0)
  })

  test("behavior='margin' reserves on the margin, leaving padding alone", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /behavior:/ }).click() // padding → margin

    const box = page
      .locator("div.h-72")
      .filter({ has: page.getByLabel("Field one") })
    await box.scrollIntoViewIfNeeded()

    await setKeyboard(page, true, 700)

    const margin = await box.evaluate((el) =>
      parseFloat(getComputedStyle(el).marginBottom),
    )
    const padding = await box.evaluate((el) =>
      parseFloat(getComputedStyle(el).paddingBottom),
    )
    expect(margin, "reservation lands on the margin").toBeGreaterThan(100)
    expect(
      padding,
      "padding stays the element's own p-3, not the reservation",
    ).toBeLessThan(40)
  })
})

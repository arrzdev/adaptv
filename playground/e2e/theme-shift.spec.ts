import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * A Switch's thumb does not shift the page it sits on. The thumb used to travel
 * on `left`: a 20px layout shift per flip (3.1e-5 at 1280x720), which counted
 * toward CLS whenever no input was behind it — an OS appearance flip under the
 * "system" preference. It travels on `transform` now.
 *
 * ⚠︎ This file used to drive a "Dark mode" switch on /settings, which followed
 * the OS directly, so an appearance flip moved the thumb with no input behind
 * it — the exact CLS the fix was for. #261 replaced that switch with a Theme
 * segmented control (light/dark/system as pressed buttons), and no switch on
 * the page tracks the OS any more. The spec was not updated with it and every
 * test here has failed since, unnoticed because CI has been down on a billing
 * block. The guard is rebuilt below on the two halves that still exist:
 *
 *   1. the OS flip still repaints the page under "system" with no input, so
 *      nothing inside a switch may shift as its colours change;
 *   2. the thumb's own travel is driven by a keypress instead. A shift with
 *      `hadRecentInput` is still RECORDED by the observer (it is only excluded
 *      from the CLS score), so a thumb back on `left` fails this just as loudly
 *      as it failed the old flip.
 *
 * Chromium reported no no-input shift on a page that had seen no input yet, so a
 * click comes first and the flips start past the 500ms input window; a forced
 * shift at the end proves the observer was live. WebKit has no Layout
 * Instability API, so only the geometry test runs there.
 */

type Shift = { value: number; hadRecentInput: boolean; inSwitch: boolean }
type ShiftWindow = Window & { __shifts: Shift[] }

/** Any Switch on /settings will do — this one is first and always present. */
const animations = (page: Page) =>
  page.getByRole("switch", { name: "Animations", exact: true })

/** The resolved theme the init script writes onto the root element. */
const resolved = (page: Page) =>
  page.evaluate(() =>
    document.documentElement.classList.contains("dark") ? "dark" : "light",
  )

/** Two frames for the shift to be recorded, then a task for the callback. */
const takeShifts = (page: Page) =>
  page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(r))
    await frame()
    await frame()
    await new Promise((r) => setTimeout(r, 50))
    return (window as unknown as ShiftWindow).__shifts.splice(0)
  })

const observeShifts = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as ShiftWindow
    w.__shifts = []
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as (Shift & {
        sources: { node: Element | null }[]
      })[])
        w.__shifts.push({
          value: e.value,
          hadRecentInput: e.hadRecentInput,
          inSwitch: e.sources.some(
            (s) => !!s.node?.closest?.('[data-adaptv="switch"]'),
          ),
        })
    }).observe({ type: "layout-shift" })
  })

/** Proves the observer was live, so a zero above means something. */
const forceAShift = async (page: Page) => {
  await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(r))
    const box = document.createElement("div")
    box.style.cssText =
      "position:absolute;top:100px;width:120px;height:120px;background:red"
    document.body.append(box)
    await frame()
    await frame()
    box.style.top = "300px"
    await frame()
    await frame()
    box.remove()
  })
  expect(
    (await takeShifts(page)).length,
    "the forced shift was not observed, so the zero above proves nothing",
  ).toBeGreaterThan(0)
}

test("an OS appearance flip does not shift the settings page's switches", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "only Chromium has layout-shift")
  await page.addInitScript(() =>
    localStorage.setItem("ui-theme-preference", "system"),
  )
  await page.emulateMedia({ colorScheme: "light" })
  await page.goto("/settings")
  await awaitClientHandover(page)
  await expect(animations(page)).toBeVisible()
  expect(await resolved(page), "premise: the app starts light").toBe(
    "light",
  )
  await observeShifts(page)

  await page.getByRole("heading", { name: "Preferences" }).click()
  await page.waitForTimeout(600)
  for (const scheme of ["dark", "light", "dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    //the premise of the flip: the app really followed the OS. Under "system"
    //the theme is resolved from the media query, so this is the whole reason
    //the page repaints at all
    await expect
      .poll(() => resolved(page), {
        message: "premise: the app must follow the OS under system",
        timeout: 2000,
      })
      .toBe(scheme)
    await page.waitForTimeout(100)
  }
  //scoped to the switches, so an unrelated box on /settings cannot fail this
  const shifts = await takeShifts(page)
  expect(
    shifts.filter((s) => s.inSwitch),
    JSON.stringify(shifts),
  ).toEqual([])

  await forceAShift(page)
})

test("the thumb's own travel is not a layout shift", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "only Chromium has layout-shift")
  await page.goto("/settings")
  await awaitClientHandover(page)
  const sw = animations(page)
  await expect(sw).toBeVisible()
  const wasOn = await sw.isChecked()
  await observeShifts(page)

  //four flips, so the thumb crosses in both directions more than once. A shift
  //carrying hadRecentInput is still recorded — only its CLS score is waived —
  //so a thumb travelling on `left` lands in __shifts here
  await sw.focus()
  for (let i = 1; i <= 4; i += 1) {
    await page.keyboard.press("Space")
    await expect(sw).toBeChecked({ checked: i % 2 === 1 ? !wasOn : wasOn })
    await page.waitForTimeout(100)
  }
  const shifts = await takeShifts(page)
  expect(
    shifts.filter((s) => s.inSwitch),
    JSON.stringify(shifts),
  ).toEqual([])

  await forceAShift(page)
})

for (const [label, device] of [
  ["desktop", {}],
  //portrait: a landscape touch context raises the playground's rotate guard
  ["touch", { hasTouch: true, viewport: { width: 390, height: 844 } }],
] as const) {
  test.describe(label, () => {
    test.use(device)
    test("the thumb lands evenly inset on both sides", async ({
      page,
    }) => {
      await page.goto("/settings")
      await awaitClientHandover(page)
      const sw = animations(page)
      await expect(sw).toBeVisible()
      //`transform` composes with the locked `-translate-y-1/2`: pin the paint
      const insets = () =>
        page
          .locator('[data-adaptv="switch"]', { has: sw })
          .evaluate((t) => {
            const a = t.getBoundingClientRect()
            const thumb = t.querySelector("span[aria-hidden]") as Element
            const b = thumb.getBoundingClientRect()
            const [l, r] = [b.left - a.left, a.right - b.right]
            return { l, r, t: b.top - a.top, b: a.bottom - b.bottom }
          })
      const wasOn = await sw.isChecked()
      const first = await insets()
      await sw.focus()
      await page.keyboard.press("Space")
      await expect(sw).toBeChecked({ checked: !wasOn })
      const second = await insets()
      const [off, on] = wasOn ? [second, first] : [first, second]
      expect(off.l, "OFF: the gap is on the left").toBeCloseTo(off.t, 1)
      expect(on.r, "ON: the same gap on the right").toBeCloseTo(off.l, 1)
      for (const g of [off, on]) expect(g.t, "centred").toBeCloseTo(g.b, 1)
    })
  })
}

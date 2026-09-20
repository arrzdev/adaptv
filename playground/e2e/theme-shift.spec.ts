import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * A theme flip does not shift the settings page's Dark mode switch. The thumb
 * used to travel on `left`: a 20px layout shift per flip (3.1e-5 at 1280x720),
 * which counted toward CLS whenever no input was behind it — an OS appearance
 * flip under the "system" preference. It travels on `transform` now.
 *
 * Chromium reported no no-input shift on a page that had seen no input yet, so a
 * click comes first and the flips start past the 500ms input window; a forced
 * shift at the end proves the observer was live. WebKit has no Layout
 * Instability API, so only the geometry test runs there.
 */

type Shift = { value: number; hadRecentInput: boolean; inSwitch: boolean }
type ShiftWindow = Window & { __shifts: Shift[] }

const darkMode = (page: Page) =>
  page.getByRole("switch", { name: "Dark mode", exact: true })

/** Two frames for the shift to be recorded, then a task for the callback. */
const takeShifts = (page: Page) =>
  page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(r))
    await frame()
    await frame()
    await new Promise((r) => setTimeout(r, 50))
    return (window as unknown as ShiftWindow).__shifts.splice(0)
  })

test("an OS appearance flip does not shift the Dark mode switch", async ({
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
  await expect(darkMode(page)).not.toBeChecked()
  await page.evaluate(() => {
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

  await page.getByRole("heading", { name: "Preferences" }).click()
  await page.waitForTimeout(600)
  for (const scheme of ["dark", "light", "dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    //the premise of the flip: the switch really followed the OS
    await expect(darkMode(page)).toBeChecked({
      checked: scheme === "dark",
    })
    await page.waitForTimeout(100)
  }
  //scoped to the switch, so an unrelated box on /settings cannot fail this file
  const shifts = await takeShifts(page)
  expect(
    shifts.filter((s) => s.inSwitch),
    JSON.stringify(shifts),
  ).toEqual([])

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
    (await takeShifts(page)).filter((s) => !s.hadRecentInput),
    "the forced shift was not observed, so the zero above proves nothing",
  ).toHaveLength(1)
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
      const sw = darkMode(page)
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

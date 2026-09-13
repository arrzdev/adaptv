import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

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
//the lab's notice height (ARRIVAL_PX in avoid-keyboard.page.tsx)
const ARRIVAL_PX = 100

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

/*
 * The hydration gate (`awaitClientHandover`, e2e/support/hydrated.ts) matters for
 * exactly one control here: the `behavior:` toggle. A click fired before its handler
 * is attached leaves the wrapper on `padding`, so the reservation lands where the
 * test says it must not and `marginBottom` reads 0 — which looks like the component
 * ignoring its own prop. (The other two tests survive without it because
 * `setKeyboard` only dispatches an event and they poll for the result, so a late
 * hydration still converges.)
 */

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

/*
 * Content arriving above a focused field while the aim's smooth scroll is flying.
 *
 * The aim picks an absolute scrollTop on the focus frame; a notice inserted during
 * the 200-450ms flight moves the field down and leaves the destination where it
 * was, so the field lands 100px short, under the box's bottom edge. Measured on
 * origin/main on both engines: landed 520, clearance -76 (24 with no insertion).
 * The fix looks once more when that scroll ends.
 *
 * The lab's Run button drives it, so a device run is the same code path: it
 * focuses the field with `preventScroll` (the browser's own scroll-into-view would
 * otherwise travel first), counts the frames on which the scroller has moved, and
 * on the third inserts the notice with `flushSync`, then waits for 30 still frames.
 *
 * Both Playwright engines have `scrollend`, and adaptv's iOS floor does not, so the
 * test runs twice: once as shipped, and once with every `onscrollend` handler
 * property deleted before the page loads, which is exactly what the hook probes and
 * sends it down the quiet-window fallback.
 *
 * A portrait phone viewport: the geometry the numbers above were measured in. No
 * touch here, so the rotate guard is not in play, but the chromium project's
 * 1280x720 is not a phone.
 */
test.describe("AvoidKeyboard re-aims when content lands above the field mid-scroll", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  for (const mode of ["scrollend", "no scrollend"] as const) {
    test(`${mode}: a 100px notice inserted on frame 3 of the scroll still leaves the field clear`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript(() => {
        ;(
          window as unknown as { __adaptvKeyboardMock?: unknown }
        ).__adaptvKeyboardMock = { isOpen: false, height: 0 }
      })
      if (mode === "no scrollend") {
        await page.addInitScript(() => {
          for (const proto of [
            Window.prototype,
            Document.prototype,
            HTMLElement.prototype,
            Element.prototype,
          ]) {
            delete (proto as { onscrollend?: unknown }).onscrollend
          }
          delete (window as { onscrollend?: unknown }).onscrollend
        })
      }
      await page.goto("/lab/avoid-keyboard")
      await awaitClientHandover(page)

      const scrollEnd = await page.evaluate(() => "onscrollend" in window)
      expect(scrollEnd, "the mode's premise").toBe(mode === "scrollend")

      const box = page.locator("[data-lab-arrival-scroller]")
      //the whole box on screen, so its bottom (not the viewport's) is the line
      await box.evaluate((el) => el.scrollIntoView({ block: "center" }))

      await page
        .getByRole("button", { name: "Run: focus, insert mid-scroll" })
        .click()
      const readout = page.locator("[data-lab-arrival-clearance]")
      await readout.waitFor({ timeout: 15_000 })

      const clearance = Number(
        await readout.getAttribute("data-lab-arrival-clearance"),
      )
      const scroll = await page
        .locator("[data-lab-arrival-scroll]")
        .textContent()
      console.log(
        `ARRIVAL ${testInfo.project.name} ${mode} clearance=${clearance} ${scroll}`,
      )

      //the premise: the notice went in while the FIRST aim's scroll was still short of its
      //destination. That destination is where the field would have landed with no notice,
      //which is the landing minus the notice. Comparing against the landing itself is
      //vacuous: an instant first aim reads "inserted at 520", and the re-aim still moves
      //the landing on to 620.
      const match = /inserted at (\d+(?:\.\d+)?) · landed (\d+)/.exec(
        scroll ?? "",
      )
      expect(
        match,
        `the insertion happened mid-scroll: ${scroll}`,
      ).not.toBeNull()
      const insertedAt = Number(match?.[1])
      const firstDestination = Number(match?.[2]) - ARRIVAL_PX
      expect(insertedAt).toBeGreaterThan(0)
      expect(
        insertedAt,
        "the notice went in before the first scroll reached its destination",
      ).toBeLessThan(firstDestination - 1)
      await expect(page.locator("[data-lab-arrival-notice]")).toHaveCount(
        1,
      )
      await expect(page.getByLabel("Arrival field")).toBeFocused()

      expect(
        clearance,
        "the field's bottom sits at or above the box's bottom once the scroll stops",
      ).toBeGreaterThanOrEqual(0)
    })
  }
})

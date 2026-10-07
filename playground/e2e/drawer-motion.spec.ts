import type { CDPSession, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The sheet's MOTION contract.
 *
 * Why it exists: the layer that moves the panel was replaced (it used to measure a pixel target,
 * arm an inline transition and write the transform from a MotionValue; it now hands two endpoints
 * to a `@keyframes` rule), with the gesture engine, the keyboard system and the scroll
 * arbitration deliberately untouched. "Deliberately untouched" is a claim, and before this file
 * the drawer's behaviours were guarded by COMMENTS — there were 30 e2e specs in this suite and
 * not one of them drove a drawer.
 *
 * So each test here is one behaviour that was found and fixed on a device, written down as a
 * thing that can fail. They are deliberately about what a user can SEE — where the sheet lands,
 * whether it moved, whether it came back — and not about how it got there, so that the next
 * person to change the mechanism gets told when they break one. That is not hypothetical: the
 * "reopening mid-close" test below is what caught the replacement stripping a re-aimed animation
 * mid-flight, which the unit suite could not see.
 *
 * ⚠︎ chromium-only (CDP touch). The touch path is a different code path from the mouse handle
 * drag, and it is the one that ships.
 */

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })
test.describe.configure({ mode: "serial" })

const BUTTON = "Open basic drawer"
//the panel also carries the hidden tail, so the visible sheet is its first child
const PANEL = "[data-pwa-drawer]"
const OVERLAY = "[data-pwa-drawer-overlay]"
const SHEET = `${PANEL} > *:first-child`

const REST_TOLERANCE_PX = 2

async function touchDrag(
  cdp: CDPSession,
  from: { x: number; y: number },
  dy: number,
  steps = 16,
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [from],
  })
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x, y: from.y + (dy * step) / steps }],
    })
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  })
}

/** {@link touchDrag}, sampling the panel's translate after every move so the drag can be judged
 *  while it is happening rather than only where it ended up. */
async function touchDragSampled(
  page: Page,
  cdp: CDPSession,
  from: { x: number; y: number },
  dy: number,
  steps = 16,
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [from],
  })
  const samples: number[] = []
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x, y: from.y + (dy * step) / steps }],
    })
    samples.push((await readTranslateY(page, PANEL)) ?? Number.NaN)
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  })
  return samples
}

/** The sheet's on-screen box. Read from the visible child rather than the panel, so the test
 *  says the same thing whether or not the hidden tail is a real element. */
function readSheet(page: Page, SHEET: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return {
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      viewport: window.innerHeight,
    }
  }, SHEET)
}

/** How far the panel is translated from its resting position, in px. */
function readTranslateY(page: Page, PANEL: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const t = getComputedStyle(el).transform
    if (!t || t === "none") return 0
    return new DOMMatrixReadOnly(t).m42
  }, PANEL)
}

/** {@link readSheet}, but the sheet has to be there — every caller has just opened it, and a
 *  null here is the test failing for the right reason rather than an arithmetic NaN. */
async function sheetBox(page: Page, SHEET: string) {
  const box = await readSheet(page, SHEET)
  if (!box) throw new Error("the sheet is not on screen")
  return box
}

async function openSheet(page: Page, button: string, PANEL: string) {
  await page.getByRole("button", { name: button }).first().click()
  await page.locator(PANEL).waitFor({ state: "attached" })
  //the sheet is settled once it stops moving, not after a fixed guess
  await expect
    .poll(
      async () => Math.round((await readTranslateY(page, PANEL)) ?? -1),
      {
        timeout: 4000,
      },
    )
    .toBe(0)
}

test.describe("the sheet's motion", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "needs CDP touch injection — synthetic events do not drive the native touch path",
  )

  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/drawer")
    await awaitClientHandover(page)
    await page.getByRole("button", { name: BUTTON }).first().waitFor()
  })

  test("lands flush with the bottom edge, with no gap under it", async ({
    page,
  }) => {
    await openSheet(page, BUTTON, PANEL)
    const sheet = await sheetBox(page, SHEET)
    //the invariant a hidden tail is INVISIBLE: whatever the panel box does below the fold, the
    //sheet a user sees ends exactly at the bottom edge. A gap here is the sheet floating.
    expect(Math.abs(sheet.bottom - sheet.viewport)).toBeLessThanOrEqual(
      REST_TOLERANCE_PX,
    )
    expect(sheet.top).toBeGreaterThan(0)
  })

  test("does not move when dragged UP", async ({ page }) => {
    await openSheet(page, BUTTON, PANEL)
    const sheet = await sheetBox(page, SHEET)
    const cdp = await page.context().newCDPSession(page)

    await touchDrag(cdp, { x: 195, y: sheet.top + 40 }, -160)
    await page.waitForTimeout(500)

    //an upward pull is rubber-banded, not free: it gives a little and comes back to rest on
    //release. A sheet that stayed up would expose whatever backs it and take the content off
    //the top of the screen.
    expect(Math.round((await readTranslateY(page, PANEL)) ?? -1)).toBe(0)
    const after = await sheetBox(page, SHEET)
    expect(Math.abs(after.top - sheet.top)).toBeLessThanOrEqual(
      REST_TOLERANCE_PX,
    )
  })

  test("never lurches DOWN while being pulled up", async ({ page }) => {
    /*
     * Reported as a shake at the start of an upward drag, and it was one: the resistance curve
     * (vaul's `dampenValue`) is negative for its first 6.4px and returns -16 at zero, while the
     * drag rebases its origin at the takeover — so every upward pull opened by throwing the sheet
     * 16px DOWN and then walking it back up through zero.
     *
     * The unit test pins the curve. This pins what a finger actually gets, which is the thing that
     * was wrong: sample every move of the drag and require the sheet to be at or above rest the
     * whole way, never below it.
     */
    await openSheet(page, BUTTON, PANEL)
    const sheet = await sheetBox(page, SHEET)
    const cdp = await page.context().newCDPSession(page)

    /*
     * ONE PIXEL PER MOVE, and that is the test rather than a detail of it. The excursion being
     * pinned lives in the first 6.4px of the pull, so a drag dispatched in the usual sixteen
     * chunks steps straight over it — 120px in 16 moves is 7.5px a move, and the first sample
     * already lands past the far side. Written that way this test passes against the very curve
     * it exists to reject (checked). A finger moves about a pixel a frame; so does this.
     */
    const samples = await touchDragSampled(
      page,
      cdp,
      { x: 195, y: sheet.top + 40 },
      -60,
      60,
    )

    expect(samples.length).toBeGreaterThan(40)
    //y grows downward, so anything positive is the sheet moving away from the finger. A whole
    //pixel of tolerance, because the kick being pinned here was sixteen.
    const worst = Math.max(...samples)
    expect(
      worst,
      `the sheet dipped ${worst.toFixed(1)}px BELOW rest during an upward pull: ${samples
        .map((s) => s.toFixed(1))
        .join(", ")}`,
    ).toBeLessThanOrEqual(1)
    //and it did give something, so this is not passing because the drag never engaged
    expect(Math.min(...samples)).toBeLessThan(-2)
  })

  test("snaps back to rest after a short drag down @tailwind", async ({
    page,
  }) => {
    await openSheet(page, BUTTON, PANEL)
    const sheet = await sheetBox(page, SHEET)
    const cdp = await page.context().newCDPSession(page)

    await touchDrag(cdp, { x: 195, y: sheet.top + 40 }, 48)
    await expect
      .poll(
        async () => Math.round((await readTranslateY(page, PANEL)) ?? -1),
        {
          timeout: 3000,
        },
      )
      .toBe(0)
    await expect(page.locator(PANEL)).toBeVisible()
  })

  test("closes when dragged well past the threshold", async ({ page }) => {
    await openSheet(page, BUTTON, PANEL)
    const sheet = await sheetBox(page, SHEET)
    const cdp = await page.context().newCDPSession(page)

    await touchDrag(cdp, { x: 195, y: sheet.top + 40 }, sheet.height * 0.8)
    await expect(page.locator(PANEL)).toHaveCount(0, { timeout: 4000 })
    //and the dim goes with it — an overlay left behind blocks the page while nothing is visible
    await expect(page.locator(OVERLAY)).toHaveCount(0)
  })

  test("reopening mid-close continues from where the sheet is", async ({
    page,
  }) => {
    await openSheet(page, BUTTON, PANEL)
    const closedY = (await sheetBox(page, SHEET)).height

    //close, then change our mind while it is still travelling
    await page.locator(OVERLAY).click({ force: true })
    await page.waitForTimeout(140)
    const midClose = (await readTranslateY(page, PANEL)) ?? 0
    expect(midClose).toBeGreaterThan(4)

    await page.getByRole("button", { name: BUTTON }).first().click()
    await page.waitForTimeout(48)
    const afterReopen = (await readTranslateY(page, PANEL)) ?? 0

    //the fix this pins: a reopen used to snap the panel to fully-closed and slide up from there,
    //which reads as a flash. It has to carry on from the position on screen instead.
    expect(afterReopen).toBeLessThan(closedY * 0.9)
    await expect
      .poll(
        async () => Math.round((await readTranslateY(page, PANEL)) ?? -1),
        {
          timeout: 4000,
        },
      )
      .toBe(0)
  })

  test("reopens at rest, not where the last drag left it", async ({
    page,
  }) => {
    /*
     * Device-reported, then reproduced here: after a drag that closed the sheet, the NEXT open
     * arrived and then dropped by exactly the distance of that drag — 117px and 148px in the
     * traces, 133px here — and stayed there. The panel unmounts between opens but the engine
     * does not, so a value the last gesture left behind is still live on the next one, and the
     * reset has to be deliberate rather than a side effect of re-measuring.
     */
    await openSheet(page, BUTTON, PANEL)
    const sheet = await sheetBox(page, SHEET)
    const cdp = await page.context().newCDPSession(page)

    await touchDrag(cdp, { x: 195, y: sheet.top + 40 }, sheet.height * 0.8)
    await expect(page.locator(PANEL)).toHaveCount(0, { timeout: 4000 })

    await openSheet(page, BUTTON, PANEL)
    //the drop landed AFTER the settle, so a poll that stops at the first 0 would miss it
    await page.waitForTimeout(400)
    expect(Math.round((await readTranslateY(page, PANEL)) ?? -1)).toBe(0)
    const after = await sheetBox(page, SHEET)
    expect(Math.abs(after.bottom - after.viewport)).toBeLessThanOrEqual(
      REST_TOLERANCE_PX,
    )
  })

  test("shows exactly one drag indicator", async ({ page }) => {
    /*
     * `Drawer.Content` partitions its children by `displayName`, so `Drawer.Handle` is a
     * protocol name rather than a label. A wrapper that renamed it made the handle
     * unrecognisable: Content rendered its own default grabber AND the passed one fell through
     * into the body. Two indicators, and nothing failed.
     */
    await openSheet(page, BUTTON, PANEL)
    const grabbers = await page.evaluate((sel) => {
      const panel = document.querySelector(sel)
      if (!panel) return -1
      //the grabber is the only aria-hidden pill in the sheet: short, wide, fully rounded
      return [...panel.querySelectorAll("span[aria-hidden]")].filter(
        (el) => {
          const rect = el.getBoundingClientRect()
          return rect.height > 0 && rect.height <= 8 && rect.width >= 24
        },
      ).length
    }, PANEL)
    expect(grabbers).toBe(1)
  })

  test("fades the dim in rather than flashing it at full strength", async ({
    page,
  }) => {
    await page.getByRole("button", { name: BUTTON }).first().click()
    //a freshly mounted <button> defaults to opacity 1; the engine has to start it hidden
    const first = await page.evaluate((sel) => {
      return new Promise((resolve) => {
        requestAnimationFrame(() => {
          const el = document.querySelector(sel)
          resolve(el ? Number(getComputedStyle(el).opacity) : null)
        })
      })
    }, OVERLAY)
    expect(first).not.toBeNull()
    expect(first as number).toBeLessThan(0.9)
    await expect
      .poll(
        async () =>
          await page.evaluate((sel) => {
            const el = document.querySelector(sel)
            return el ? Number(getComputedStyle(el).opacity) : -1
          }, OVERLAY),
        { timeout: 3000 },
      )
      .toBeGreaterThan(0.95)
  })
})

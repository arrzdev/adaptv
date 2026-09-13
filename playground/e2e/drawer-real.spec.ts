import type { CDPSession, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The app's OWN drawers.
 *
 * drawer-motion.spec.ts pins how a sheet MOVES, using a purpose-built one so the motion is the
 * only variable. That is the right shape for isolating the motion and the wrong shape for trusting
 * it: the behaviours that were found and fixed one at a time live in the real drawers — a field
 * that autofocuses and raises the keyboard before the sheet has finished arriving, pickers that
 * stack under it, a footer that owns the safe-area inset, a Close inside the tree.
 *
 * So this file opens the components the app actually ships (sign in, new deck, the task form) and
 * asserts the same things of each. They are imported from where the app uses them, so
 * nothing here is a reproduction that can quietly drift from what users get.
 *
 * ⚠︎ chromium-only (CDP touch), and headless — there is no on-screen keyboard here, so this
 * covers the autofocus and the sheet's geometry, NOT the keyboard lift. That still needs a device.
 */

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })
test.describe.configure({ mode: "serial" })

const PANEL = "[data-pwa-drawer]"
const OVERLAY = "[data-pwa-drawer-overlay]"

const DRAWERS = [
  { name: "sign in", button: "Sign in (autofocus)", autoFocuses: true },
  { name: "new deck", button: "New deck (autofocus)", autoFocuses: true },
  { name: "task", button: "Task", autoFocuses: false },
] as const

const REST_TOLERANCE_PX = 2

/** What a settled sheet looks like from outside: where it is, how many grabbers it shows, and
 *  whether anything inside it took focus. */
function readSheet(page: Page, panelSel: string) {
  return page.evaluate((sel) => {
    const panel = document.querySelector(sel)
    if (!panel) return null
    const sheet = panel.firstElementChild
    if (!sheet) return null
    const transform = getComputedStyle(panel).transform
    const box = sheet.getBoundingClientRect()
    const active = document.activeElement
    return {
      translateY:
        transform && transform !== "none"
          ? new DOMMatrixReadOnly(transform).m42
          : 0,
      top: box.top,
      bottom: box.bottom,
      viewport: window.innerHeight,
      //the grabber is the only aria-hidden pill in the sheet: short, wide, fully rounded
      grabbers: [...panel.querySelectorAll("span[aria-hidden]")].filter(
        (el) => {
          const rect = el.getBoundingClientRect()
          return rect.height > 0 && rect.height <= 8 && rect.width >= 24
        },
      ).length,
      focusIsInside: active ? panel.contains(active) : false,
      focusTag:
        active && active !== document.body
          ? active.tagName.toLowerCase()
          : "none",
    }
  }, panelSel)
}

async function settledSheet(page: Page, panelSel: string) {
  const sheet = await readSheet(page, panelSel)
  if (!sheet) throw new Error(`${panelSel} is not on screen`)
  return sheet
}

async function tapLabButton(page: Page, label: string) {
  await page
    .getByRole("button", { name: label, exact: true })
    .first()
    .click()
}

async function touchDrag(
  cdp: CDPSession,
  from: { x: number; y: number },
  dy: number,
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [from],
  })
  for (let step = 1; step <= 14; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from.x, y: from.y + (dy * step) / 14 }],
    })
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  })
}

test.describe("the app's own drawers", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "needs CDP touch injection — synthetic events do not drive the native touch path",
  )

  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/drawer")
    //the SSR splash self-unmounts on hydration, and it is the only honest "React is driving"
    //signal here — every trigger below is server-rendered, so waiting on one only proves the
    //HTML arrived. See the note on `awaitClientHandover` in e2e/support/hydrated.ts.
    await awaitClientHandover(page)
    await page
      .getByRole("button", { name: DRAWERS[0].button, exact: true })
      .first()
      .waitFor()
  })

  for (const drawer of DRAWERS) {
    test(`${drawer.name}: opens to rest, flush, with one grabber`, async ({
      page,
    }) => {
      await tapLabButton(page, drawer.button)
      await page.locator(PANEL).waitFor({ state: "attached" })
      await expect
        .poll(
          async () =>
            Math.round((await settledSheet(page, PANEL)).translateY),
          { timeout: 4000 },
        )
        .toBe(0)

      //the drop this catches landed AFTER the settle, so re-read once the dust is down
      await page.waitForTimeout(300)
      const sheet = await settledSheet(page, PANEL)

      expect(Math.round(sheet.translateY)).toBe(0)
      //no gap under it: the sheet a user sees ends exactly at the bottom edge
      expect(Math.abs(sheet.bottom - sheet.viewport)).toBeLessThanOrEqual(
        REST_TOLERANCE_PX,
      )
      expect(sheet.top).toBeGreaterThan(0)
      //Drawer.Content partitions children by displayName; a wrapper that renames the handle
      //gets the default grabber AND the passed one, and nothing fails
      expect(sheet.grabbers).toBe(1)
    })

    test(`${drawer.name}: ${
      drawer.autoFocuses
        ? "focuses its field, inside the panel"
        : "takes no focus on open"
    }`, async ({ page }) => {
      await tapLabButton(page, drawer.button)
      await page.locator(PANEL).waitFor({ state: "attached" })
      await page.waitForTimeout(700)
      const sheet = await settledSheet(page, PANEL)

      if (drawer.autoFocuses) {
        //autofocus is what puts the keyboard up before the sheet has landed — the case every
        //nasty keyboard bug came from. Focus escaping the panel is the failure to catch here.
        expect(sheet.focusIsInside).toBe(true)
        expect(sheet.focusTag).toBe("input")
      } else {
        expect(sheet.focusIsInside).toBe(false)
      }
    })

    test(`${drawer.name}: drags away, and the dim goes with it`, async ({
      page,
    }) => {
      await tapLabButton(page, drawer.button)
      await page.locator(PANEL).waitFor({ state: "attached" })
      await expect
        .poll(
          async () =>
            Math.round((await settledSheet(page, PANEL)).translateY),
          { timeout: 4000 },
        )
        .toBe(0)

      const sheet = await settledSheet(page, PANEL)
      const cdp = await page.context().newCDPSession(page)
      await touchDrag(cdp, { x: 195, y: sheet.top + 30 }, 300)

      await expect(page.locator(PANEL)).toHaveCount(0, {
        timeout: 4000,
      })
      //an overlay left behind blocks the page while nothing is visible
      await expect(page.locator(OVERLAY)).toHaveCount(0)
    })
  }
})

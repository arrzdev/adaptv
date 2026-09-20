import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The panel's box is the sheet; the hidden tail hangs below it.
 *
 * Safari on iOS 26 colours its bottom toolbar from the fixed element it finds at the bottom edge
 * of the viewport, and refuses one whose border box is taller than 1.05 viewports (WebKit
 * `LocalFrameView::fixedContainerEdges`, the `TooLarge` branch). With the tail inside the panel a
 * form-sized sheet measured ~1.3 viewports, Safari found nothing at the edge and painted the
 * toolbar in the page's theme colour under a white sheet (docs/decisions/register.md B33).
 *
 * No headless engine has that toolbar, so this pins the geometry the toolbar reads: the panel's
 * box stays inside the viewport ratio Safari accepts, and the tail is still there below it, still
 * painted like the sheet, so an over-drag or the keyboard lift never shows a gap. Both engines.
 */

test.use({ viewport: { width: 390, height: 844 } })

const PANEL = "[data-pwa-drawer]"
const TAIL = "[data-pwa-drawer-tail]"

//the two tallest sheets the lab has: a real form, and content that only the ceiling stops
const DRAWERS = ["Task", "Open tall drawer (no cap)"] as const

//WebKit's `maximumRatio` for the side adjacent to the edge it samples
const SAFARI_MAX_PANEL_RATIO = 1.05
const REST_TOLERANCE_PX = 2

function readGeometry(page: Page) {
  return page.evaluate(
    ({ panelSel, tailSel }) => {
      const panel = document.querySelector<HTMLElement>(panelSel)
      const tail = document.querySelector<HTMLElement>(tailSel)
      const sheet = panel?.firstElementChild
      if (!panel || !tail || !sheet) return null
      const transform = getComputedStyle(panel).transform
      const box = panel.getBoundingClientRect()
      const tailBox = tail.getBoundingClientRect()
      return {
        translateY:
          transform && transform !== "none"
            ? new DOMMatrixReadOnly(transform).m42
            : 0,
        viewport: window.innerHeight,
        panel: { top: box.top, bottom: box.bottom, height: box.height },
        sheetBottom: sheet.getBoundingClientRect().bottom,
        tail: {
          top: tailBox.top,
          height: tailBox.height,
          width: tailBox.width,
          isLastChild: panel.lastElementChild === tail,
        },
        background: {
          panel: getComputedStyle(panel).backgroundColor,
          tail: getComputedStyle(tail).backgroundColor,
        },
      }
    },
    { panelSel: PANEL, tailSel: TAIL },
  )
}

async function settled(page: Page) {
  const geometry = await readGeometry(page)
  if (!geometry) throw new Error("the drawer is not on screen")
  return geometry
}

test.describe("the drawer's hidden tail", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/drawer")
    await awaitClientHandover(page)
  })

  for (const button of DRAWERS) {
    test(`${button}: the panel's box is the sheet, the tail hangs below it`, async ({
      page,
    }) => {
      await page
        .getByRole("button", { name: button, exact: true })
        .first()
        .click()
      await page.locator(PANEL).waitFor({ state: "attached" })
      await expect
        .poll(async () => Math.round((await settled(page)).translateY), {
          timeout: 4000,
        })
        .toBe(0)
      await page.waitForTimeout(300)
      const g = await settled(page)

      //the premise: a sheet tall enough that sheet + tail (55% of the viewport) would have
      //crossed Safari's ratio — otherwise this test could not have failed before the fix
      expect(g.panel.height).toBeGreaterThan(g.viewport * 0.55)
      //what Safari's edge sampler reads: the fixed element's own border box
      expect(g.panel.height).toBeLessThanOrEqual(
        g.viewport * SAFARI_MAX_PANEL_RATIO,
      )
      //the panel ends where the sheet ends — on the fold, not below it
      expect(Math.abs(g.panel.bottom - g.viewport)).toBeLessThanOrEqual(
        REST_TOLERANCE_PX,
      )
      expect(Math.abs(g.sheetBottom - g.viewport)).toBeLessThanOrEqual(
        REST_TOLERANCE_PX,
      )

      //and the tail is still there, below the fold, the sheet's width, the sheet's paint
      expect(g.tail.isLastChild).toBe(true)
      expect(g.tail.height).toBeGreaterThan(0)
      expect(Math.abs(g.tail.top - g.panel.bottom)).toBeLessThanOrEqual(1)
      expect(Math.abs(g.tail.width - 390)).toBeLessThanOrEqual(1)
      expect(g.background.tail).toBe(g.background.panel)
    })
  }
})

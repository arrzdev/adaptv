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

type Geometry = NonNullable<Awaited<ReturnType<typeof readGeometry>>>

/** What Safari's edge sampler reads, and the tail below it — the same invariants at rest and
 *  with the keyboard up. */
function expectSheetAndTail(g: Geometry) {
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
}

async function openAndSettle(page: Page, button: string) {
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
  return settled(page)
}

/*
 * The keyboard lift is the other thing that changes the panel's height: the content box holds
 * the keyboard as `padding-bottom` and grows into it (capped at the stylesheet cap), so the
 * panel's border box — what Safari measures against its 1.05 ratio — is at its tallest with a
 * keyboard up. Driven through adaptv's keyboard seam (installed before the hook mounts), 40% of
 * the viewport, on both engines.
 */
const KEYBOARD_EVENT = "adaptv:keyboard-mock"
const KEYBOARD_PX = Math.round(844 * 0.4)

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

/** The content box's inline room and whether anything is still moving on the panel. */
function readRoom(page: Page) {
  return page.evaluate((panelSel) => {
    const panel = document.querySelector<HTMLElement>(panelSel)
    const content = panel?.firstElementChild as HTMLElement | null
    if (!panel || !content) return null
    return {
      padding: content.style.paddingBottom,
      minHeight: content.style.minHeight,
      animations: panel.getAnimations().length,
      height: content.getBoundingClientRect().height,
    }
  }, PANEL)
}

async function awaitRoomSettled(page: Page, padding: string) {
  await expect
    .poll(async () => {
      const a = await readRoom(page)
      if (!a) return "no panel"
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => r(null))),
      )
      const b = await readRoom(page)
      if (!b) return "no panel"
      const stable =
        a.padding === padding &&
        b.padding === padding &&
        a.animations === 0 &&
        b.animations === 0 &&
        Math.abs(a.height - b.height) < 0.5
      return stable ? true : JSON.stringify(b)
    })
    .toBe(true)
}

test.describe("the drawer's hidden tail", () => {
  test.beforeEach(async ({ page }) => {
    //the keyboard seam, installed before the hook mounts (the rest tests never raise it)
    await page.addInitScript(() => {
      ;(
        window as unknown as { __adaptvKeyboardMock?: unknown }
      ).__adaptvKeyboardMock = { isOpen: false, height: 0 }
    })
    await page.goto("/lab/drawer")
    await awaitClientHandover(page)
  })

  for (const button of DRAWERS) {
    test(`${button}: the panel's box is the sheet, the tail hangs below it`, async ({
      page,
    }) => {
      const g = await openAndSettle(page, button)
      expectSheetAndTail(g)
    })

    test(`${button}: with the keyboard raised the panel's box still stays under Safari's ratio, the tail flush below it`, async ({
      page,
    }, testInfo) => {
      const rest = await openAndSettle(page, button)
      expectSheetAndTail(rest)

      await setKeyboard(page, true, KEYBOARD_PX)
      await awaitRoomSettled(page, `${KEYBOARD_PX}px`)
      const up = await settled(page)
      const room = await readRoom(page)
      console.log(
        `TAIL-KB ${testInfo.project.name} ${button}: rest panel ${rest.panel.height.toFixed(1)}; keyboard ${KEYBOARD_PX}px up → panel top ${up.panel.top.toFixed(1)} bottom ${up.panel.bottom.toFixed(1)} height ${up.panel.height.toFixed(1)} (${(up.panel.height / up.viewport).toFixed(3)} viewports), sheet bottom ${up.sheetBottom.toFixed(1)}, tail top ${up.tail.top.toFixed(1)} height ${up.tail.height.toFixed(1)} width ${up.tail.width.toFixed(1)}, bg panel ${up.background.panel} tail ${up.background.tail}, room ${JSON.stringify(room)}`,
      )
      //the premise: the room is held and the sheet grew (or is at its cap)
      expect(room?.padding).toBe(`${KEYBOARD_PX}px`)
      expect(room?.minHeight).toBe("")
      expect(up.panel.height).toBeGreaterThanOrEqual(rest.panel.height - 1)
      expectSheetAndTail(up)

      await setKeyboard(page, false, 0)
      await awaitRoomSettled(page, "")
      const back = await settled(page)
      expect(
        Math.abs(back.panel.height - rest.panel.height),
      ).toBeLessThanOrEqual(REST_TOLERANCE_PX)
      expectSheetAndTail(back)
    })
  }
})

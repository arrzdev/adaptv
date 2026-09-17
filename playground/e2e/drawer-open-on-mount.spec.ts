import type { BrowserContext, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * A drawer that is open the moment it mounts must drag like any other.
 *
 * The engine only learns its portal target after mount, so a sheet that is open on the first
 * render is committed inline and then moved into `document.body` — a new panel element. A
 * whole-sheet touch drag bound to the first one is bound to a node that is no longer on screen:
 * the sheet sits dead under the finger. A sheet opened by a tap never goes through that commit,
 * which is why every other drawer spec was green while this one was broken.
 *
 * Section 8 of the drawer lab carries one uncontrolled `defaultOpen` drawer with its own trigger.
 * Three ways in: server-rendered open (`?open-on-mount`), mounted open after hydration, and — the
 * control — the same instance closed and reopened from its trigger.
 *
 * Touch drivers, one per engine, because Playwright has no touch-move for WebKit:
 *  · chromium: CDP `Input.dispatchTouchEvent`, the browser's own input pipeline (hit testing,
 *    `touch-action`, cancelable moves).
 *  · webkit: there is no CDP, `page.touchscreen` only taps, and `new Touch()` is an illegal
 *    constructor. So the gesture is dispatched as touch events on the element under the point,
 *    carrying the touch list the engine reads. That reaches exactly the native listeners the bug
 *    is about, but not WebKit's own gesture recognition — the iOS feel stays a device check.
 *
 * `hasTouch` on the context with a PORTRAIT viewport: a landscape touch context raises the
 * rotate guard over the whole page (memory: touch-emulation-desktop-is-landscape).
 */

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

const PANEL = "[data-pwa-drawer]"
const OVERLAY = "[data-pwa-drawer-overlay]"
const SHEET = `${PANEL} > *:first-child`
const MOUNT = "Mount a drawer that starts open"
const REOPEN = "Reopen it from its trigger"

//comfortably past the 4px slop and far below any threshold noise: a sheet that moved less than
//this during a 300px drag did not follow the finger
const FOLLOWED_PX = 40
const SHORT_DRAG_PX = 40

type Point = { x: number; y: number }

interface TouchDriver {
  start(point: Point): Promise<void>
  move(point: Point): Promise<void>
  end(point: Point): Promise<void>
}

async function cdpTouch(page: Page, context: BrowserContext) {
  const cdp = await context.newCDPSession(page)
  return {
    start: async (point) => {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [point],
      })
    },
    move: async (point) => {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [point],
      })
    },
    end: async () => {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      })
    },
  } satisfies TouchDriver
}

function syntheticTouch(page: Page): TouchDriver {
  const send = (
    type: "touchstart" | "touchmove" | "touchend",
    point: Point,
  ) =>
    page.evaluate(
      ({ type, point }) => {
        const w = window as unknown as { __touchTarget?: Element | null }
        if (type === "touchstart") {
          w.__touchTarget = document.elementFromPoint(point.x, point.y)
        }
        //a real touch keeps the element it started on as its target for the whole gesture
        const target = w.__touchTarget
        if (!target) throw new Error("no element under the touch point")
        const item = {
          identifier: 1,
          target,
          clientX: point.x,
          clientY: point.y,
          pageX: point.x,
          pageY: point.y,
          screenX: point.x,
          screenY: point.y,
        }
        const event = new Event(type, { bubbles: true, cancelable: true })
        Object.defineProperties(event, {
          touches: { value: type === "touchend" ? [] : [item] },
          targetTouches: { value: type === "touchend" ? [] : [item] },
          changedTouches: { value: [item] },
        })
        target.dispatchEvent(event)
      },
      { type, point },
    )
  return {
    start: (point) => send("touchstart", point),
    move: (point) => send("touchmove", point),
    end: (point) => send("touchend", point),
  }
}

async function touchDriver(
  page: Page,
  context: BrowserContext,
  browserName: string,
) {
  return browserName === "chromium"
    ? cdpTouch(page, context)
    : syntheticTouch(page)
}

/** How far the panel is translated from rest, in px — the painted value, not the inline style. */
function readTranslateY(page: Page) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const t = getComputedStyle(el).transform
    if (!t || t === "none") return 0
    return new DOMMatrixReadOnly(t).m42
  }, PANEL)
}

/**
 * The premise, asserted rather than assumed: exactly one sheet, portalled into the body, settled
 * at rest and on screen, with a point on it that actually hits it.
 */
async function openSheetAtRest(page: Page) {
  await expect(page.locator(PANEL)).toHaveCount(1)
  await expect(page.locator(PANEL)).toBeVisible()
  await expect
    .poll(async () => Math.round((await readTranslateY(page)) ?? -1), {
      timeout: 4000,
    })
    .toBe(0)
  const sheet = await page.evaluate(
    ({ panelSel, sheetSel }) => {
      const panel = document.querySelector(panelSel)
      const box = document.querySelector(sheetSel)?.getBoundingClientRect()
      if (!panel || !box) return null
      const x = Math.round(box.left + box.width / 2)
      //the middle of the sheet, well clear of the handle: the whole-sheet drag is under test
      const y = Math.round(box.top + Math.min(box.height / 2, 120))
      const hit = document.elementFromPoint(x, y)
      return {
        x,
        y,
        top: box.top,
        bottom: box.bottom,
        height: box.height,
        viewport: window.innerHeight,
        portalled: panel.parentElement === document.body,
        hitsSheet: hit ? panel.contains(hit) : false,
      }
    },
    { panelSel: PANEL, sheetSel: SHEET },
  )
  if (!sheet) throw new Error("the sheet is not on screen")
  expect(sheet.portalled).toBe(true)
  expect(sheet.top).toBeGreaterThan(0)
  expect(Math.abs(sheet.bottom - sheet.viewport)).toBeLessThanOrEqual(2)
  expect(
    sheet.hitsSheet,
    "the drag point does not land on the sheet",
  ).toBe(true)
  return sheet
}

/**
 * Drag down by `dy` in 16 moves, sampling the panel's translate after every move. `holdMs` keeps
 * the finger down at the end before lifting it: the release decides on velocity as well as
 * distance, so a short drag delivered as fast as the driver can go is a flick, and closes.
 */
async function dragSampled(
  page: Page,
  driver: TouchDriver,
  from: Point,
  dy: number,
  holdMs = 0,
) {
  const steps = 16
  const samples: number[] = []
  await driver.start(from)
  let at = from
  for (let step = 1; step <= steps; step += 1) {
    at = { x: from.x, y: from.y + (dy * step) / steps }
    await driver.move(at)
    samples.push((await readTranslateY(page)) ?? Number.NaN)
  }
  if (holdMs > 0) await page.waitForTimeout(holdMs)
  await driver.end(at)
  return samples
}

function expectFollowed(samples: number[], dy: number) {
  const furthest = Math.max(...samples)
  expect(
    furthest,
    `the sheet did not follow a ${dy}px drag — translateY per move: ${samples
      .map((s) => s.toFixed(1))
      .join(", ")}`,
  ).toBeGreaterThan(FOLLOWED_PX)
}

async function expectClosed(page: Page) {
  await expect(page.locator(PANEL)).toHaveCount(0, { timeout: 4000 })
  //an overlay left behind blocks the page while nothing is visible
  await expect(page.locator(OVERLAY)).toHaveCount(0)
}

test.describe("a drawer open on mount", () => {
  test("control: closed and reopened from its trigger, the sheet follows a drag and closes", async ({
    page,
    context,
    browserName,
  }) => {
    await page.goto("/lab/drawer")
    await awaitClientHandover(page)
    await page.getByRole("button", { name: MOUNT }).click()
    await openSheetAtRest(page)
    await page
      .locator(PANEL)
      .getByRole("button", { name: "Close", exact: true })
      .click()
    await expectClosed(page)

    await page.getByRole("button", { name: REOPEN }).click()
    const sheet = await openSheetAtRest(page)
    const driver = await touchDriver(page, context, browserName)
    const samples = await dragSampled(page, driver, sheet, 300)
    expectFollowed(samples, 300)
    await expectClosed(page)
  })

  test("server-rendered open: the sheet follows a drag and a long one closes it", async ({
    page,
    context,
    browserName,
  }) => {
    await page.goto("/lab/drawer?open-on-mount")
    await awaitClientHandover(page)
    const sheet = await openSheetAtRest(page)
    const driver = await touchDriver(page, context, browserName)

    const samples = await dragSampled(page, driver, sheet, 300)
    expectFollowed(samples, 300)
    await expectClosed(page)
  })

  test("mounted open: the sheet follows a drag and a long one closes it", async ({
    page,
    context,
    browserName,
  }) => {
    await page.goto("/lab/drawer")
    await awaitClientHandover(page)
    await page.getByRole("button", { name: MOUNT }).click()
    const sheet = await openSheetAtRest(page)
    const driver = await touchDriver(page, context, browserName)

    const samples = await dragSampled(page, driver, sheet, 300)
    expectFollowed(samples, 300)
    await expectClosed(page)
  })

  test("mounted open: a short drag moves the sheet and it snaps back to rest", async ({
    page,
    context,
    browserName,
  }) => {
    await page.goto("/lab/drawer")
    await awaitClientHandover(page)
    await page.getByRole("button", { name: MOUNT }).click()
    const sheet = await openSheetAtRest(page)
    const driver = await touchDriver(page, context, browserName)

    //short against the distance threshold (a quarter of the sheet) so only a flick could close
    //it, and held before the lift (40px over 400ms+ is far under the 0.4px/ms flick) so it is not
    expect(sheet.height * 0.25).toBeGreaterThan(SHORT_DRAG_PX)
    const samples = await dragSampled(
      page,
      driver,
      sheet,
      SHORT_DRAG_PX,
      400,
    )
    //a short drag still has to move it — a sheet that never moved also "snaps back"
    const furthest = Math.max(...samples)
    expect(
      furthest,
      `the sheet did not follow a ${SHORT_DRAG_PX}px drag — translateY per move: ${samples
        .map((s) => s.toFixed(1))
        .join(", ")}`,
    ).toBeGreaterThan(SHORT_DRAG_PX / 2)
    await expect
      .poll(async () => Math.round((await readTranslateY(page)) ?? -1), {
        timeout: 3000,
      })
      .toBe(0)
    await expect(page.locator(PANEL)).toBeVisible()
  })
})

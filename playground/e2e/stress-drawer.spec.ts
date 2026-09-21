import type { BrowserContext, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * STRESS pass over the drawer engine: what happens when the user is faster, rougher or less
 * patient than the happy path every other drawer spec walks.
 *
 * drawer-motion.spec.ts pins one behaviour per test on a sheet at rest. This file starts every
 * interaction from the WRONG moment — mid-slide, mid-drag, mid-resize, mid-navigation — and asks
 * whether the engine keeps its own contract: exactly one panel and one overlay, a transform that
 * belongs to the finger while a finger is down, a settle that clears the keyframe it armed, a
 * viewport lock and a chrome tint that are handed back, and nothing accumulating across cycles.
 *
 * Doctrine, inherited from the other drawer specs and kept whole here:
 *  · the hydration gate (`awaitClientHandover`) before the first interaction of every test;
 *  · the PREMISE of every test is asserted (the slide really was running, the drag really
 *    committed, the scroller really scrolled), so a harness that stops reproducing the situation
 *    fails in its own words instead of passing vacuously or blaming the engine;
 *  · no retries, no warm-ups, no sleeps where a condition can be polled — `waitForTimeout` only
 *    where the thing under test IS a delay (a finger held still, a gap between mashed taps);
 *  · a real failure is the deliverable: nothing here is loosened to go green. The header of each
 *    case says what it expects of the code as it stands.
 *
 * Touch drivers, one per engine, as drawer-open-on-mount.spec.ts does it: CDP
 * `Input.dispatchTouchEvent` on chromium (the browser's own input pipeline, native scrolling
 * included), and a synthetic `TouchEvent` carrying the touch list on webkit (reaches the engine's
 * native listeners, cannot scroll a scroller). Cases that need the scroller to scroll under the
 * finger are chromium-only and say so.
 *
 * `hasTouch` with a PORTRAIT viewport — a landscape touch context raises the rotate guard over
 * the whole page (memory: touch-emulation-desktop-is-landscape). The mouse and rotation cases run
 * in a nested desktop context.
 *
 * Each numbered case is its own `describe` in serial mode rather than the whole file: serial
 * mode skips the rest of a group after a failure, and a stress file must not let a red case 2
 * silence cases 3 to 12 — cases 2, 2b and 5 were red when this file was written.
 */

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

const OPEN_BASIC = "Open basic drawer"
const OPEN_SCROLLING = "Open scrolling drawer"
const OPEN_NESTED = "Open nested drawer"
const OPEN_INNER = "Open the inner drawer"
const OPEN_TALL = "Open tall drawer (no cap)"

const PANEL = "[data-pwa-drawer]"
const OVERLAY = "[data-pwa-drawer-overlay]"
const TAIL = "[data-pwa-drawer-tail]"
//the panel also carries the hidden tail, so the visible sheet is its first child; inside it the
//handle region, then the scroller, whose first child is the consumer's Shell
const SHEET = `${PANEL} > *:first-child`
const HANDLE = `${SHEET} > *:first-child`
const SCROLLER = `${SHEET} > *:nth-child(2)`
const SHELL = `${SCROLLER} > *:first-child`
const META = "#theme-color-class-override"
const SLIDE = "pwa-drawer-slide"
const FROM_VAR = "--pwa-drawer-from"

const PORTRAIT = { width: 390, height: 844 }
const REST_PX = 2
//the whole-sheet touch drag commits past this much finger travel (drawer-engine DRAG_THRESHOLD_PX)
const SLOP_PX = 4

const TAG = "[stress-drawer]"

/* ── readers ─────────────────────────────────────────────────────────────── */

type PanelState = {
  translateY: number
  slide: { currentTime: number; playState: string } | null
  animations: string[]
  inlineAnimation: string
  inlineTransform: string
  fromVar: string
  top: number
  bottom: number
  height: number
  viewport: number
}

/** Everything the motion contract is stated in, read off the panel in one round trip. */
function readPanel(page: Page, index = 0): Promise<PanelState | null> {
  return page.evaluate(
    ({ sel, slide, fromVar, index }) => {
      const panel = document.querySelectorAll<HTMLElement>(sel)[index]
      if (!panel) return null
      const t = getComputedStyle(panel).transform
      const translateY =
        !t || t === "none" ? 0 : new DOMMatrixReadOnly(t).m42
      const animations = panel.getAnimations() as (Animation & {
        animationName?: string
        transitionProperty?: string
      })[]
      const running = animations.find((a) => a.animationName === slide)
      const rect = panel.getBoundingClientRect()
      return {
        translateY,
        slide: running
          ? {
              currentTime: Number(running.currentTime),
              playState: running.playState,
            }
          : null,
        animations: animations.map(
          (a) =>
            a.animationName ??
            (a.transitionProperty
              ? `transition:${a.transitionProperty}`
              : a.constructor.name),
        ),
        inlineAnimation: panel.style.animation,
        inlineTransform: panel.style.transform,
        fromVar: panel.style.getPropertyValue(fromVar),
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        viewport: window.innerHeight,
      }
    },
    { sel: PANEL, slide: SLIDE, fromVar: FROM_VAR, index },
  )
}

/** How far the panel is translated from rest — the painted value, not the inline style. */
function readTranslateY(page: Page, index = 0): Promise<number | null> {
  return page.evaluate(
    ({ sel, index }) => {
      const el = document.querySelectorAll(sel)[index]
      if (!el) return null
      const t = getComputedStyle(el).transform
      if (!t || t === "none") return 0
      return new DOMMatrixReadOnly(t).m42
    },
    { sel: PANEL, index },
  )
}

function readOverlay(page: Page, index = 0) {
  return page.evaluate(
    ({ sel, index }) => {
      const el = document.querySelectorAll<HTMLElement>(sel)[index]
      if (!el) return null
      return {
        state: el.dataset.state ?? "",
        dragging: el.dataset.dragging ?? "",
        opacity: getComputedStyle(el).opacity,
        animations: el
          .getAnimations()
          .map(
            (a) => (a as { animationName?: string }).animationName ?? "",
          ),
      }
    },
    { sel: OVERLAY, index },
  )
}

/** The viewport lock `useFreezeViewport` writes on `<html>` while a drawer is open. */
function readLock(page: Page) {
  return page.evaluate(() => ({
    overflow: document.documentElement.style.overflow,
    paddingRight: document.documentElement.style.paddingRight,
  }))
}

/** The chrome tint tag's current colour. */
function tint(page: Page) {
  return page.locator(META).getAttribute("content")
}

/** The tag once it has stopped moving — two reads 120ms apart agreeing. */
async function stableTint(page: Page) {
  let last = await tint(page)
  const deadline = Date.now() + 2500
  while (Date.now() < deadline) {
    await page.waitForTimeout(120)
    const next = await tint(page)
    if (next === last) return next
    last = next
  }
  throw new Error(`the chrome tint never settled (last read ${last})`)
}

/**
 * A point on the sheet's body, below the handle region — the whole-sheet drag is what is under
 * test — that actually hits the panel right now (asserted: a point that lands on the page behind
 * makes every drag pass vacuously).
 */
async function dragPoint(page: Page, index = 0) {
  const point = await page.evaluate(
    ({ panelSel, sheetSel, index }) => {
      const panel = document.querySelectorAll<HTMLElement>(panelSel)[index]
      const sheet = document.querySelectorAll<HTMLElement>(sheetSel)[index]
      if (!panel || !sheet) return null
      const rect = sheet.getBoundingClientRect()
      const x = Math.round(rect.left + rect.width / 2)
      const y = Math.round(rect.top + Math.min(100, rect.height / 2))
      const hit = document.elementFromPoint(x, y)
      return { x, y, hits: hit ? panel.contains(hit) : false }
    },
    { panelSel: PANEL, sheetSel: SHEET, index },
  )
  if (!point) throw new Error("the sheet is not on screen")
  expect(point.hits, "the drag point does not land on the sheet").toBe(
    true,
  )
  return { x: point.x, y: point.y }
}

function collectPageErrors(page: Page) {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(String(error)))
  return errors
}

function collectConsoleErrors(page: Page) {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  return errors
}

/* ── drivers ─────────────────────────────────────────────────────────────── */

type Point = { x: number; y: number }

interface TouchDriver {
  readonly kind: "cdp" | "synthetic"
  start(point: Point): Promise<void>
  move(point: Point): Promise<void>
  end(point: Point): Promise<void>
  cancel(point: Point): Promise<void>
}

async function cdpTouch(
  page: Page,
  context: BrowserContext,
): Promise<TouchDriver> {
  const cdp = await context.newCDPSession(page)
  const send = async (
    type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
    touchPoints: Point[],
  ) => {
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints })
  }
  return {
    kind: "cdp",
    start: (point) => send("touchStart", [point]),
    move: (point) => send("touchMove", [point]),
    end: () => send("touchEnd", []),
    cancel: () => send("touchCancel", []),
  }
}

function syntheticTouch(page: Page): TouchDriver {
  const send = (
    type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
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
        const ended = type === "touchend" || type === "touchcancel"
        const event = new Event(type, { bubbles: true, cancelable: true })
        Object.defineProperties(event, {
          touches: { value: ended ? [] : [item] },
          targetTouches: { value: ended ? [] : [item] },
          changedTouches: { value: [item] },
        })
        target.dispatchEvent(event)
      },
      { type, point },
    )
  return {
    kind: "synthetic",
    start: (point) => send("touchstart", point),
    move: (point) => send("touchmove", point),
    end: (point) => send("touchend", point),
    cancel: (point) => send("touchcancel", point),
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

/* ── the sheet's lifecycle, as steps ─────────────────────────────────────── */

async function gotoLab(page: Page) {
  await page.goto("/lab/drawer")
  await awaitClientHandover(page)
  await page.getByRole("button", { name: OPEN_BASIC }).first().waitFor()
}

function labButton(page: Page, name: string) {
  return page.getByRole("button", { name, exact: true }).first()
}

/** The Close button inside the sheet — `Drawer.Close` is a plain button. */
function sheetClose(page: Page, index = 0) {
  return page
    .locator(PANEL)
    .nth(index)
    .getByRole("button", { name: "Close", exact: true })
    .first()
}

/**
 * The sheet settled OPEN: translated to rest, with no slide keyframe left on it. Both halves,
 * because "at 0" alone is also what a keyframe holding its end value looks like.
 */
async function settleOpen(page: Page, index = 0, timeout = 4000) {
  await expect
    .poll(
      async () => {
        const state = await readPanel(page, index)
        if (!state) return "no panel"
        return Math.abs(state.translateY) <= REST_PX &&
          state.slide === null
          ? "settled"
          : `y=${state.translateY.toFixed(1)} slide=${state.slide?.playState ?? "none"}`
      },
      { timeout, intervals: [50] },
    )
    .toBe("settled")
}

async function expectUnmounted(page: Page, timeout = 4000) {
  await expect(page.locator(PANEL)).toHaveCount(0, { timeout })
  await expect(page.locator(OVERLAY)).toHaveCount(0, { timeout })
}

/**
 * Wait until the open slide's `currentTime` is inside [min, max] ms. The window is the premise:
 * a drag started after the slide ended is drawer-motion's ordinary drag, not this case.
 */
async function awaitSlideWindow(page: Page, min: number, max: number) {
  const deadline = Date.now() + 2000
  let last: number | null = null
  while (Date.now() < deadline) {
    const state = await readPanel(page)
    const at = state?.slide?.currentTime ?? null
    if (at !== null) {
      last = at
      if (at >= min && at <= max) return at
      if (at > max) {
        throw new Error(
          `missed the slide window [${min}, ${max}]ms — first read inside it was ${at}ms`,
        )
      }
    }
  }
  throw new Error(
    `the open slide never reached [${min}, ${max}]ms (last currentTime ${last})`,
  )
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN
}

function fmt(values: number[]) {
  return values
    .map((v) => (Number.isFinite(v) ? v.toFixed(1) : "—"))
    .join(", ")
}

function report(line: string) {
  console.log(`${TAG} ${line}`)
  test.info().annotations.push({ type: "finding", description: line })
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 1 · open/close mash faster than the slide
 * ═══════════════════════════════════════════════════════════════════════════ */

test.describe("1 · an open/close mash faster than the slide", () => {
  test.describe.configure({ mode: "serial" })
  test.beforeEach(async ({ page }) => {
    await gotoLab(page)
  })

  /**
   * Toggle `count` times with `gapMs` between taps: odd taps open (the lab button), even taps
   * close (the sheet's own Close). DOM-dispatched clicks, because from the first open onwards the
   * overlay covers the lab button and the sheet is in motion — a Playwright click would wait for
   * both to clear, which is the opposite of a mash. Both targets are plain `<button onClick>`.
   * Returns how many taps landed while the slide keyframe was running (the premise).
   */
  async function mash(page: Page, count: number, gapMs: number) {
    let midSlide = 0
    for (let i = 0; i < count; i += 1) {
      const state = await readPanel(page)
      if (state?.slide?.playState === "running") midSlide += 1
      if (i % 2 === 0) {
        await labButton(page, OPEN_BASIC).dispatchEvent("click")
      } else {
        if (!state) {
          throw new Error(
            `tap ${i + 1}: nothing to close — the panel is not mounted 60ms after an open`,
          )
        }
        await sheetClose(page).dispatchEvent("click")
      }
      await page.waitForTimeout(gapMs)
    }
    return midSlide
  }

  test("REPORT: how many onOpenChange calls one clean open + close produces", async ({
    page,
  }) => {
    await labButton(page, OPEN_BASIC).click()
    await settleOpen(page)
    await sheetClose(page).click()
    await expectUnmounted(page)
    //the settle fires a second onOpenChange(false); let it land before counting
    await page.waitForTimeout(300)
    const entries = await page
      .locator("[data-lab-log] li")
      .allTextContents()
    const opened = entries.filter((e) => e.includes("basic drawer opened"))
    const closed = entries.filter((e) => e.includes("basic drawer closed"))
    report(
      `one clean open+close logged: opened=${opened.length} closed=${closed.length} (entries: ${entries.length})`,
    )
    //not asserted: the engine calls onOpenChange on the close request AND on the close settle
    //(drawer.tsx handleSettle), and may echo the consumer's own prop change on open. The counts
    //are the finding.
    expect(entries.length).toBeGreaterThan(0)
  })

  test("ending OPEN: one panel, one overlay, at rest, no zombie keyframe", async ({
    page,
  }) => {
    const errors = collectPageErrors(page)
    //13 taps: 12 toggles at the mash cadence, plus the one that leaves it open
    const midSlide = await mash(page, 13, 60)
    expect(
      midSlide,
      "premise: at least one tap landed while the slide was running",
    ).toBeGreaterThan(0)

    await expect(page.locator(PANEL)).toHaveCount(1)
    await expect(page.locator(OVERLAY)).toHaveCount(1)
    await settleOpen(page, 0, 1000)
    const state = await readPanel(page)
    expect(
      state?.animations,
      "no animation left on the panel at rest",
    ).toEqual([])
    expect(state?.inlineAnimation).toBe("")
    expect(state?.fromVar).toBe("")
    await expect
      .poll(async () => (await readOverlay(page))?.opacity, {
        timeout: 1000,
        intervals: [50],
      })
      .toBe("1")
    expect((await readOverlay(page))?.state).toBe("open")
    expect(errors).toEqual([])
    report(`mash ending open: ${midSlide}/13 taps landed mid-slide`)
  })

  test("ending CLOSED: both elements gone, the lock and the tint handed back", async ({
    page,
  }) => {
    const errors = collectPageErrors(page)
    const base = await tint(page)
    expect(base, "premise: the page has a theme-color tag").toBeTruthy()
    //the shell holds its own viewport lock app-wide (shell-layout: useFreezeViewport), so
    //`<html>` already reads overflow:hidden at rest — "handed back" means back to that
    const lockBefore = await readLock(page)

    const midSlide = await mash(page, 12, 60)
    expect(
      midSlide,
      "premise: at least one tap landed while the slide was running",
    ).toBeGreaterThan(0)

    await expectUnmounted(page, 1000)
    await expect
      .poll(() => readLock(page), { timeout: 1000, intervals: [50] })
      .toEqual(lockBefore)
    await expect
      .poll(() => tint(page), { timeout: 1000, intervals: [50] })
      .toBe(base)
    expect(errors).toEqual([])
    report(
      `mash ending closed: ${midSlide}/12 taps landed mid-slide; html lock at rest ${JSON.stringify(lockBefore)}`,
    )
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * 2 · a drag started DURING the open slide
 *
 * The bug this found (fixed in the same change, `takeOverPanelForDrag` in drawer-engine.tsx):
 * `commitSheetDrag` and the handle's `handleHandlePointerDown` cleared the panel's `transition`
 * but left the running `pwa-drawer-slide` keyframe in place, and a running animation outranks
 * the inline transform the drag writes every frame. The sheet kept sliding open under a finger
 * that was pulling it down (11 of 11 moves UP on webkit, 9 of 11 on both engines from the
 * handle), then jumped to the finger's offset the instant the keyframe ended. The takeover now
 * reads the painted position, drops the keyframe at that value and measures the finger from
 * there; this case is the failing-before proof and stays as the regression test.
 * ═══════════════════════════════════════════════════════════════════════════ */

const TRAVEL_PX = 160
const STEPS = 12
//the sheet may lag the finger by this much and still count as following it
const LAG_PX = 40

function judgeFollowing(samples: number[], fingerAfterCommit: number) {
  const base = samples[0] ?? Number.NaN
  const last = samples[samples.length - 1] ?? Number.NaN
  let decreases = 0
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1] ?? Number.NaN
    const next = samples[i] ?? Number.NaN
    if (next < prev - 0.5) decreases += 1
  }
  return {
    base,
    last,
    decreases,
    gained: last - base,
    fingerAfterCommit,
  }
}

test.describe("2 · a drag started during the open slide", () => {
  test.describe.configure({ mode: "serial" })

  test("whole-sheet touch drag: the sheet must track the finger, not the curve", async ({
    page,
    context,
    browserName,
  }) => {
    await gotoLab(page)
    const driver = await touchDriver(page, context, browserName)
    await labButton(page, OPEN_BASIC).click()
    const at = await awaitSlideWindow(page, 60, 140)

    const from = await dragPoint(page)
    const yAtStart = (await readTranslateY(page)) ?? Number.NaN
    await driver.start(from)
    const samples: number[] = []
    const slides: string[] = []
    let dragging = ""
    let point = from
    for (let step = 1; step <= STEPS; step += 1) {
      point = { x: from.x, y: from.y + (TRAVEL_PX * step) / STEPS }
      await driver.move(point)
      const state = await readPanel(page)
      samples.push(state?.translateY ?? Number.NaN)
      slides.push(state?.slide?.playState ?? "none")
      if (step === 2) dragging = (await readOverlay(page))?.dragging ?? ""
      await page.waitForTimeout(12)
    }
    const beforeEnd = (await readTranslateY(page)) ?? Number.NaN
    await driver.end(point)
    const rightAfterEnd = (await readTranslateY(page)) ?? Number.NaN
    await page.waitForTimeout(50)
    const laterAfterEnd = (await readTranslateY(page)) ?? Number.NaN

    //premise: the drag really committed (the engine flips the overlay's data-dragging at commit)
    expect(dragging, "premise: the drag committed on the sheet").toBe(
      "true",
    )
    //the first move already clears the 4px slop, so the drag rebases there: the finger travel
    //that should have moved the sheet is everything after move 1
    const perMove = TRAVEL_PX / STEPS
    const fingerAfterCommit = TRAVEL_PX - perMove
    const verdict = judgeFollowing(samples, fingerAfterCommit)
    report(
      `touch drag mid-open (${driver.kind}): slide at ${at.toFixed(0)}ms, y at touchstart ${yAtStart.toFixed(1)}; ` +
        `translateY per move: ${fmt(samples)}; slide per move: ${slides.join(",")}; ` +
        `before touchend ${beforeEnd.toFixed(1)}, right after ${rightAfterEnd.toFixed(1)}, +50ms ${laterAfterEnd.toFixed(1)}`,
    )

    expect(
      verdict.decreases,
      `the sheet moved UP against a finger moving down on ${verdict.decreases} of ${STEPS - 1} moves — translateY per move: ${fmt(samples)}`,
    ).toBe(0)
    expect(
      verdict.gained,
      `by the last move the sheet had gained ${verdict.gained.toFixed(1)}px for ${fingerAfterCommit.toFixed(1)}px of finger — translateY per move: ${fmt(samples)}`,
    ).toBeGreaterThanOrEqual(fingerAfterCommit - LAG_PX)
  })
})

//the handle's mouse path has the same shape (handleHandlePointerDown) and failed the same way —
//in its own group so that the touch verdict cannot skip it
test.describe("2b · a drag started during the open slide, from the handle", () => {
  test.describe.configure({ mode: "serial" })

  test.describe("desktop pointer", () => {
    test.use({ hasTouch: false, isMobile: false })

    test("handle mouse drag: the sheet must track the pointer, not the curve", async ({
      page,
    }) => {
      await gotoLab(page)
      await labButton(page, OPEN_BASIC).click()
      const at = await awaitSlideWindow(page, 60, 140)

      //the handle region, wherever the slide has it right now
      const box = await page.locator(HANDLE).boundingBox()
      if (!box) throw new Error("the drawer handle is not on screen")
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      await page.mouse.move(x, y)
      await page.mouse.down()
      const dragging = (await readOverlay(page))?.dragging ?? ""
      const samples: number[] = []
      const slides: string[] = []
      for (let step = 1; step <= STEPS; step += 1) {
        await page.mouse.move(x, y + (TRAVEL_PX * step) / STEPS)
        const state = await readPanel(page)
        samples.push(state?.translateY ?? Number.NaN)
        slides.push(state?.slide?.playState ?? "none")
        await page.waitForTimeout(12)
      }
      const beforeUp = (await readTranslateY(page)) ?? Number.NaN
      await page.mouse.up()
      const rightAfterUp = (await readTranslateY(page)) ?? Number.NaN
      await page.waitForTimeout(50)
      const laterAfterUp = (await readTranslateY(page)) ?? Number.NaN

      expect(
        dragging,
        "premise: the handle claimed the drag at pointerdown",
      ).toBe("true")
      //the handle path commits at pointerdown, so every move is finger travel
      const verdict = judgeFollowing(
        samples,
        TRAVEL_PX - TRAVEL_PX / STEPS,
      )
      report(
        `handle mouse drag mid-open: slide at ${at.toFixed(0)}ms; translateY per move: ${fmt(samples)}; ` +
          `slide per move: ${slides.join(",")}; before mouseup ${beforeUp.toFixed(1)}, right after ${rightAfterUp.toFixed(1)}, +50ms ${laterAfterUp.toFixed(1)}`,
      )
      expect(
        verdict.decreases,
        `the sheet moved UP against a pointer moving down on ${verdict.decreases} of ${STEPS - 1} moves — translateY per move: ${fmt(samples)}`,
      ).toBe(0)
      expect(
        verdict.gained,
        `by the last move the sheet had gained ${verdict.gained.toFixed(1)}px for ${verdict.fingerAfterCommit.toFixed(1)}px of pointer — translateY per move: ${fmt(samples)}`,
      ).toBeGreaterThanOrEqual(verdict.fingerAfterCommit - LAG_PX)
    })
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * 3 · the viewport resizes while open, and mid-drag
 * ═══════════════════════════════════════════════════════════════════════════ */

test.describe("3 · a viewport resize while open and mid-drag", () => {
  test.describe.configure({ mode: "serial" })

  test("open at rest: the sheet stays glued to the new bottom edge", async ({
    page,
  }) => {
    await gotoLab(page)
    const errors = collectPageErrors(page)
    await labButton(page, OPEN_BASIC).click()
    await settleOpen(page)

    await page.setViewportSize({ width: 390, height: 600 })
    await expect
      .poll(
        async () => {
          const s = await readPanel(page)
          return s
            ? {
                bottomGap: Math.round(Math.abs(s.bottom - 600)),
                y: Math.round(s.translateY),
                viewport: s.viewport,
              }
            : null
        },
        { timeout: 1000, intervals: [50] },
      )
      .toEqual({ bottomGap: 0, y: 0, viewport: 600 })
    expect(errors).toEqual([])
    await page.setViewportSize(PORTRAIT)
  })

  test("mid-drag (finger held): a resize does not steal the drag; a short release snaps to the new bottom", async ({
    page,
    context,
    browserName,
  }) => {
    await gotoLab(page)
    const errors = collectPageErrors(page)
    const driver = await touchDriver(page, context, browserName)
    await page.setViewportSize({ width: 390, height: 600 })
    //the tall sheet: at 700px its closedY is ~680, so 120px of drag stays under the 25% close
    //threshold — the basic sheet is ~230px tall and 80px would already close it
    await labButton(page, OPEN_TALL).click()
    await settleOpen(page)

    const from = await dragPoint(page)
    await driver.start(from)
    let point = from
    for (let step = 1; step <= 8; step += 1) {
      point = { x: from.x, y: from.y + (80 * step) / 8 }
      await driver.move(point)
    }
    expect(
      (await readOverlay(page))?.dragging,
      "premise: the drag committed",
    ).toBe("true")
    const held = (await readTranslateY(page)) ?? Number.NaN
    expect(held).toBeGreaterThan(40)

    await page.setViewportSize({ width: 390, height: 700 })
    await page.waitForTimeout(150)
    const afterResize = await readPanel(page)
    report(
      `mid-drag resize 600→700: held at ${held.toFixed(1)}px, after resize translateY ${afterResize?.translateY.toFixed(1)} bottom ${afterResize?.bottom.toFixed(1)} (viewport ${afterResize?.viewport})`,
    )
    //the finger still owns the transform: the resize must not have snapped the sheet home
    expect(Math.abs((afterResize?.translateY ?? 0) - held)).toBeLessThan(
      10,
    )

    for (let step = 1; step <= 4; step += 1) {
      point = { x: from.x, y: from.y + 80 + (40 * step) / 4 }
      await driver.move(point)
    }
    //held still, so the release reads as a slow short drag rather than a flick
    await page.waitForTimeout(450)
    await driver.end(point)

    await expect
      .poll(
        async () => {
          const s = await readPanel(page)
          return s
            ? {
                y: Math.round(s.translateY),
                bottomGap: Math.round(Math.abs(s.bottom - 700)),
                slide: s.slide !== null,
              }
            : "unmounted"
        },
        { timeout: 2000, intervals: [50] },
      )
      .toEqual({ y: 0, bottomGap: 0, slide: false })
    expect(errors).toEqual([])
    await page.setViewportSize(PORTRAIT)
  })

  test.describe("desktop pointer", () => {
    test.use({ hasTouch: false, isMobile: false })

    test("a landscape swap keeps the tall sheet capped and on the bottom edge, and back", async ({
      page,
    }) => {
      await gotoLab(page)
      const errors = collectPageErrors(page)
      await labButton(page, OPEN_TALL).click()
      await settleOpen(page)

      const readCap = () =>
        page.evaluate(
          ({ panelSel, sheetSel }) => {
            const panel = document.querySelector<HTMLElement>(panelSel)
            const sheet = document.querySelector<HTMLElement>(sheetSel)
            if (!panel || !sheet) return null
            const t = getComputedStyle(panel).transform
            return {
              y: Math.round(
                !t || t === "none" ? 0 : new DOMMatrixReadOnly(t).m42,
              ),
              bottom: Math.round(panel.getBoundingClientRect().bottom),
              height: sheet.getBoundingClientRect().height,
              maxHeight: Number.parseFloat(
                getComputedStyle(sheet).maxHeight,
              ),
              viewport: window.innerHeight,
            }
          },
          { panelSel: PANEL, sheetSel: SHEET },
        )

      await page.setViewportSize({ width: 844, height: 390 })
      await expect
        .poll(readCap, { timeout: 1500, intervals: [50] })
        .toMatchObject({ y: 0, bottom: 390, viewport: 390 })
      const landscape = await readCap()
      report(
        `landscape: sheet ${landscape?.height.toFixed(1)}px, computed max-height ${landscape?.maxHeight.toFixed(1)}px at viewport 390`,
      )
      expect(landscape?.height ?? Number.NaN).toBeLessThanOrEqual(
        (landscape?.maxHeight ?? 0) + 1,
      )

      await page.setViewportSize(PORTRAIT)
      await expect
        .poll(readCap, { timeout: 1500, intervals: [50] })
        .toMatchObject({ y: 0, bottom: 844, viewport: 844 })
      const portrait = await readCap()
      report(
        `back to portrait: sheet ${portrait?.height.toFixed(1)}px, computed max-height ${portrait?.maxHeight.toFixed(1)}px`,
      )
      expect(portrait?.height ?? Number.NaN).toBeLessThanOrEqual(
        (portrait?.maxHeight ?? 0) + 1,
      )
      expect(errors).toEqual([])
    })
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * 4 · navigating away (client-side) mid-open and mid-drag
 *
 * The page is reached from the lab index through a real `Link`, so `history.back()` is a
 * same-document popstate the router answers — a client-side navigation that unmounts the lab
 * page under an open drawer — and `history.forward()` brings it back the same way.
 * ═══════════════════════════════════════════════════════════════════════════ */

test.describe("4 · a client-side navigation away mid-open and mid-drag", () => {
  test.describe.configure({ mode: "serial" })

  async function arriveFromIndex(page: Page) {
    await page.goto("/lab")
    await awaitClientHandover(page)
    await page.locator('a[href="/lab/drawer"]').first().click()
    await labButton(page, OPEN_BASIC).waitFor()
    await expect(page).toHaveURL(/\/lab\/drawer$/)
  }

  async function expectLeftClean(
    page: Page,
    base: string | null,
    lockBefore: Awaited<ReturnType<typeof readLock>>,
  ) {
    await expect(page).toHaveURL(/\/lab$/, { timeout: 1000 })
    await expect(page.locator(PANEL)).toHaveCount(0, { timeout: 1000 })
    await expect(page.locator(OVERLAY)).toHaveCount(0, { timeout: 1000 })
    //the shell's own app-wide lock stays; the drawer's must be gone: back to the baseline
    await expect
      .poll(() => readLock(page), { timeout: 1000, intervals: [50] })
      .toEqual(lockBefore)
    await expect
      .poll(() => tint(page), { timeout: 1000, intervals: [50] })
      .toBe(base)
  }

  test("mid-open: nothing is left in the DOM, the lock and the tint are handed back, and it reopens", async ({
    page,
  }) => {
    const errors = collectPageErrors(page)
    const consoleErrors = collectConsoleErrors(page)
    await arriveFromIndex(page)
    const base = await tint(page)
    expect(base, "premise: the page has a theme-color tag").toBeTruthy()
    const lockBefore = await readLock(page)

    await labButton(page, OPEN_BASIC).click()
    const at = await awaitSlideWindow(page, 1, 300)
    await page.evaluate(() => window.history.back())
    await expectLeftClean(page, base, lockBefore)
    expect(errors).toEqual([])
    report(
      `navigated away with the slide at ${at.toFixed(0)}ms: clean; console errors so far: ${consoleErrors.length}${consoleErrors[0] ? ` (first: ${consoleErrors[0].slice(0, 160)})` : ""}`,
    )

    await page.evaluate(() => window.history.forward())
    await labButton(page, OPEN_BASIC).waitFor()
    await labButton(page, OPEN_BASIC).click()
    await settleOpen(page)
    expect(errors).toEqual([])
  })

  test("mid-drag (finger held): the same, and the late touchend is harmless", async ({
    page,
    context,
    browserName,
  }) => {
    const errors = collectPageErrors(page)
    await arriveFromIndex(page)
    const base = await tint(page)
    const lockBefore = await readLock(page)
    const driver = await touchDriver(page, context, browserName)

    await labButton(page, OPEN_BASIC).click()
    await settleOpen(page)
    const from = await dragPoint(page)
    await driver.start(from)
    let point = from
    for (let step = 1; step <= 8; step += 1) {
      point = { x: from.x, y: from.y + (100 * step) / 8 }
      await driver.move(point)
    }
    expect(
      (await readOverlay(page))?.dragging,
      "premise: the drag committed",
    ).toBe("true")

    await page.evaluate(() => window.history.back())
    await expectLeftClean(page, base, lockBefore)
    //the finger lifts on a page that is gone
    await driver.end(point)
    await page.waitForTimeout(100)
    expect(errors).toEqual([])

    await page.evaluate(() => window.history.forward())
    await labButton(page, OPEN_BASIC).waitFor()
    await labButton(page, OPEN_BASIC).click()
    await settleOpen(page)
    expect(errors).toEqual([])
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * 5 · two drawers
 *
 * The bug this found (fixed in the same change, `drawer-chrome-tint.ts`): the chrome tint was
 * one module-level slot, and every close handed it back to the theme base
 * (transitionDrawerChromeTint at target 0 → restoreChromeTint). Closing the INNER of two open
 * drawers undimmed the toolbar while the outer sheet still dimmed the page (#eeeeec over
 * #797979, both engines). The tint is now a stack keyed on the backdrop: the inner scrim
 * composites over the outer's dim and closing it returns the chrome to that dim. This case is
 * the failing-before proof and stays as the regression test.
 * ═══════════════════════════════════════════════════════════════════════════ */

async function openBoth(page: Page) {
  await labButton(page, OPEN_NESTED).click()
  await settleOpen(page, 0)
  await page
    .locator(PANEL)
    .nth(0)
    .getByRole("button", { name: OPEN_INNER, exact: true })
    .click()
  await expect(page.locator(PANEL)).toHaveCount(2)
  await expect(page.locator(OVERLAY)).toHaveCount(2)
  await settleOpen(page, 1)
}

test.describe("5 · two drawers", () => {
  test.describe.configure({ mode: "serial" })
  test.beforeEach(async ({ page }) => {
    await gotoLab(page)
  })

  test("closing the inner leaves the outer standing — and keeps its tint", async ({
    page,
    context,
    browserName,
  }) => {
    const errors = collectPageErrors(page)
    const driver = await touchDriver(page, context, browserName)
    const lockBefore = await readLock(page)
    const base = await stableTint(page)
    expect(base, "premise: the page has a theme-color tag").toBeTruthy()

    await labButton(page, OPEN_NESTED).click()
    await settleOpen(page, 0)
    const dimmed1 = await stableTint(page)
    expect(
      dimmed1,
      "premise: the outer drawer dimmed the chrome",
    ).not.toBe(base)

    await page
      .locator(PANEL)
      .nth(0)
      .getByRole("button", { name: OPEN_INNER, exact: true })
      .click()
    await expect(page.locator(PANEL)).toHaveCount(2)
    await expect(page.locator(OVERLAY)).toHaveCount(2)
    await settleOpen(page, 1)
    const dimmed2 = await stableTint(page)
    report(
      `tint: base ${base} · outer open ${dimmed1} · inner open ${dimmed2}`,
    )

    //drag the inner sheet a sixth of its height and hold (well under the 25% close
    //threshold — the inner sheet is short): what does the toolbar do while only the inner
    //lightens its own backdrop?
    const innerHeight = (await readPanel(page, 1))?.height ?? Number.NaN
    expect(
      innerHeight,
      "premise: the inner sheet has a height",
    ).toBeGreaterThan(60)
    const pull = Math.round(innerHeight / 6)
    const from = await dragPoint(page, 1)
    await driver.start(from)
    let point = from
    for (let step = 1; step <= 6; step += 1) {
      point = { x: from.x, y: from.y + (pull * step) / 6 }
      await driver.move(point)
    }
    expect(
      (await readOverlay(page, 1))?.dragging,
      "premise: the inner drag committed",
    ).toBe("true")
    const midDrag = await tint(page)
    const innerMidDragY = (await readTranslateY(page, 1)) ?? Number.NaN
    await page.waitForTimeout(450)
    await driver.end(point)
    report(
      `tint: inner mid-drag (y=${innerMidDragY.toFixed(1)} of a ${innerHeight.toFixed(0)}px sheet) ${midDrag}`,
    )
    await settleOpen(page, 1)
    const afterSnap = await stableTint(page)
    report(`tint: inner snapped back ${afterSnap}`)

    //close the inner from its overlay: a tap outside its sheet, above both sheets
    await page
      .locator(OVERLAY)
      .nth(1)
      .click({ position: { x: 195, y: 100 } })
    await expect(page.locator(PANEL)).toHaveCount(1, { timeout: 1500 })
    await expect(page.locator(OVERLAY)).toHaveCount(1)
    await settleOpen(page, 0)
    const afterInnerClose = await stableTint(page)

    report(
      `tint: base ${base} · outer open ${dimmed1} · inner open ${dimmed2} · inner mid-drag (y=${innerMidDragY.toFixed(1)}) ${midDrag} · inner snapped back ${afterSnap} · inner closed, outer still open ${afterInnerClose}`,
    )

    expect(
      afterInnerClose,
      `with the outer drawer still open the chrome must stay dimmed (${dimmed1}), not return to the base (${base})`,
    ).toBe(dimmed1)

    //then the outer: everything handed back
    await page
      .locator(OVERLAY)
      .nth(0)
      .click({ position: { x: 195, y: 100 } })
    await expectUnmounted(page, 2000)
    await expect
      .poll(() => tint(page), { timeout: 1500, intervals: [50] })
      .toBe(base)
    await expect.poll(() => readLock(page)).toEqual(lockBefore)
    expect(errors).toEqual([])
  })
})

//in its own group: a tint verdict above must not skip this one
test.describe("5b · two drawers and the back chain", () => {
  test.describe.configure({ mode: "serial" })
  test.beforeEach(async ({ page }) => {
    await gotoLab(page)
  })

  test("a back press closes the inner first, then the outer", async ({
    page,
  }) => {
    //`window.__adaptvBack` is the seam every LabPage installs: `adaptvBack()` itself, the exact
    //call the Android listener makes (back-chain.spec.ts). Browser history is not the chain.
    const errors = collectPageErrors(page)
    await openBoth(page)
    const pressBack = () =>
      page.evaluate(() => {
        const back = (
          window as unknown as { __adaptvBack?: () => boolean }
        ).__adaptvBack
        if (!back)
          throw new Error("no window.__adaptvBack — is this a LabPage?")
        return back()
      })

    expect(await pressBack(), "the inner drawer consumes the press").toBe(
      true,
    )
    await expect(page.locator(PANEL)).toHaveCount(1, { timeout: 1500 })
    await settleOpen(page, 0)
    await expect(page).toHaveURL(/\/lab\/drawer$/)

    expect(await pressBack(), "the outer drawer consumes the press").toBe(
      true,
    )
    await expectUnmounted(page, 2000)
    await expect(page).toHaveURL(/\/lab\/drawer$/)
    expect(errors).toEqual([])
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * 6 · 200 open/close cycles — a leak check (chromium, one worker)
 * ═══════════════════════════════════════════════════════════════════════════ */

test.describe("6 · 200 open/close cycles", () => {
  test.describe.configure({ mode: "serial" })
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "performance.memory and HeapProfiler.collectGarbage are chromium-only",
  )

  const CYCLES = 200
  const SAMPLE_AT = [20, 100, 200]

  type Probe = {
    listeners: Record<string, number>
    listenerDetail: Record<string, Record<string, number>>
    rafCount: number
    liveIntervals: number
    nodes: number
    documentAnimations: number
  }

  test("DOM, listeners, animations and heap plateau across cycles", async ({
    page,
  }) => {
    test.setTimeout(15 * 60_000)
    await page.addInitScript(() => {
      //live listener registry for the three global targets — adds minus removes, deduplicated
      //the way addEventListener itself deduplicates (same type + callback + capture)
      const registry = new Map<string, Map<string, Set<unknown>>>()
      const nameOf = (target: unknown) =>
        target === window
          ? "window"
          : target === document
            ? "document"
            : target === document.body
              ? "body"
              : null
      const capture = (options: unknown) =>
        typeof options === "boolean"
          ? options
          : Boolean(
              (options as { capture?: boolean } | undefined)?.capture,
            )
      const add = EventTarget.prototype.addEventListener
      const remove = EventTarget.prototype.removeEventListener
      EventTarget.prototype.addEventListener = function (
        this: EventTarget,
        type: string,
        listener: unknown,
        options?: unknown,
      ) {
        const name = nameOf(this)
        if (name && listener) {
          const key = `${type}${capture(options) ? "!capture" : ""}`
          let byType = registry.get(name)
          if (!byType) {
            byType = new Map()
            registry.set(name, byType)
          }
          let set = byType.get(key)
          if (!set) {
            set = new Set()
            byType.set(key, set)
          }
          set.add(listener)
        }
        return add.call(
          this,
          type,
          listener as EventListenerOrEventListenerObject,
          options as AddEventListenerOptions | boolean | undefined,
        )
      }
      EventTarget.prototype.removeEventListener = function (
        this: EventTarget,
        type: string,
        listener: unknown,
        options?: unknown,
      ) {
        const name = nameOf(this)
        if (name && listener) {
          const key = `${type}${capture(options) ? "!capture" : ""}`
          registry.get(name)?.get(key)?.delete(listener)
        }
        return remove.call(
          this,
          type,
          listener as EventListenerOrEventListenerObject,
          options as EventListenerOptions | boolean | undefined,
        )
      }
      let rafCount = 0
      const raf = window.requestAnimationFrame
      window.requestAnimationFrame = (cb) => {
        rafCount += 1
        return raf.call(window, cb)
      }
      const intervals = new Set<number>()
      const setInt = window.setInterval
      const clearInt = window.clearInterval
      window.setInterval = ((...args: Parameters<typeof setInterval>) => {
        const id = setInt.apply(window, args) as unknown as number
        intervals.add(id)
        return id
      }) as typeof window.setInterval
      window.clearInterval = ((id?: number) => {
        if (id !== undefined) intervals.delete(id)
        return clearInt.call(window, id)
      }) as typeof window.clearInterval
      ;(window as unknown as { __probe: () => unknown }).__probe = () => {
        const listeners: Record<string, number> = {}
        const listenerDetail: Record<string, Record<string, number>> = {}
        for (const name of ["window", "document", "body"]) {
          const byType = registry.get(name)
          let total = 0
          const detail: Record<string, number> = {}
          if (byType) {
            for (const [key, set] of byType) {
              if (set.size > 0) detail[key] = set.size
              total += set.size
            }
          }
          listeners[name] = total
          listenerDetail[name] = detail
        }
        return {
          listeners,
          listenerDetail,
          rafCount,
          liveIntervals: intervals.size,
          nodes: document.querySelectorAll("*").length,
          documentAnimations: document.getAnimations().length,
        }
      }
    })
    await gotoLab(page)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("HeapProfiler.enable")

    const probe = () =>
      page.evaluate(() =>
        (window as unknown as { __probe: () => Probe }).__probe(),
      )
    const heap = async () => {
      const reads: number[] = []
      for (let i = 0; i < 3; i += 1) {
        await cdp.send("HeapProfiler.collectGarbage")
        reads.push(
          await page.evaluate(
            () =>
              (
                performance as unknown as {
                  memory: { usedJSHeapSize: number }
                }
              ).memory.usedJSHeapSize,
          ),
        )
      }
      return Math.min(...reads)
    }

    const rest: Record<number, Probe> = {}
    const heaps: Record<number, number> = {}
    const openPanelAnimations: Record<number, number> = {}
    const openDocumentAnimations: Record<number, number> = {}
    rest[0] = await probe()
    heaps[0] = await heap()

    for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
      await labButton(page, OPEN_BASIC).dispatchEvent("click")
      await settleOpen(page)
      if (SAMPLE_AT.includes(cycle)) {
        const state = await readPanel(page)
        openPanelAnimations[cycle] = state?.animations.length ?? -1
        openDocumentAnimations[cycle] = (await probe()).documentAnimations
      }
      await sheetClose(page).dispatchEvent("click")
      await expectUnmounted(page)
      if (SAMPLE_AT.includes(cycle)) {
        rest[cycle] = await probe()
        heaps[cycle] = await heap()
      }
    }

    const row = (c: number) => {
      const p = rest[c]
      return `cycle ${c}: nodes ${p?.nodes} · listeners window ${p?.listeners.window} document ${p?.listeners.document} body ${p?.listeners.body} · live intervals ${p?.liveIntervals} · rAF total ${p?.rafCount} · document animations at rest ${p?.documentAnimations} · heap ${((heaps[c] ?? 0) / 1024 / 1024).toFixed(2)} MB`
    }
    for (const c of [0, ...SAMPLE_AT]) report(row(c))
    for (const c of SAMPLE_AT) {
      report(
        `cycle ${c} at open rest: panel animations ${openPanelAnimations[c]} · document animations ${openDocumentAnimations[c]}`,
      )
    }
    report(
      `listener detail at 200: ${JSON.stringify(rest[200]?.listenerDetail)}`,
    )
    if (
      JSON.stringify(rest[20]?.listenerDetail) !==
      JSON.stringify(rest[200]?.listenerDetail)
    ) {
      report(
        `listener detail at 20: ${JSON.stringify(rest[20]?.listenerDetail)}`,
      )
    }

    //the lab log caps itself at 40 entries, and 20 cycles already fill it: from there on the
    //page at rest must be the same page
    expect(
      rest[100]?.nodes,
      "DOM node count at rest, cycle 100 vs 20",
    ).toBe(rest[20]?.nodes)
    expect(
      rest[200]?.nodes,
      "DOM node count at rest, cycle 200 vs 20",
    ).toBe(rest[20]?.nodes)
    expect(
      rest[100]?.listeners,
      "listeners at rest, cycle 100 vs 20",
    ).toEqual(rest[20]?.listeners)
    expect(
      rest[200]?.listeners,
      "listeners at rest, cycle 200 vs 20",
    ).toEqual(rest[20]?.listeners)
    expect(rest[200]?.liveIntervals).toBe(rest[20]?.liveIntervals)
    for (const c of SAMPLE_AT) {
      expect(
        openPanelAnimations[c],
        `panel animations at open rest, cycle ${c}`,
      ).toBe(0)
      expect(
        rest[c]?.documentAnimations,
        `document animations at closed rest, cycle ${c}`,
      ).toBe(rest[0]?.documentAnimations)
    }
    const early = (heaps[100] ?? 0) - (heaps[20] ?? 0)
    const late = (heaps[200] ?? 0) - (heaps[100] ?? 0)
    report(
      `heap growth 20→100: ${(early / 1024).toFixed(0)} KB · 100→200: ${(late / 1024).toFixed(0)} KB`,
    )
    expect(
      late < early || late < 1024 * 1024,
      `heap keeps growing: 20→100 ${(early / 1024).toFixed(0)} KB, 100→200 ${(late / 1024).toFixed(0)} KB`,
    ).toBe(true)
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * 7 · CPU throttle ×4 (chromium)
 * ═══════════════════════════════════════════════════════════════════════════ */

test.describe("7 · the open under a 4x CPU throttle", () => {
  test.describe.configure({ mode: "serial" })
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Emulation.setCPUThrottlingRate is a CDP command",
  )

  type Frame = { t: number; y: number; running: boolean }

  test("arrives monotonically, on time, and settles clean; the close unmounts", async ({
    page,
  }) => {
    await gotoLab(page)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
    try {
      //a rAF sampler armed BEFORE the tap: every frame from the panel's first paint until it
      //rests three frames at 0 (or 2.5s after the first frame)
      const sampling = page.evaluate(
        ({ sel, slide }) =>
          new Promise<Frame[]>((resolve) => {
            const frames: Frame[] = []
            let restFrames = 0
            let first = 0
            function tick(now: number) {
              const panel = document.querySelector<HTMLElement>(sel)
              if (panel) {
                if (!first) first = now
                const t = getComputedStyle(panel).transform
                const y =
                  !t || t === "none" ? 0 : new DOMMatrixReadOnly(t).m42
                const running = panel
                  .getAnimations()
                  .some(
                    (a) =>
                      (a as { animationName?: string }).animationName ===
                        slide && a.playState === "running",
                  )
                frames.push({ t: now - first, y, running })
                restFrames = Math.abs(y) <= 0.5 ? restFrames + 1 : 0
                if (restFrames >= 3 || now - first > 2500) {
                  resolve(frames)
                  return
                }
              } else if (first) {
                resolve(frames)
                return
              }
              requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          }),
        { sel: PANEL, slide: SLIDE },
      )
      await labButton(page, OPEN_BASIC).click()
      const frames = await sampling

      expect(
        frames.length,
        "premise: frames were sampled",
      ).toBeGreaterThan(5)
      const ys = frames.map((f) => f.y)
      const travel = (ys[0] ?? 0) - (ys[ys.length - 1] ?? 0)
      expect(travel, "premise: the sheet travelled").toBeGreaterThan(50)
      expect(
        frames.some((f) => f.running),
        "premise: the slide keyframe ran",
      ).toBe(true)
      const intervals = frames
        .slice(1)
        .map((f, i) => f.t - (frames[i]?.t ?? 0))
      const sortedIntervals = [...intervals].sort((a, b) => a - b)
      const p90 =
        sortedIntervals[Math.floor(sortedIntervals.length * 0.9)] ??
        Number.NaN
      const settledAt = frames[frames.length - 1]?.t ?? Number.NaN
      report(
        `4x throttle open: ${frames.length} frames, settled at ${settledAt.toFixed(0)}ms, frame interval median ${median(intervals).toFixed(1)}ms p90 ${p90.toFixed(1)}ms max ${Math.max(...intervals).toFixed(1)}ms; y per frame: ${fmt(ys)}`,
      )

      expect(
        Math.abs(ys[ys.length - 1] ?? Number.NaN),
        "the sheet rested at 0 inside the sampling budget",
      ).toBeLessThanOrEqual(0.5)
      expect(settledAt, "settled within 2s").toBeLessThanOrEqual(2000)
      const regressions: string[] = []
      const jumps: string[] = []
      for (let i = 1; i < ys.length; i += 1) {
        const prev = ys[i - 1] ?? 0
        const next = ys[i] ?? 0
        if (next > prev + 0.5)
          regressions.push(`${prev.toFixed(1)}→${next.toFixed(1)}`)
        if (i >= 2 && prev - next > 0.4 * travel)
          jumps.push(`${prev.toFixed(1)}→${next.toFixed(1)}`)
      }
      expect(
        regressions,
        "frames where the sheet moved back DOWN",
      ).toEqual([])
      expect(
        jumps,
        "frames that jumped more than 40% of the travel",
      ).toEqual([])

      await settleOpen(page, 0, 2000)
      const state = await readPanel(page)
      expect(state?.inlineAnimation).toBe("")
      expect(state?.fromVar).toBe("")
      expect(
        Math.abs(state?.translateY ?? Number.NaN),
      ).toBeLessThanOrEqual(0.5)

      await sheetClose(page).click()
      await expectUnmounted(page, 2000)
    } finally {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })
    }
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * 8 · prefers-reduced-motion — a FINDING, not a verdict
 * ═══════════════════════════════════════════════════════════════════════════ */

test.describe("8 · prefers-reduced-motion", () => {
  test.describe.configure({ mode: "serial" })

  test("still opens and closes; whether the slide and the fade still run is reported", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await gotoLab(page)
    expect(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
      "premise: the page sees reduced motion",
    ).toBe(true)

    const watching = page.evaluate(
      ({ panelSel, overlaySel, slide }) =>
        new Promise<{
          slideRan: boolean
          overlayAnimations: string[]
          overlayFirstOpacity: string | null
          frames: number
        }>((resolve) => {
          let frames = 0
          let slideRan = false
          const overlayAnimations = new Set<string>()
          let overlayFirstOpacity: string | null = null
          function tick() {
            frames += 1
            const panel = document.querySelector<HTMLElement>(panelSel)
            const overlay = document.querySelector<HTMLElement>(overlaySel)
            if (panel) {
              if (
                panel
                  .getAnimations()
                  .some(
                    (a) =>
                      (a as { animationName?: string }).animationName ===
                      slide,
                  )
              )
                slideRan = true
            }
            if (overlay) {
              if (overlayFirstOpacity === null)
                overlayFirstOpacity = getComputedStyle(overlay).opacity
              for (const a of overlay.getAnimations()) {
                overlayAnimations.add(
                  (a as { animationName?: string }).animationName ??
                    `transition:${(a as { transitionProperty?: string }).transitionProperty}`,
                )
              }
            }
            if (frames < 40) requestAnimationFrame(tick)
            else
              resolve({
                slideRan,
                overlayAnimations: [...overlayAnimations],
                overlayFirstOpacity,
                frames,
              })
          }
          requestAnimationFrame(tick)
        }),
      { panelSel: PANEL, overlaySel: OVERLAY, slide: SLIDE },
    )
    await labButton(page, OPEN_BASIC).click()
    const seen = await watching
    await settleOpen(page)
    const overlay = await readOverlay(page)
    report(
      `reduced motion: panel slide keyframe ran=${seen.slideRan}; overlay animations seen=${JSON.stringify(seen.overlayAnimations)}; overlay first-frame opacity=${seen.overlayFirstOpacity}; overlay at rest opacity=${overlay?.opacity}`,
    )
    await sheetClose(page).click()
    await expectUnmounted(page)
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * 9 · the content resizes while open
 * ═══════════════════════════════════════════════════════════════════════════ */

test.describe("9 · the content resizes while open", () => {
  test.describe.configure({ mode: "serial" })

  const GROW_PX = 300

  function readGeometry(page: Page) {
    return page.evaluate(
      ({ panelSel, sheetSel, tailSel }) => {
        const panel = document.querySelector<HTMLElement>(panelSel)
        const sheet = document.querySelector<HTMLElement>(sheetSel)
        const tail = document.querySelector<HTMLElement>(tailSel)
        if (!panel || !sheet || !tail) return null
        const t = getComputedStyle(panel).transform
        const box = panel.getBoundingClientRect()
        return {
          y: !t || t === "none" ? 0 : new DOMMatrixReadOnly(t).m42,
          panelBottom: box.bottom,
          sheetTop: sheet.getBoundingClientRect().top,
          sheetHeight: sheet.getBoundingClientRect().height,
          tailGap: tail.getBoundingClientRect().top - box.bottom,
          viewport: window.innerHeight,
        }
      },
      { panelSel: PANEL, sheetSel: SHEET, tailSel: TAIL },
    )
  }

  const setGrowth = (page: Page, px: number | null) =>
    page.evaluate(
      ({ shellSel, px }) => {
        const shell = document.querySelector<HTMLElement>(shellSel)
        if (!shell) throw new Error("no Drawer.Shell in the sheet")
        shell.querySelector("[data-stress-growth]")?.remove()
        if (px === null) return
        const block = document.createElement("div")
        block.setAttribute("data-stress-growth", "")
        block.style.height = `${px}px`
        block.textContent = "an image that just loaded"
        shell.appendChild(block)
      },
      { shellSel: SHELL, px },
    )

  /** The panel's geometry on its last frame before it leaves the DOM, sampled per rAF. */
  function lastFrameBeforeUnmount(page: Page) {
    return page.evaluate(
      (sel) =>
        new Promise<{ top: number; y: number; viewport: number } | null>(
          (resolve) => {
            let last: { top: number; y: number; viewport: number } | null =
              null
            const started = performance.now()
            function tick() {
              const panel = document.querySelector<HTMLElement>(sel)
              if (!panel || performance.now() - started > 5000) {
                resolve(last)
                return
              }
              const t = getComputedStyle(panel).transform
              last = {
                top: panel.getBoundingClientRect().top,
                y: !t || t === "none" ? 0 : new DOMMatrixReadOnly(t).m42,
                viewport: window.innerHeight,
              }
              requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          },
        ),
      PANEL,
    )
  }

  async function expectGlued(
    page: Page,
    expectedSheetTop: number,
    label: string,
  ) {
    await expect
      .poll(
        async () => {
          const g = await readGeometry(page)
          return g
            ? {
                bottomGap: Math.round(
                  Math.abs(g.panelBottom - g.viewport),
                ),
                y: Math.round(g.y),
                topDrift: Math.round(
                  Math.abs(g.sheetTop - expectedSheetTop),
                ),
                tailGap: Math.round(Math.abs(g.tailGap)),
              }
            : "unmounted"
        },
        { timeout: 500, intervals: [30], message: label },
      )
      .toEqual({ bottomGap: 0, y: 0, topDrift: 0, tailGap: 0 })
  }

  async function closeAndReadLastFrame(page: Page) {
    const lastFrame = lastFrameBeforeUnmount(page)
    await sheetClose(page).dispatchEvent("click")
    const last = await lastFrame
    await expectUnmounted(page)
    if (!last) throw new Error("no frame of the closing panel was sampled")
    return last
  }

  test("growing by 300px: the sheet grows upward, stays on the edge, and closes fully off-screen", async ({
    page,
  }) => {
    await gotoLab(page)
    await labButton(page, OPEN_BASIC).click()
    await settleOpen(page)
    //let the settle's own tidy-up land before the resize
    await page.waitForTimeout(100)
    const before = await readGeometry(page)
    if (!before) throw new Error("the sheet is not on screen")

    await setGrowth(page, GROW_PX)
    await expectGlued(page, before.sheetTop - GROW_PX, "after growing")
    const grown = await readGeometry(page)
    report(
      `grow +${GROW_PX}: sheet top ${before.sheetTop.toFixed(1)} → ${grown?.sheetTop.toFixed(1)}, height ${before.sheetHeight.toFixed(1)} → ${grown?.sheetHeight.toFixed(1)}, y ${grown?.y.toFixed(2)}, tail gap ${grown?.tailGap.toFixed(2)}`,
    )

    const last = await closeAndReadLastFrame(page)
    report(
      `close after growing: last frame top ${last.top.toFixed(1)} (viewport ${last.viewport}), y ${last.y.toFixed(1)}`,
    )
    expect(
      last.top,
      "the panel's last painted frame must be fully below the viewport",
    ).toBeGreaterThanOrEqual(last.viewport - 1)
  })

  test("shrinking by 300px: the reverse, and the close still ends off-screen", async ({
    page,
  }) => {
    await gotoLab(page)
    await labButton(page, OPEN_BASIC).click()
    await settleOpen(page)
    await page.waitForTimeout(100)
    const before = await readGeometry(page)
    if (!before) throw new Error("the sheet is not on screen")
    await setGrowth(page, GROW_PX)
    await expectGlued(page, before.sheetTop - GROW_PX, "after growing")

    await setGrowth(page, null)
    await expectGlued(page, before.sheetTop, "after shrinking")
    const shrunk = await readGeometry(page)
    report(
      `shrink -${GROW_PX}: sheet top back to ${shrunk?.sheetTop.toFixed(1)} (was ${before.sheetTop.toFixed(1)}), y ${shrunk?.y.toFixed(2)}, tail gap ${shrunk?.tailGap.toFixed(2)}`,
    )

    const last = await closeAndReadLastFrame(page)
    report(
      `close after shrinking: last frame top ${last.top.toFixed(1)} (viewport ${last.viewport}), y ${last.y.toFixed(1)}`,
    )
    expect(last.top).toBeGreaterThanOrEqual(last.viewport - 1)
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * 10 · a scroller inside the sheet, racing the drag-to-close (chromium: native scroll)
 * ═══════════════════════════════════════════════════════════════════════════ */

test.describe("10 · the nested scroller at its top edge racing a drag-to-close", () => {
  test.describe.configure({ mode: "serial" })
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "the scroller has to scroll under the finger — only CDP touch drives native scrolling",
  )

  function readScroller(page: Page) {
    return page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel)
      if (!el) return null
      return {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      }
    }, SCROLLER)
  }

  async function dragSampled(
    page: Page,
    driver: TouchDriver,
    from: Point,
    dy: number,
    steps: number,
    holdMs = 0,
  ) {
    await driver.start(from)
    const ys: number[] = []
    const scrollTops: number[] = []
    let point = from
    for (let step = 1; step <= steps; step += 1) {
      point = { x: from.x, y: from.y + (dy * step) / steps }
      await driver.move(point)
      ys.push((await readTranslateY(page)) ?? Number.NaN)
      scrollTops.push((await readScroller(page))?.scrollTop ?? Number.NaN)
    }
    if (holdMs > 0) await page.waitForTimeout(holdMs)
    await driver.end(point)
    return { ys, scrollTops }
  }

  test("a gesture that began mid-scroll never becomes a dismiss; a fresh one does; an upward one scrolls", async ({
    page,
    context,
    browserName,
  }) => {
    await gotoLab(page)
    const driver = await touchDriver(page, context, browserName)
    await labButton(page, OPEN_SCROLLING).click()
    await settleOpen(page)

    const scroller = await readScroller(page)
    expect(
      (scroller?.scrollHeight ?? 0) > (scroller?.clientHeight ?? 0),
      "premise: the scrolling drawer's content overflows its 70dvh cap",
    ).toBe(true)
    await page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel)
      if (el) el.scrollTop = el.scrollHeight
    }, SCROLLER)
    const atBottom = (await readScroller(page))?.scrollTop ?? 0
    expect(
      atBottom,
      "premise: the scroller is scrolled down",
    ).toBeGreaterThan(100)

    //one continuous gesture: 400px down in 25 moves — the scroller comes back to its top
    //part-way through and must NOT hand the rest of the gesture to the sheet
    const from = await dragPoint(page)
    const first = await dragSampled(page, driver, from, 400, 25)
    report(
      `gesture from scrollTop ${atBottom.toFixed(0)}: translateY per move ${fmt(first.ys)}; scrollTop per move ${fmt(first.scrollTops)}`,
    )
    expect(
      Math.min(...first.scrollTops),
      "premise: the scroller scrolled back toward its top under the finger",
    ).toBeLessThan(atBottom - 50)
    const moved = first.ys.filter((y) => Math.abs(y) > 1)
    expect(
      moved,
      `the sheet moved during a gesture that began mid-scroll — translateY per move: ${fmt(first.ys)}`,
    ).toEqual([])
    await expect(page.locator(PANEL)).toHaveCount(1)

    //a NEW gesture from the top: the sheet follows and a long one closes it
    await page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel)
      if (el) el.scrollTop = 0
    }, SCROLLER)
    expect((await readScroller(page))?.scrollTop).toBe(0)
    const second = await dragSampled(
      page,
      driver,
      await dragPoint(page),
      200,
      25,
    )
    report(
      `fresh gesture from the top: translateY per move ${fmt(second.ys)}`,
    )
    expect(
      second.ys[second.ys.length - 1] ?? Number.NaN,
    ).toBeGreaterThanOrEqual(150)
    await expectUnmounted(page)

    //reopen, and pull UP from the top: the content scrolls, the sheet never moves
    await labButton(page, OPEN_SCROLLING).click()
    await settleOpen(page)
    expect((await readScroller(page))?.scrollTop).toBe(0)
    const third = await dragSampled(
      page,
      driver,
      await dragPoint(page),
      -100,
      25,
    )
    const after = await readScroller(page)
    report(
      `upward pull from the top: translateY per move ${fmt(third.ys)}; scrollTop after ${after?.scrollTop.toFixed(1)}`,
    )
    expect(
      third.ys.filter((y) => Math.abs(y) > 1),
      `the sheet moved on an upward pull that belongs to the content — ${fmt(third.ys)}`,
    ).toEqual([])
    expect(
      after?.scrollTop ?? 0,
      "premise: the upward pull scrolled the content",
    ).toBeGreaterThan(0)
    expect(Math.round((await readTranslateY(page)) ?? Number.NaN)).toBe(0)
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * 11 · disableDrag flipped mid-gesture — not drivable from the lab
 * ═══════════════════════════════════════════════════════════════════════════ */

test.describe("11 · disableDrag flipped mid-gesture", () => {
  test("REPORT: not testable from the lab", async () => {
    test.skip(
      true,
      "the lab's section 5 drawer has disableDrag fixed at mount and no drawer exposes a live toggle (the Task drawer neither); the prop is designed to flip live but nothing on /lab/drawer flips it",
    )
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
 * 12 · touchcancel mid-drag
 * ═══════════════════════════════════════════════════════════════════════════ */

test.describe("12 · a touchcancel mid-drag", () => {
  test.describe.configure({ mode: "serial" })

  test("snaps the sheet back, frees the overlay's drag state, and the next drag works", async ({
    page,
    context,
    browserName,
  }) => {
    await gotoLab(page)
    const errors = collectPageErrors(page)
    const driver = await touchDriver(page, context, browserName)
    await labButton(page, OPEN_BASIC).click()
    await settleOpen(page)

    const from = await dragPoint(page)
    await driver.start(from)
    let point = from
    for (let step = 1; step <= 5; step += 1) {
      point = { x: from.x, y: from.y + (120 * step) / 5 }
      await driver.move(point)
    }
    expect(
      (await readOverlay(page))?.dragging,
      "premise: the drag committed",
    ).toBe("true")
    const beforeCancel = (await readTranslateY(page)) ?? Number.NaN
    expect(
      beforeCancel,
      "premise: the sheet followed the drag",
    ).toBeGreaterThan(120 - 120 / 5 - SLOP_PX - 10)

    await driver.cancel(point)
    await expect
      .poll(
        async () => {
          const y = await readTranslateY(page)
          return y === null ? "unmounted" : Math.abs(y) <= REST_PX
        },
        { timeout: 600, intervals: [30] },
      )
      .toBe(true)
    expect((await readOverlay(page))?.dragging).toBe("false")
    report(
      `touchcancel (${driver.kind}) at translateY ${beforeCancel.toFixed(1)}: snapped back within 600ms`,
    )

    //and the sheet is not left deaf: a following short drag moves it and snaps back
    await settleOpen(page)
    const again = await dragPoint(page)
    await driver.start(again)
    let last = again
    const ys: number[] = []
    for (let step = 1; step <= 8; step += 1) {
      last = { x: again.x, y: again.y + (48 * step) / 8 }
      await driver.move(last)
      ys.push((await readTranslateY(page)) ?? Number.NaN)
    }
    await page.waitForTimeout(450)
    await driver.end(last)
    expect(
      Math.max(...ys),
      `the next drag did not move the sheet — ${fmt(ys)}`,
    ).toBeGreaterThan(20)
    await settleOpen(page)
    await expect(page.locator(PANEL)).toHaveCount(1)
    expect(errors).toEqual([])
  })
})

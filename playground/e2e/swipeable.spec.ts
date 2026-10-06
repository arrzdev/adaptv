import type { CDPSession, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Swipeable rows, measured with real touch.
 *
 * The whole component is one promise — the row follows the finger, opens and
 * closes at a threshold, and NEVER steals a vertical scroll that started on it.
 * Every failure mode is a variation on it letting go of, or grabbing, the wrong
 * gesture. None of that is reachable with synthetic events: `dispatchEvent(new
 * TouchEvent())` never drives native scrolling and cannot fire the browser's own
 * touch-slop arbitration, which is precisely the thing under test. So this pins
 * it with CDP `Input.dispatchTouchEvent`, the same instrument scroll-axis and
 * press-visual use.
 *
 * ⚠︎ chromium-only. That is the Android WebView engine, so a pass here is a real
 * target — but WKWebView (iOS) is a different engine and stays a manual sim walk
 * (the left-edge-back vs. row-open case in particular is WebKit-only).
 */

//`hasTouch` on the CONTEXT, set before the first navigation — bolting touch
//emulation on after the page exists races the renderer, and the touch points then
//reach native listeners but never React, so the whole engine reads as dead. The
//PORTRAIT viewport is not cosmetic either: a touch context at a desktop landscape
//size trips the app's rotate guard (a full-viewport fixed sheet), every touch
//lands on the guard, and every test reads like a frozen row.
test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

const ROOT = "[data-swipeable-root]"
const CONTENT = "[data-swipeable-content]"
const LOG = "[data-lab-log] li"
//the group rows (first/second/third) then the standalone photo row
const PHOTO_ROW = 3
const TOLERANCE_PX = 8

async function touch(
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  point?: { x: number; y: number },
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: point ? [point] : [],
  })
}

/** Content translateX in px, from the COMPUTED matrix — the engine clears the
 *  inline transform to "" on settle, so a closed row reads a clean 0 here. */
function contentX(page: Page, index: number) {
  return page.evaluate(
    ([sel, i]) => {
      const el = document.querySelectorAll(sel as string)[i as number]
      if (!el) return Number.NaN
      const t = getComputedStyle(el).transform
      if (t === "none") return 0
      return new DOMMatrixReadOnly(t).m41
    },
    [CONTENT, index] as const,
  )
}

/** The page's own scroller is adaptv's ScrollView, not the document. */
function pageScroll(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector("[data-scroll-view='y']")
    return el ? el.scrollTop : window.scrollY
  })
}

const logTexts = (page: Page) => page.locator(LOG).allInnerTexts()

/*
 * Aim at a row's content centre, re-measured every time. `boundingBox()` is
 * viewport-relative and this page scrolls inside a ScrollView whose layout shifts
 * as the log mounts, so a cached point drifts off the row and CDP input — which
 * has no actionability check — lands on empty space, failing exactly like a dead
 * engine. `elementFromPoint` is the only thing that can tell a stale measurement
 * from a real regression.
 */
async function aim(page: Page, index: number) {
  const content = page.locator(CONTENT).nth(index)
  await content.scrollIntoViewIfNeeded()

  let previous = -1
  let box = await content.boundingBox()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (box && Math.round(box.y) === previous) break
    previous = box ? Math.round(box.y) : -1
    await page.waitForTimeout(50)
    box = await content.boundingBox()
  }
  if (!box) throw new Error(`row ${index} has no layout box`)

  const point = {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  }
  const onTarget = await page.evaluate(
    ([x, y, sel]) =>
      !!document
        .elementFromPoint(x as number, y as number)
        ?.closest(sel as string),
    [point.x, point.y, ROOT] as const,
  )
  if (!onTarget) {
    throw new Error(
      `touch point ${point.x},${point.y} misses row ${index} — stale measurement, not a broken row`,
    )
  }
  return { box, point }
}

/** Drive a horizontal drag from a row's centre by `dx` (negative = leftward =
 *  reveal RIGHT actions). `steps` sub-moves; `settleMs` before release lets the
 *  velocity window read ~0 so position, not a stray flick, decides the outcome. */
async function dragH(
  page: Page,
  cdp: CDPSession,
  index: number,
  dx: number,
  { settleMs = 140 }: { settleMs?: number } = {},
) {
  const { point } = await aim(page, index)
  await touch(cdp, "touchStart", point)
  const steps = 12
  for (let s = 1; s <= steps; s += 1) {
    await touch(cdp, "touchMove", {
      x: Math.round(point.x + (dx * s) / steps),
      y: point.y,
    })
  }
  await page.waitForTimeout(settleMs)
  await touch(cdp, "touchEnd")
  await page.waitForTimeout(320)
}

/** Release any open row the way a user does — a tap in neutral header space, which
 *  fires the component's outside-pointerup dismiss. */
async function closeAll(page: Page, cdp: CDPSession) {
  await touch(cdp, "touchStart", { x: 40, y: 130 })
  await touch(cdp, "touchEnd")
  await page.waitForTimeout(280)
}

// this used to carry `retries: 2`, charged to "a slow frame under many parallel
// workers". No retries now: the components are deterministic, and if real-touch
// timing here ever genuinely loses to load, that is worth seeing on the first run
// rather than absorbing — a retry that hides a load problem hides a real one just
// as well, which is exactly how the hydration race in this suite survived.
test.describe("Swipeable rows under real touch", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "needs CDP touch injection — synthetic events do not drive native gestures",
  )

  async function setup(page: Page) {
    const cdp = await page.context().newCDPSession(page)
    await page.goto("/lab/swipeable")
    await awaitClientHandover(page)
    await page.locator(ROOT).first().waitFor()
    await page.locator(CONTENT).nth(PHOTO_ROW).waitFor()

    /*
     * Warm up until a drag demonstrably moves a row, rather than sleeping a
     * guessed interval. The FIRST synthetic gesture on a freshly loaded page is
     * reproducibly swallowed in this harness (also with raw mouse input — no app
     * code can suppress a native listener). A sub-threshold nudge that actually
     * shifts the content is a positive signal input is landing; it fails loudly if
     * it never does instead of leaving a vacuously-green suite.
     */
    let live = false
    for (let attempt = 0; attempt < 6 && !live; attempt += 1) {
      const { point } = await aim(page, 0)
      await touch(cdp, "touchStart", point)
      for (let s = 1; s <= 6; s += 1) {
        await touch(cdp, "touchMove", { x: point.x - s * 3, y: point.y })
      }
      await page.waitForTimeout(120)
      live = Math.abs(await contentX(page, 0)) > 4
      await touch(cdp, "touchEnd")
      await page.waitForTimeout(300)
    }
    if (!live) {
      throw new Error(
        "no row responded to touch — input is not reaching the page",
      )
    }
    await closeAll(page, cdp)
    return { cdp }
  }

  test("the row tracks the finger 1:1, then settles fully open past threshold @tailwind", async ({
    page,
  }) => {
    const { cdp } = await setup(page)

    // track: at −40px of travel (inside the ~80px action width, no rubber-band)
    // the content must sit at −40, not jump to an end position
    const { point } = await aim(page, 0)
    await touch(cdp, "touchStart", point)
    for (let s = 1; s <= 8; s += 1) {
      await touch(cdp, "touchMove", { x: point.x - s * 5, y: point.y })
    }
    const tracked = await contentX(page, 0)
    expect(
      Math.abs(tracked - -40),
      `row must follow the finger 1:1 — sat at ${tracked}, expected ≈ −40`,
    ).toBeLessThanOrEqual(12)

    // release past threshold → settle fully open (≈ −80), never resting between
    await page.waitForTimeout(140)
    await touch(cdp, "touchEnd")
    await page.waitForTimeout(360)

    const settled = await contentX(page, 0)
    expect(
      settled,
      `must settle fully open, not half-open — landed at ${settled}`,
    ).toBeLessThan(-60)
    expect((await logTexts(page)).join("\n")).toMatch(
      /first opened \(right\)/,
    )
    await closeAll(page, cdp)
  })

  test("a release below threshold snaps closed — no half-open resting state @tailwind", async ({
    page,
  }) => {
    const { cdp } = await setup(page)
    // 16px is under the 0.3·80 ≈ 24px open threshold; settle before release so a
    // stray flick velocity can't carry it open
    await dragH(page, cdp, 0, -16, { settleMs: 200 })

    const settled = await contentX(page, 0)
    expect(
      Math.abs(settled),
      `a sub-threshold drag must snap back to 0 — stuck at ${settled}`,
    ).toBeLessThanOrEqual(2)
    await closeAll(page, cdp)
  })

  test("the log hears an open and a close, never a drag that changed nothing @tailwind", async ({
    page,
  }) => {
    const { cdp } = await setup(page)
    //the third row: setup's input probe drags the first, so the log holds
    //nothing about this one until the test moves it
    const THIRD = 2
    const count = async (re: RegExp) =>
      (await logTexts(page)).filter((t) => re.test(t)).length
    const tray = await page.evaluate(
      ([sel, i]) =>
        document
          .querySelectorAll(sel as string)
          [i as number]?.querySelector<HTMLElement>(
            '[data-swipeable-actions="right"]',
          )?.offsetWidth ?? 0,
      [ROOT, THIRD] as const,
    )
    //both drags below must clear Chromium's touch slop (it holds back every
    //move inside ~15px, so a shorter drag reaches the row as a tap), and stay
    //inside the open line (30% of the tray) and the close line (25%)
    expect(tray * 0.25).toBeGreaterThan(18)

    //one move a frame, so the release reads well under the 250px/s flick and
    //position alone decides where the row settles
    //`held` is where the row must sit under the finger before it lifts, so a
    //drag the page swallowed cannot pass as one that sprang back
    async function slowDragH(dx: number, held: number) {
      const { point } = await aim(page, THIRD)
      await touch(cdp, "touchStart", point)
      const steps = 12
      for (let s = 1; s <= steps; s += 1) {
        await touch(cdp, "touchMove", {
          x: Math.round(point.x + (dx * s) / steps),
          y: point.y,
        })
        await page.waitForTimeout(16)
      }
      await page.waitForTimeout(140)
      const x = await contentX(page, THIRD)
      expect(
        Math.abs(x - held),
        `the row must follow the finger to ${held} — sat at ${x}`,
      ).toBeLessThanOrEqual(2)
      await touch(cdp, "touchEnd")
    }
    //onClose fires when the close spring lands, so a count read before then
    //passes whether or not the close is reported. The offset is no signal: the
    //engine clears the transform inside half a pixel of rest, springs still
    //running. The spring's landing clears will-change, and then one frame and
    //one task let the log's state update commit before anything is counted
    async function landsAt(x: number, message: string) {
      await expect
        .poll(
          async () => {
            const willChange = await page.evaluate(
              ([sel, i]) =>
                document.querySelectorAll<HTMLElement>(sel as string)[
                  i as number
                ]?.style.willChange,
              [CONTENT, THIRD] as const,
            )
            return `${await contentX(page, THIRD)}|${willChange}`
          },
          { message, timeout: 1500 },
        )
        .toBe(`${x}|`)
      await page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => setTimeout(done, 0)),
          ),
      )
    }

    //closed, dragged 16px (under the open line), sprung back closed
    await slowDragH(-16, -16)
    await landsAt(0, "a drag under the open line springs back closed")
    expect(
      await count(/third (opened|closed)/),
      "a drag that never opened the row reports nothing",
    ).toBe(0)

    await slowDragH(-50, -50)
    await landsAt(-tray, "a drag past the open line opens the row")
    expect(await count(/third opened \(right\)/)).toBe(1)

    //open, nudged 18px back (inside the close line), sprung back open
    await slowDragH(18, 18 - tray)
    await landsAt(-tray, "a nudge inside the close line springs back open")
    expect(await count(/third opened/), "the open is reported once").toBe(
      1,
    )
    expect(await count(/third closed/), "the row never closed").toBe(0)

    await closeAll(page, cdp)
    await landsAt(0, "a tap outside closes the open row")
    expect(await count(/third closed/), "the close is reported once").toBe(
      1,
    )
    expect(await count(/third opened/)).toBe(1)
  })

  test("a Group closes the previously-open row when another opens @tailwind", async ({
    page,
  }) => {
    const { cdp } = await setup(page)

    await dragH(page, cdp, 0, -50)
    expect(
      await contentX(page, 0),
      "first row should be open",
    ).toBeLessThan(-60)
    const firstClosed = async () =>
      (await logTexts(page)).filter((t) => /first closed/.test(t)).length
    const closedBefore = await firstClosed()

    await dragH(page, cdp, 1, -50)
    expect(
      await contentX(page, 1),
      "second row should be open",
    ).toBeLessThan(-60)
    //the first row's close spring runs CONCURRENTLY with the second's open — poll
    //until it settles rather than measuring mid-glide (a fixed wait read 2.9px once)
    await expect
      .poll(async () => Math.abs(await contentX(page, 0)), {
        message:
          "the Group must auto-close the first row when the second opens",
        timeout: 1500,
      })
      .toBeLessThanOrEqual(TOLERANCE_PX)

    //8px from rest is not landed, and onClose fires on landing: poll the log,
    //and count this close rather than match any. A single match here used to
    //pass on a "first closed" that setup's own input probe logged, for a drag
    //that never opened the row
    await expect
      .poll(firstClosed, {
        message: "the first row's close is reported once",
        timeout: 1500,
      })
      .toBe(closedBefore + 1)
    expect((await logTexts(page)).join("\n")).toMatch(/second opened/)
    await closeAll(page, cdp)
  })

  test("a vertical scroll that STARTS on a row scrolls the page, not the row", async ({
    page,
  }) => {
    // the core promise and the classic regression: the finger lands on a row, the
    // user swipes up to scroll, and the row must not budge sideways
    const { cdp } = await setup(page)
    const { point } = await aim(page, 0)
    const before = await pageScroll(page)

    await touch(cdp, "touchStart", point)
    for (let s = 1; s <= 16; s += 1) {
      await touch(cdp, "touchMove", { x: point.x, y: point.y - s * 9 })
    }
    await touch(cdp, "touchEnd")
    await page.waitForTimeout(300)

    expect(
      (await pageScroll(page)) - before,
      "the page must scroll",
    ).toBeGreaterThan(TOLERANCE_PX)
    expect(
      Math.abs(await contentX(page, 0)),
      "the row must not have moved sideways",
    ).toBeLessThanOrEqual(TOLERANCE_PX)
    await closeAll(page, cdp)
  })

  test("the image row opens like any other (native image-drag does not steal it) @tailwind", async ({
    page,
  }) => {
    // historically the browser's native <img> drag grabbed the pointer here and the
    // row stopped tracking — the media user-select reset is what makes this pass
    const { cdp } = await setup(page)
    await dragH(page, cdp, PHOTO_ROW, -50)

    expect(
      await contentX(page, PHOTO_ROW),
      "the photo row must open exactly like the plain rows",
    ).toBeLessThan(-60)
    expect((await logTexts(page)).join("\n")).toMatch(/photo row opened/)
    await closeAll(page, cdp)
  })

  test("tapping a tray action fires it once AND closes the row (iOS Mail) @tailwind", async ({
    page,
  }) => {
    const { cdp } = await setup(page)
    await dragH(page, cdp, 0, -50)
    expect(await contentX(page, 0)).toBeLessThan(-60)

    // the delete button sits in the revealed right tray, pinned to the edge
    const del = page.getByRole("button", { name: /delete the first row/i })
    const box = await del.boundingBox()
    if (!box) throw new Error("the tray action has no layout box")
    const p = {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    }
    await touch(cdp, "touchStart", p)
    await touch(cdp, "touchEnd", p)
    await page.waitForTimeout(320)

    const deletes = (await logTexts(page)).filter((t) =>
      /first deleted/.test(t),
    )
    expect(deletes.length, "the tray action must fire exactly once").toBe(
      1,
    )

    // and the row dismisses itself — a bubbled click on the tray closes it, AFTER
    // the action's own handler has run (so it is fire-once AND close, not instead)
    await expect
      .poll(async () => Math.abs(await contentX(page, 0)), {
        message: "activating a tray action must close the row",
        timeout: 1500,
      })
      .toBeLessThanOrEqual(TOLERANCE_PX)
  })

  test("enabled=false makes the row inert but still readable @tailwind", async ({
    page,
  }) => {
    const { cdp } = await setup(page)
    await page.getByRole("button", { name: /^enabled:/i }).click()
    await page.waitForTimeout(120)

    await dragH(page, cdp, 0, -50)
    expect(
      Math.abs(await contentX(page, 0)),
      "a disabled row must not move under a drag",
    ).toBeLessThanOrEqual(2)
    expect(
      (await logTexts(page)).join("\n"),
      "a disabled row must not open",
    ).not.toMatch(/opened/)
  })
})

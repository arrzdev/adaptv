import type { CDPSession, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import {
  awaitStable,
  heapSample,
  installProbes,
  labRowNumber,
  MB,
  rafOverQuiet,
  readProbe,
} from "./support/stress-probes"

/*
 * List under stress — what `list.spec.ts` pins at a walking pace, taken at a run.
 *
 * Pinned here: the DOM window stays bounded through twenty fast flings each way;
 * at rest the rendered rows are contiguous (`#index` climbs by exactly 1, no
 * duplicate, no hole) and stacked edge to edge (no blank band a stale measurement
 * would leave); the data can be reset, emptied and refilled while the window sits
 * deep in the list; `onEndReached` fires per ARRIVAL, never per scroll event; and
 * 300 bursts leave no listener, no heap slope and no rAF loop behind.
 *
 * Driver: CDP `Input.dispatchTouchEvent`, the only instrument that moves a
 * react-virtual window over adaptv's ScrollView headless (see list.spec.ts). That
 * makes the whole file chromium-only, and the skip in `beforeEach` enforces it.
 * `hasTouch` on the context with a PORTRAIT viewport, or the rotate guard covers the
 * page (memory `touch-emulation-desktop-is-landscape`).
 *
 * Doctrine: the hydration gate first, no retries, no warm-ups. Every stress case
 * asserts its PREMISE — the fling really went deep, the counter really fired, the
 * heap really was sampled after a GC — so a harness that stops driving the list
 * fails on the premise instead of passing on nothing. Waits are `expect.poll`
 * (memory `playwright-waitforfunction-not-awaited`); the only fixed sleep is the
 * short post-burst breath the base spec uses, and the quiet window an idle claim
 * needs by definition.
 */

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

const LIST = '[data-adaptv="list"]'
const ROW = "[data-lab-row]"
//the lab paints "bad" at ≥80; a correct window in an h-80 box is ~15–30
const DOM_CEILING = 80
//a row's wrapper is what react-virtual positions and measures
const GAP_TOLERANCE_PX = 2

const rowIndices = (page: Page) =>
  page.$$eval(ROW, (els) =>
    els
      .map((e) => {
        const m = (e.textContent || "").match(/#(\d+)/)
        return m ? Number(m[1]) : -1
      })
      .filter((n) => n >= 0),
  )

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

/**
 * A settled, on-screen box for the list, with the touch point confirmed to land
 * on it. `boundingBox()` is viewport-relative and the page itself scrolls, so the
 * box is re-read until it stops moving and then checked with `elementFromPoint`
 * — CDP input has no actionability check, and a burst aimed at where the list
 * used to be moves nothing, which reads exactly like a frozen list.
 */
async function aimList(page: Page) {
  const list = page.locator(LIST)
  await list.scrollIntoViewIfNeeded()
  let previous = -1
  let box = await list.boundingBox()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (box && Math.round(box.y) === previous) break
    previous = box ? Math.round(box.y) : -1
    await page.waitForTimeout(50)
    box = await list.boundingBox()
  }
  if (!box) throw new Error("the list has no layout box")
  const probe = {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  }
  const onTarget = await page.evaluate(
    ([x, y, selector]) =>
      !!document
        .elementFromPoint(x as number, y as number)
        ?.closest(selector as string),
    [probe.x, probe.y, LIST] as const,
  )
  if (!onTarget) {
    throw new Error(
      `touch point ${probe.x},${probe.y} misses the list — stale measurement, not a broken list`,
    )
  }
  return box
}

/**
 * One fast burst. `dy > 0` drags UP from 75% of the list's height (scrolls the
 * list forward); `dy < 0` drags DOWN from 25% (scrolls it back). Six sub-moves,
 * not the base spec's sixteen: this file wants velocity, not resolution.
 */
async function burst(
  page: Page,
  cdp: CDPSession,
  box: { x: number; y: number; width: number; height: number },
  dy: number,
  settleMs = 120,
) {
  const from = {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height * (dy > 0 ? 0.75 : 0.25)),
  }
  await touch(cdp, "touchStart", from)
  for (let s = 1; s <= 6; s += 1) {
    await touch(cdp, "touchMove", {
      x: from.x,
      y: Math.round(from.y - (dy * s) / 6),
    })
  }
  await touch(cdp, "touchEnd")
  await page.waitForTimeout(settleMs)
}

const listScrollTop = (page: Page) =>
  page.$eval(LIST, (el) => (el as HTMLElement).scrollTop)

async function settleList(page: Page) {
  return awaitStable(() => listScrollTop(page), {
    message: "the list never came to rest after the burst",
    timeout: 8000,
  })
}

/** Indices climb by exactly 1 in DOM order: no hole, no duplicate, no drift. */
function expectContiguous(indices: number[], because: string) {
  expect(
    indices.length,
    `${because}: no rows rendered at all`,
  ).toBeGreaterThan(4)
  for (let i = 1; i < indices.length; i += 1) {
    expect(
      indices[i],
      `${because}: row ${i} reads #${indices[i]} after #${indices[i - 1]} — indices must climb by exactly 1`,
    ).toBe(indices[i - 1] + 1)
  }
}

/**
 * The rows whose wrapper boxes intersect the list's viewport must stack edge to
 * edge. The WRAPPER (`[data-index]`, the element react-virtual positions and
 * measures) is measured, not the lab row inside it, which carries its own margin.
 */
async function expectNoBlankBand(page: Page, because: string) {
  const geometry = await page.$eval(LIST, (list) => {
    const view = list.getBoundingClientRect()
    return {
      top: view.top,
      bottom: view.bottom,
      rows: [...list.querySelectorAll("[data-index]")]
        .map((wrapper) => {
          const box = wrapper.getBoundingClientRect()
          return {
            index: Number(wrapper.getAttribute("data-index")),
            top: box.top,
            bottom: box.bottom,
          }
        })
        .filter((row) => row.bottom > view.top && row.top < view.bottom)
        .sort((a, b) => a.index - b.index),
    }
  })
  expect(
    geometry.rows.length,
    `${because}: nothing intersects the list's viewport`,
  ).toBeGreaterThan(1)
  for (let i = 1; i < geometry.rows.length; i += 1) {
    const previous = geometry.rows[i - 1]
    const row = geometry.rows[i]
    expect(
      Math.abs(row.top - previous.bottom),
      `${because}: row #${row.index} starts at ${row.top.toFixed(1)} but #${previous.index} ends at ${previous.bottom.toFixed(1)} — a gap or an overlap at rest`,
    ).toBeLessThanOrEqual(GAP_TOLERANCE_PX)
  }
  //and the viewport itself is covered: first visible row at or above the top,
  //last at or below the bottom (unless the data ends there)
  expect(
    geometry.rows[0].top,
    `${because}: a blank band above the first visible row`,
  ).toBeLessThanOrEqual(geometry.top + GAP_TOLERANCE_PX)
}

test.describe("List under stress", () => {
  test.describe.configure({ timeout: 240_000 })

  let errors: string[] = []

  test.beforeEach(async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium",
      "CDP touch injection is chromium-only",
    )
    errors = []
    page.on("pageerror", (error) => errors.push(String(error)))
    await page.addInitScript(installProbes)
    await page.goto("/lab/list")
    await awaitClientHandover(page)
    await page.locator(ROW).first().waitFor()
  })

  test("flung to the end and back at speed, the DOM stays bounded and rows never drift or gap", async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page)
    const box = await aimList(page)
    const startMin = Math.min(...(await rowIndices(page)))

    for (let i = 0; i < 20; i += 1) {
      await burst(page, cdp, box, 900)
      const count = await page.locator(ROW).count()
      expect(
        count,
        `down burst ${i + 1}: the DOM window grew`,
      ).toBeLessThan(DOM_CEILING)
    }
    const restDown = await settleList(page)
    const down = await rowIndices(page)
    //PREMISE: the flings went deep — otherwise every assertion below is about the
    //first screenful and proves nothing about recycling
    expect(
      Math.min(...down),
      `the down phase must go deep (rested at scrollTop ${restDown}, window starts at #${Math.min(...down)})`,
    ).toBeGreaterThan(100)
    expectContiguous(down, "at rest after the down phase")
    await expectNoBlankBand(page, "at rest after the down phase")

    for (let i = 0; i < 20; i += 1) {
      await burst(page, cdp, box, -900)
      const count = await page.locator(ROW).count()
      expect(count, `up burst ${i + 1}: the DOM window grew`).toBeLessThan(
        DOM_CEILING,
      )
    }
    const restUp = await settleList(page)
    const up = await rowIndices(page)
    expect(
      Math.min(...up),
      `the up phase must come back near the top (rested at scrollTop ${restUp}, window starts at #${Math.min(...up)}, started the test at #${startMin})`,
    ).toBeLessThan(20)
    expectContiguous(up, "at rest after the up phase")
    await expectNoBlankBand(page, "at rest after the up phase")
    expect(errors, "no uncaught error during the flings").toEqual([])
  })

  test("reset to 2 000 while scrolled deep: no error, window bounded, indices contiguous", async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page)
    const box = await aimList(page)
    for (let i = 0; i < 8; i += 1) await burst(page, cdp, box, 900)
    const deepTop = await settleList(page)
    const deep = await rowIndices(page)
    expect(
      Math.min(...deep),
      `PREMISE: the list must be deep before the reset (scrollTop ${deepTop})`,
    ).toBeGreaterThan(60)

    await page.getByRole("button", { name: "reset to 2 000" }).click()
    await expect.poll(() => labRowNumber(page, "data rows")).toBe(2000)
    const afterTop = await settleList(page)
    const after = await rowIndices(page)
    expect(errors, "the reset must not throw").toEqual([])
    expect(after.length, "the window after the reset").toBeLessThan(
      DOM_CEILING,
    )
    expectContiguous(after, `after the reset (scrollTop ${afterTop})`)
    await expectNoBlankBand(
      page,
      `after the reset (scrollTop ${afterTop})`,
    )
    test.info().annotations.push({
      type: "measured",
      description: `before reset: scrollTop ${deepTop}, window #${Math.min(...deep)}–#${Math.max(...deep)}; after: scrollTop ${afterTop}, window #${Math.min(...after)}–#${Math.max(...after)}`,
    })
  })

  test("empty then refill while scrolled deep", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page)
    const box = await aimList(page)
    for (let i = 0; i < 8; i += 1) await burst(page, cdp, box, 900)
    const deepTop = await settleList(page)
    expect(
      Math.min(...(await rowIndices(page))),
      `PREMISE: the list must be deep before emptying (scrollTop ${deepTop})`,
    ).toBeGreaterThan(60)

    await page.getByRole("button", { name: "empty the list" }).click()
    await expect(page.getByText(/emptyState/)).toBeVisible()
    await expect(page.locator(ROW), "no rows while empty").toHaveCount(0)
    await expect(
      page.locator(LIST),
      "no scroller while empty",
    ).toHaveCount(0)

    await page.getByRole("button", { name: "refill the list" }).click()
    await expect(page.locator(ROW).first()).toBeVisible()
    const refilledTop = await settleList(page)
    const refilled = await rowIndices(page)
    expect(errors, "empty → refill must not throw").toEqual([])
    expect(refilled.length).toBeLessThan(DOM_CEILING)
    const because = `after the refill (scrollTop ${refilledTop}, window from #${Math.min(...refilled)})`
    expectContiguous(refilled, because)
    //where it lands is the virtualizer's call, not the List's: the List stays
    //mounted through the empty state with the same useVirtualizer instance,
    //and virtual-core hands its remembered offset to the next scroll element
    //it is given (`_willUpdate` → `_scrollToOffset(getScrollOffset())`), so the
    //refilled list resumes deep, where the emptied one was. Not pinned either
    //way; what is pinned is that the window agrees with wherever it landed
    await expectNoBlankBand(page, because)
    test.info().annotations.push({
      type: "measured",
      description: `refilled at scrollTop ${refilledTop}, window from #${Math.min(...refilled)} (the virtualizer's remembered offset)`,
    })
  })

  test("onEndReached fires once per arrival, not per scroll event", async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page)
    let box = await aimList(page)
    expect(await labRowNumber(page, "onEndReached calls")).toBe(0)
    expect(await labRowNumber(page, "data rows")).toBe(2000)

    //2 000 rows × ~60px is ~120 000px, 130+ bursts at 900px. Jump programmatically
    //to within a few screens of the end, then let real touch scroll events carry
    //the window the rest of the way (a bare scrollTop write leaves react-virtual's
    //window pinned — list.spec.ts — so the bursts after it are the actual drive)
    await page.$eval(LIST, (el) => {
      el.scrollTop = el.scrollHeight - el.clientHeight - 2500
    })
    box = await aimList(page)
    let bursts = 0
    while ((await labRowNumber(page, "onEndReached calls")) < 1) {
      if (bursts >= 40) break
      await burst(page, cdp, box, 900)
      bursts += 1
    }
    const arrivals = await labRowNumber(page, "onEndReached calls")
    expect(
      arrivals,
      `PREMISE: the window must reach the last row (${bursts} bursts, window from #${Math.min(...(await rowIndices(page)))})`,
    ).toBeGreaterThanOrEqual(1)

    //keep hammering the bottom: five more bursts, ~30 more scroll events
    for (let i = 0; i < 5; i += 1) await burst(page, cdp, box, 900)
    await settleList(page)
    const calls = await labRowNumber(page, "onEndReached calls")
    const dataRows = await labRowNumber(page, "data rows")
    expect(
      dataRows,
      "the lab appends 500 per arrival, capped at 4 000",
    ).toBeLessThanOrEqual(4000)
    const appends = dataRows / 500 - 4
    expect(
      calls,
      `onEndReached fired ${calls} times for ${appends} appends (${dataRows} rows) — a stream, not once per arrival`,
    ).toBeLessThanOrEqual(appends)
    expect(calls, "and it did fire").toBeGreaterThanOrEqual(1)
    expect(errors).toEqual([])
    test.info().annotations.push({
      type: "measured",
      description: `${bursts} bursts to the first arrival; calls=${calls}, data rows=${dataRows}, appends=${appends}`,
    })
  })

  test("an inline callback (a fresh identity per render) at the end fires once, not once per render", async ({
    page,
  }) => {
    //the shape the bug lived in: `onEndReached={() => …}` re-renders on its
    //own state change, which hands the list a new callback, which used to be
    //another call. Inline mode counts and appends nothing, so the list stays
    //at the same end and the count is the arrivals
    const cdp = await page.context().newCDPSession(page)
    await page
      .getByRole("button", { name: /callback: stable/ })
      .evaluate((b) => (b as HTMLButtonElement).click())
    await expect(
      page.getByRole("button", { name: /callback: inline/ }),
    ).toBeVisible()
    let box = await aimList(page)
    expect(await labRowNumber(page, "onEndReached calls")).toBe(0)
    await page.$eval(LIST, (el) => {
      el.scrollTop = el.scrollHeight - el.clientHeight - 2500
    })
    box = await aimList(page)
    let bursts = 0
    while ((await labRowNumber(page, "onEndReached calls")) < 1) {
      if (bursts >= 40) break
      await burst(page, cdp, box, 900)
      bursts += 1
    }
    await settleList(page)
    const first = await labRowNumber(page, "onEndReached calls")
    expect(
      first,
      `PREMISE: the window must reach the last row (${bursts} bursts)`,
    ).toBeGreaterThanOrEqual(1)
    expect(first, "one arrival, one call, however many renders").toBe(1)
    //parked at the end, three more bursts and a rest: still the same end
    for (let i = 0; i < 3; i += 1) await burst(page, cdp, box, 900)
    await settleList(page)
    const calls = await labRowNumber(page, "onEndReached calls")
    expect(
      await labRowNumber(page, "data rows"),
      "inline mode appends nothing",
    ).toBe(2000)
    expect(
      calls,
      `a list parked at its end must not call again for its own re-renders (${calls} calls after ${bursts + 3} bursts)`,
    ).toBe(1)
    expect(errors).toEqual([])
    test.info().annotations.push({
      type: "measured",
      description: `${bursts} bursts to the arrival; calls=${calls} after ${bursts + 3} bursts at the end`,
    })
  })

  test("300 scroll bursts: listeners on window/document and heap plateau; rAF idle after rest", async ({
    page,
  }) => {
    const cdp = await page.context().newCDPSession(page)
    const box = await aimList(page)
    await settleList(page)
    const before = await readProbe(page)
    expect(
      before.listeners.window + before.listeners.document,
      "PREMISE: the probe sees the app's own listeners",
    ).toBeGreaterThan(0)

    const phase = async (n: number, dy: number) => {
      for (let i = 0; i < n; i += 1) {
        await burst(page, cdp, box, dy, 40)
        if ((i + 1) % 25 === 0) {
          expect(
            await page.locator(ROW).count(),
            `burst ${i + 1} (dy ${dy}): the DOM window grew`,
          ).toBeLessThan(DOM_CEILING)
        }
      }
    }

    //150 down then 150 up, sampled at thirds: 100 down / 50 down + 50 up / 100 up
    await phase(100, 900)
    const h1 = await heapSample(cdp, page)
    await phase(50, 900)
    await phase(50, -900)
    const h2 = await heapSample(cdp, page)
    await phase(100, -900)
    const h3 = await heapSample(cdp, page)

    const rest = await settleList(page)
    const after = await readProbe(page)
    const delta12 = h2 - h1
    const delta23 = h3 - h2
    test.info().annotations.push({
      type: "measured",
      description: `heap after GC: ${(h1 / MB).toFixed(2)} / ${(h2 / MB).toFixed(2)} / ${(h3 / MB).toFixed(2)} MB (Δ ${(delta12 / MB).toFixed(2)}, ${(delta23 / MB).toFixed(2)}); listeners window ${before.listeners.window}→${after.listeners.window}, document ${before.listeners.document}→${after.listeners.document}; rest scrollTop ${rest}`,
    })
    expect(
      after.listeners,
      "listener counts must return to baseline",
    ).toEqual(before.listeners)
    expect(
      delta23,
      `heap growth must plateau: Δ(2→3) ${(delta23 / MB).toFixed(2)} MB vs Δ(1→2) ${(delta12 / MB).toFixed(2)} MB`,
    ).toBeLessThanOrEqual(delta12 + 1 * MB)

    const quiet = await rafOverQuiet(page, 1000)
    expect(
      quiet.ran,
      `rAF callbacks over 1s at rest must be 0 — callers: ${JSON.stringify(quiet.callers)}`,
    ).toBe(0)
    expect(
      quiet.requested,
      `rAF requests over 1s at rest must be 0 — callers: ${JSON.stringify(quiet.callers)}`,
    ).toBe(0)
    expect(errors).toEqual([])
  })
})

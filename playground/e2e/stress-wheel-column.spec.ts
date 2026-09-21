import type { CDPSession, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import {
  awaitStable,
  heapSample,
  installProbes,
  labRowNumber,
  labRowValue,
  MB,
  rafOverQuiet,
  readProbe,
  resetRafCounters,
} from "./support/stress-probes"

/*
 * WheelColumn under stress — the drum's two guarantees (any rest is a WHOLE row;
 * the readout is the row the drum is on) held under abuse: a fling re-flung
 * against its direction, ten alternating flings with no pause, a ten-key burst,
 * a 4x CPU throttle, and 60 fling cycles measured for listeners and heap. Plus
 * the idle claim: once settled, the paint loop stops (0 rAF over a second).
 *
 * Driver: `page.mouse.wheel`, the instrument wheel-column.spec.ts settled on
 * (CDP touch is swallowed on the first gesture; a scrollTop write is a jump, not
 * a glide). The webkit project is a mobile profile where `mouse.wheel` throws, so
 * the file is chromium-only and the skip in `beforeEach` enforces it; the 4x
 * throttle and the heap samples need CDP anyway.
 *
 * Wheel scrolling is ASYNC and sweeps through row multiples mid-glide, so every
 * assertion waits for scrollTop to hold still — three identical reads 100ms apart
 * — before reading anything (`awaitStable`, `expect.poll` underneath; never
 * `waitForFunction`). Premise per case: the fling really travelled (a scroll
 * trace on the element records the excursion), the keys really landed, the rAF
 * counter really moved during the glide. No retries, no warm-ups.
 */

test.use({ viewport: { width: 390, height: 844 } })

const HOUR = '[aria-label="Hour"]'
const ITEM_H = 30 // WHEEL_ITEM_HEIGHT
const LAST_HOUR = 23
const START = 9 // the lab's default centred hour (scrollTop 270)

const label = (n: number) => String(n).padStart(2, "0")

const hourScrollTop = (page: Page) =>
  page.$eval(HOUR, (el) => (el as HTMLElement).scrollTop)

const activeHour = (page: Page) =>
  page.locator(`${HOUR} button[data-active="true"]`).first().innerText()

/** The excursion the drum made since the trace was armed: max/min scrollTop seen. */
const trace = (page: Page) =>
  page.$eval(HOUR, (el) => {
    const w = window as Window & { __wheelTrace?: number[] }
    const seen = w.__wheelTrace ?? []
    return {
      events: seen.length,
      max: seen.length ? Math.max(...seen) : (el as HTMLElement).scrollTop,
      min: seen.length ? Math.min(...seen) : (el as HTMLElement).scrollTop,
    }
  })

const armTrace = (page: Page) =>
  page.$eval(HOUR, (el) => {
    const w = window as Window & { __wheelTrace?: number[] }
    w.__wheelTrace = []
    el.addEventListener("scroll", () =>
      w.__wheelTrace?.push((el as HTMLElement).scrollTop),
    )
  })

async function settle(page: Page, timeout = 5000) {
  return awaitStable(() => hourScrollTop(page), {
    intervalMs: 100,
    reads: 3,
    timeout,
    message: "the drum never held still",
  })
}

/** At rest: on a whole row, and both readouts name that row. */
async function expectOnRow(page: Page, because: string, timeout = 5000) {
  const top = await settle(page, timeout)
  expect(
    top % ITEM_H,
    `${because}: scrollTop ${top} rests between rows (not a multiple of ${ITEM_H})`,
  ).toBe(0)
  const row = Math.min(LAST_HOUR, Math.max(0, top / ITEM_H))
  expect(await activeHour(page), `${because}: the centred row`).toBe(
    label(row),
  )
  await expect
    .poll(() => labRowValue(page, "hour"), {
      message: `${because}: the "hour" readout must name row ${row}`,
    })
    .toBe(label(row))
  return top
}

test.describe("WheelColumn under stress", () => {
  test.describe.configure({ timeout: 240_000 })

  let cx = 0
  let cy = 0
  let errors: string[] = []

  test.beforeEach(async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium",
      "mouse.wheel is unsupported on the mobile WebKit profile, and the throttle and heap cases need CDP",
    )
    errors = []
    page.on("pageerror", (error) => errors.push(String(error)))
    await page.addInitScript(installProbes)
    await page.goto("/lab/wheel-column")
    await awaitClientHandover(page)
    await page.locator(HOUR).waitFor()
    await page
      .locator(`${HOUR} button[data-active="true"]`)
      .first()
      .waitFor()
    await page.locator(HOUR).scrollIntoViewIfNeeded()
    //re-read the box until it stops moving — the page scrolls to bring it on
    let previous = -1
    let box = await page.locator(HOUR).boundingBox()
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (box && Math.round(box.y) === previous) break
      previous = box ? Math.round(box.y) : -1
      await page.waitForTimeout(50)
      box = await page.locator(HOUR).boundingBox()
    }
    if (!box) throw new Error("the hour wheel has no layout box")
    cx = Math.round(box.x + box.width / 2)
    cy = Math.round(box.y + box.height / 2)
    const onTarget = await page.evaluate(
      ([x, y, selector]) =>
        !!document
          .elementFromPoint(x as number, y as number)
          ?.closest(selector as string),
      [cx, cy, HOUR] as const,
    )
    if (!onTarget) throw new Error(`${cx},${cy} misses the hour wheel`)
    await page.mouse.move(cx, cy)
    expect(await activeHour(page)).toBe(label(START))
    await settle(page)
    expect(await hourScrollTop(page)).toBe(START * ITEM_H)
    await armTrace(page)
  })

  test("flung hard then re-flung against the direction: settles on a whole row and the readout agrees", async ({
    page,
  }) => {
    await page.mouse.wheel(0, 600)
    //an OFF-ROW counter-fling (not a multiple of 30): headless wheel scrolls are
    //jumps, so the rest is on a row only if the settle snap actually runs
    await page.mouse.wheel(0, -315)
    const top = await expectOnRow(
      page,
      "after a fling and a counter-fling",
    )
    const seen = await trace(page)
    expect(
      seen.max - START * ITEM_H,
      `PREMISE: the first fling must travel ≥ 60px (trace max ${seen.max} over ${seen.events} scroll events)`,
    ).toBeGreaterThanOrEqual(60)
    expect(errors).toEqual([])
    test.info().annotations.push({
      type: "measured",
      description: `rest scrollTop ${top} (row ${top / ITEM_H}); trace min ${seen.min} max ${seen.max} over ${seen.events} scroll events`,
    })
  })

  test("ten rapid alternating flings never leave the drum between rows", async ({
    page,
  }) => {
    const callsBefore = await labRowNumber(page, "onChange calls")
    for (let i = 0; i < 10; i += 1) {
      await page.mouse.wheel(0, 400)
      await page.mouse.wheel(0, -250)
    }
    const top = await expectOnRow(
      page,
      "after ten alternating flings",
      8000,
    )
    const calls = await labRowNumber(page, "onChange calls")
    expect(
      calls,
      "PREMISE: the drum moved and reported (onChange calls grew)",
    ).toBeGreaterThan(callsBefore)
    const seen = await trace(page)
    expect(errors).toEqual([])
    test.info().annotations.push({
      type: "measured",
      description: `rest scrollTop ${top} (row ${top / ITEM_H}); onChange calls ${callsBefore} → ${calls}; trace min ${seen.min} max ${seen.max} over ${seen.events} events`,
    })
  })

  test("ArrowDown ×10 in a burst lands ten rows down", async ({
    page,
  }) => {
    const hour = page.getByRole("group", { name: "Hour" })
    await hour.focus()
    await expect(hour, "PREMISE: the column takes focus").toBeFocused()
    for (let i = 0; i < 10; i += 1) await page.keyboard.press("ArrowDown")
    const expected = Math.min(LAST_HOUR, START + 10)
    const top = await expectOnRow(
      page,
      "after ten rapid ArrowDown presses",
      8000,
    )
    expect(
      top,
      `ten ArrowDown presses from row ${START} must land on row ${expected}, not row ${top / ITEM_H}`,
    ).toBe(expected * ITEM_H)
    expect(await labRowValue(page, "hour")).toBe(label(expected))
    expect(errors).toEqual([])
  })

  test("at 4x CPU throttle the settle snap still lands on a row", async ({
    page,
  }) => {
    const cdp: CDPSession = await page.context().newCDPSession(page)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
    try {
      await page.mouse.wheel(0, 500)
      const top = await expectOnRow(
        page,
        "under a 4x CPU throttle",
        10_000,
      )
      const seen = await trace(page)
      expect(
        seen.max - START * ITEM_H,
        "PREMISE: the fling travelled under throttle",
      ).toBeGreaterThanOrEqual(60)
      test.info().annotations.push({
        type: "measured",
        description: `4x throttle: rest scrollTop ${top} (row ${top / ITEM_H}); trace max ${seen.max} over ${seen.events} events`,
      })
    } finally {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })
    }
    expect(errors).toEqual([])
  })

  test("after settling the paint loop stops: 0 rAF over 1s", async ({
    page,
  }) => {
    await resetRafCounters(page)
    await page.mouse.wheel(0, 600)
    //an OFF-ROW counter-fling (not a multiple of 30): headless wheel scrolls are
    //jumps, so the rest is on a row only if the settle snap actually runs
    await page.mouse.wheel(0, -315)
    await expectOnRow(page, "after the fling")
    const during = await readProbe(page)
    expect(
      during.rafRan,
      "PREMISE: the drum's paint loop ran during the glide",
    ).toBeGreaterThan(0)
    const quiet = await rafOverQuiet(page, 1000)
    test.info().annotations.push({
      type: "measured",
      description: `rAF during the glide: ${during.rafRan} ran / ${during.rafRequested} requested (${JSON.stringify(during.rafCallers)}); over the quiet second: ${quiet.ran} ran / ${quiet.requested} requested (${JSON.stringify(quiet.callers)})`,
    })
    expect(
      quiet.ran,
      `rAF callbacks over 1s at rest must be 0 — callers: ${JSON.stringify(quiet.callers)}`,
    ).toBe(0)
    expect(
      quiet.requested,
      `rAF requests over 1s at rest must be 0 — callers: ${JSON.stringify(quiet.callers)}`,
    ).toBe(0)
  })

  test("60 fling cycles: listeners and heap plateau", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page)
    const before = await readProbe(page)
    expect(
      before.listeners.window + before.listeners.document,
      "PREMISE: the probe sees the app's own listeners",
    ).toBeGreaterThan(0)
    const samples: number[] = []
    const rests: number[] = []
    for (let i = 0; i < 60; i += 1) {
      await page.mouse.wheel(0, 300)
      rests.push(await settle(page, 6000))
      await page.mouse.wheel(0, -300)
      rests.push(await settle(page, 6000))
      if ((i + 1) % 20 === 0) samples.push(await heapSample(cdp, page))
    }
    //PREMISE: the cycles moved the drum (not every rest equal to the start)
    expect(
      rests.some((top) => top !== START * ITEM_H),
      "the flings must have moved the drum",
    ).toBe(true)
    const offRow = rests.filter((top) => top % ITEM_H !== 0)
    expect(offRow, "every cycle's rest must be on a row").toEqual([])
    const after = await readProbe(page)
    const [h1, h2, h3] = samples
    const delta12 = h2 - h1
    const delta23 = h3 - h2
    test.info().annotations.push({
      type: "measured",
      description: `heap after GC: ${(h1 / MB).toFixed(2)} / ${(h2 / MB).toFixed(2)} / ${(h3 / MB).toFixed(2)} MB (Δ ${(delta12 / MB).toFixed(2)}, ${(delta23 / MB).toFixed(2)}); listeners window ${before.listeners.window}→${after.listeners.window}, document ${before.listeners.document}→${after.listeners.document}; final rest ${rests[rests.length - 1]}`,
    })
    expect(
      after.listeners,
      "listener counts must return to baseline",
    ).toEqual(before.listeners)
    expect(
      delta23,
      `heap growth must plateau: Δ(2→3) ${(delta23 / MB).toFixed(2)} MB vs Δ(1→2) ${(delta12 / MB).toFixed(2)} MB`,
    ).toBeLessThanOrEqual(delta12 + 1 * MB)
    expect(errors).toEqual([])
  })
})

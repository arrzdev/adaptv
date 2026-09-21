import type { Locator, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * App state under a visibility storm — twenty flips in a second, on both engines.
 *
 * `app-state.spec.ts` proves the engine's own lifecycle order for ONE departure
 * and return. This file drives the other axis: many transitions, faster than a
 * user could switch tabs, with a subscriber tree that re-renders on every one.
 * The contract from `src/capabilities/app-state.ts` is edge-triggered emission —
 * every listener hears each transition exactly once, and none hears a level —
 * so after N round trips the hook counters and the raw accessor's log must both
 * read N, the two state columns must agree, and the last flip must win.
 *
 * Headless cannot hide a page for real (see app-state.spec.ts), so the document
 * is told it is hidden: `visibilityState` and `hidden` are overridden on the
 * `Document` prototype and `visibilitychange` is dispatched — the same event the
 * capability binds, carrying the same value the browser would set. The premise
 * that the override took is asserted before the storm.
 */

/** The value cell of a lab row, found by its exact label. */
const rowValue = (page: Page, label: string): Locator =>
  page
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::span")

type Flip = { hidden: boolean; gapMs: number }

/**
 * Run a sequence of visibility flips in the page, each a separate task so React
 * commits between them the way it would between real tab switches. Returns how
 * many `visibilitychange` events were dispatched — the premise for the counts.
 */
function storm(page: Page, flips: Flip[]) {
  return page.evaluate(async (flips) => {
    let value: DocumentVisibilityState = document.visibilityState
    Object.defineProperty(Document.prototype, "visibilityState", {
      configurable: true,
      get: () => value,
    })
    Object.defineProperty(Document.prototype, "hidden", {
      configurable: true,
      get: () => value === "hidden",
    })
    let dispatched = 0
    for (const flip of flips) {
      value = flip.hidden ? "hidden" : "visible"
      if (document.visibilityState !== value) {
        throw new Error("the visibility override did not take")
      }
      document.dispatchEvent(new Event("visibilitychange"))
      dispatched += 1
      //a zero gap is no gap: the next flip lands in the same task
      if (flip.gapMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, flip.gapMs))
      }
    }
    return dispatched
  }, flips)
}

/** Let React paint whatever the last event scheduled, then read once. */
async function settledCounts(page: Page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        setTimeout(() =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
      ),
  )
  const log = await page.locator("[data-lab-log] li").allInnerTexts()
  return {
    resumes: await rowValue(page, "useOnResume() calls").innerText(),
    pauses: await rowValue(page, "useOnPause() calls").innerText(),
    accessor: await rowValue(page, "getAppState()").innerText(),
    hook: await rowValue(page, "useAppState()").innerText(),
    onResume: log.filter((line) => line.endsWith("· onResume")).length,
    onPause: log.filter((line) => line.endsWith("· onPause")).length,
    subscribed: log.filter((line) => line.includes("subscribeAppState →"))
      .length,
    lines: log.length,
  }
}

//the lab log keeps its newest lines only (app-state.page.tsx)
const LOG_CAP = 40

test.describe("App state under a visibility storm", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/app-state")
    await awaitClientHandover(page)
    await expect(rowValue(page, "useOnResume() calls")).toHaveText("0")
  })

  test("twenty flips in a second are ten pauses and ten resumes, and the last flip wins", async ({
    page,
  }) => {
    //hidden, visible, hidden, … visible: ten round trips, 50 ms apart
    const flips = Array.from({ length: 20 }, (_, index) => ({
      hidden: index % 2 === 0,
      gapMs: 50,
    }))
    const dispatched = await storm(page, flips)
    expect(dispatched, "the premise: twenty events went out").toBe(20)

    const { subscribed, lines, ...counts } = await settledCounts(page)
    expect(counts).toEqual({
      resumes: "10",
      pauses: "10",
      accessor: "active",
      hook: "active",
      onResume: 10,
      onPause: 10,
    })
    //twenty raw notifications, as many as the capped log still holds after
    //the twenty hook lines and whatever else the page logged
    expect(lines).toBeLessThanOrEqual(LOG_CAP)
    const other = lines - 20 - subscribed
    expect(subscribed, "one subscribeAppState line per transition").toBe(
      Math.min(20, LOG_CAP - 20 - other),
    )
  })

  test("a burst with no gap at all still counts every transition once, and ends where it ends", async ({
    page,
  }) => {
    //eleven flips back to back inside one task: ends hidden
    const flips = Array.from({ length: 11 }, (_, index) => ({
      hidden: index % 2 === 0,
      gapMs: 0,
    }))
    await storm(page, flips)
    const hidden = await settledCounts(page)
    expect(hidden.pauses, "six departures").toBe("6")
    expect(hidden.resumes, "five returns").toBe("5")
    expect(hidden.accessor, "the accessor reads the last flip").toBe(
      "background",
    )
    expect(hidden.hook, "the hook agrees with the accessor").toBe(
      "background",
    )

    //a level, not an edge: the same state dispatched again must not fire
    await storm(page, [{ hidden: true, gapMs: 0 }])
    const level = await settledCounts(page)
    expect(level.pauses, "a repeated hidden is not a second pause").toBe(
      "6",
    )

    await storm(page, [{ hidden: false, gapMs: 0 }])
    const back = await settledCounts(page)
    expect(back.resumes).toBe("6")
    expect(back.accessor).toBe("active")
    expect(back.hook).toBe("active")
  })
})

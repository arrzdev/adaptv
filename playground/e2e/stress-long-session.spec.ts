import type { Locator, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import {
  domCount,
  heapUsed,
  installListenerCounter,
  listenerSeq,
  liveListeners,
  mb,
} from "./support/stress"

/*
 * Long sessions — 200 keyboard toggles of a Switch, 200 fill/clear cycles of an
 * auto-resizing TextArea — read for what does not come back: DOM nodes, live
 * listeners on `window` / `document`, and the JS heap after a forced GC.
 *
 * Doctrine: chromium only (the GC and the exact heap read are CDP), ONE
 * browser, serial, run with `--workers=1` under `guard.py 4 20`. The hydration
 * gate in every `beforeEach`, no retries. Listeners are counted at the source by
 * `support/stress.ts`, which wraps `addEventListener` before the page loads and
 * numbers every registration; "live since the page loaded" is the window
 * (0, now] of registrations not yet removed.
 *
 * A leak is growth that does not plateau: the numbers after 100 are the
 * baseline, the numbers after 200 the claim. The DOM count and the live listener
 * count are asserted equal (the lab log caps itself at 40 entries, so by 100
 * toggles the page has no legitimate reason to grow). The heap is reported and
 * bounded loosely: 200 toggles of one switch allocating more than 4 MB that a
 * forced GC cannot reclaim is not noise on this page (measured 2026-09-21; the
 * baseline itself sits at 1–2 MB of drift between two GCs).
 */

test.describe.configure({ mode: "serial" })
test.setTimeout(180_000)

type Metrics = {
  dom: number
  listeners: Record<string, number>
  live: number
  heap: number
}

async function measure(page: Page, label: string): Promise<Metrics> {
  const heap = await heapUsed(page)
  const listeners = await liveListeners(page, 0, await listenerSeq(page))
  const live = Object.values(listeners).reduce((sum, n) => sum + n, 0)
  const metrics = { dom: await domCount(page), listeners, live, heap }
  test.info().annotations.push({
    type: label,
    description: `dom ${metrics.dom}, live listeners ${live} (${JSON.stringify(listeners)}), heap ${mb(heap)}`,
  })
  return metrics
}

function assertPlateau(
  after100: Metrics,
  after200: Metrics,
  heapBoundMb: number,
) {
  expect(after200.heap, "premise: the heap is readable").toBeGreaterThan(0)
  expect(after200.dom, "the DOM does not grow between 100 and 200").toBe(
    after100.dom,
  )
  expect(
    after200.live,
    `live window/document listeners do not grow: ${JSON.stringify(after200.listeners)} vs ${JSON.stringify(after100.listeners)}`,
  ).toBe(after100.live)
  const growthMb = (after200.heap - after100.heap) / 1024 / 1024
  test.info().annotations.push({
    type: "heap-growth-100-to-200",
    description: `${growthMb.toFixed(2)} MB`,
  })
  expect(growthMb, "the heap plateaus").toBeLessThan(heapBoundMb)
}

test.describe("long sessions", () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "CDP GC and heap read")
    await installListenerCounter(page)
  })

  test("200 keyboard toggles of a Switch: DOM, listeners and heap plateau after 100", async ({
    page,
  }) => {
    await page.goto("/lab/toggles")
    await awaitClientHandover(page)
    const sw = page.getByRole("switch", {
      name: "Lab switch",
      exact: true,
    })
    await sw.waitFor()
    await sw.focus()
    const at0 = await measure(page, "switch-0")

    const toggle = async (times: number, from: number) => {
      for (let i = 0; i < times; i += 1) {
        await page.keyboard.press("Space")
        const expected = (from + i + 1) % 2 === 1
        const checked = await sw.evaluate(
          (node) => (node as HTMLInputElement).checked,
        )
        if (checked !== expected)
          throw new Error(
            `toggle ${from + i + 1}: checked ${checked}, expected ${expected}`,
          )
      }
    }
    await toggle(100, 0)
    await expect(sw).not.toBeChecked()
    const at100 = await measure(page, "switch-100")
    await toggle(100, 100)
    await expect(sw).not.toBeChecked()
    const at200 = await measure(page, "switch-200")
    test.info().annotations.push({
      type: "switch-0-to-100",
      description: `dom ${at0.dom} → ${at100.dom}, listeners ${at0.live} → ${at100.live}, heap ${mb(at100.heap - at0.heap)}`,
    })
    expect(
      await page.evaluate(
        () => document.activeElement?.getAttribute("aria-label") ?? null,
      ),
      "focus stayed on the switch for 200 presses",
    ).toBe("Lab switch")
    assertPlateau(at100, at200, 4)
  })

  test("200 fill/clear cycles of an auto-resizing TextArea: DOM, listeners and heap plateau after 100", async ({
    page,
  }) => {
    await page.goto("/lab/fields")
    await awaitClientHandover(page)
    const area = page.getByRole("textbox", {
      name: "Uncapped text area",
      exact: true,
    })
    await area.waitFor()
    const empty = await area.evaluate((el) => el.clientHeight)
    const at0 = await measure(page, "textarea-0")

    //the cycle runs in the page: the prototype value setter plus a bubbling
    //`input` event is what a keystroke and `TextArea.clear()` both do, and two
    //frames is the sync's own schedule (a rAF, then the ResizeObserver's rAF)
    const cycles = (area: Locator, times: number) =>
      area.evaluate(async (el, n) => {
        const text = Array.from(
          { length: 12 },
          (_, i) => `line ${i}`,
        ).join("\n")
        const edit = (value: string) => {
          Reflect.set(HTMLTextAreaElement.prototype, "value", value, el)
          el.dispatchEvent(new Event("input", { bubbles: true }))
        }
        const frames = () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve()),
            ),
          )
        const grown: number[] = []
        for (let i = 0; i < n; i += 1) {
          edit(text)
          await frames()
          grown.push(el.clientHeight)
          edit("")
          await frames()
        }
        return {
          min: Math.min(...grown),
          max: Math.max(...grown),
          final: el.clientHeight,
        }
      }, times)

    const first = await cycles(area, 100)
    expect(first.min, "every cycle grew the field").toBeGreaterThan(empty)
    expect(first.max, "to the same height every time").toBe(first.min)
    expect(first.final, "and cleared back to the floor").toBe(empty)
    const at100 = await measure(page, "textarea-100")
    const second = await cycles(area, 100)
    expect(second.min).toBe(first.min)
    expect(second.max).toBe(first.min)
    expect(second.final).toBe(empty)
    const at200 = await measure(page, "textarea-200")
    test.info().annotations.push({
      type: "textarea-0-to-100",
      description: `dom ${at0.dom} → ${at100.dom}, listeners ${at0.live} → ${at100.live}, heap ${mb(at100.heap - at0.heap)}, grown height ${first.min}px, floor ${empty}px`,
    })
    assertPlateau(at100, at200, 4)
  })
})

import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The press engine over a long session: 300 press cycles on one Pressable, then
 * the counts that would grow if a press left something behind.
 *
 * A press is a pointerdown, a deferred show timer, a pointerup, a floor timer and
 * a re-render of the lab log (capped at 40 rows). None of that should accrue: the
 * engine adds no listener per press (its only per-press listener, the long-press
 * touch guard, is not armed on a tap-only control), the log's DOM plateaus at its
 * cap, and the heap after a forced GC should stop growing once the log is full.
 * So the assertion is a PLATEAU, not a number: listeners on window/document by
 * type, live timers, DOM nodes and heap are read after 100, 200 and 300 cycles,
 * and the 200→300 step must not exceed the 100→200 step. Growth that keeps pace is
 * a leak; growth that stops is the log filling up.
 *
 * chromium only: `performance.memory` and `HeapProfiler.collectGarbage` are CDP.
 * One worker, one browser — run it with `--workers=1` under the 4 GB guard.
 *
 * The counters are installed in an init script BEFORE the page's own code runs,
 * or the app's boot-time listeners would be invisible and the baseline wrong. It
 * patches `EventTarget.prototype` (add/remove) and `window.setTimeout` /
 * `clearTimeout`; `document.documentElement` does not exist yet at that point, so
 * nothing here touches the DOM.
 */

type Counters = {
  listeners: Record<string, number>
  timers: number
}

type LeakWindow = Window & {
  __leak: {
    listeners: Map<string, number>
    timers: Set<number>
  }
}

test.describe("press engine — 300 cycles", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "performance.memory and HeapProfiler are CDP-only",
  )

  test("listeners, timers, DOM and heap plateau across 300 presses", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as LeakWindow
      w.__leak = { listeners: new Map(), timers: new Set() }
      const key = (target: EventTarget, type: string) =>
        `${target === window ? "window" : target === document ? "document" : "other"}:${type}`
      const add = EventTarget.prototype.addEventListener
      const remove = EventTarget.prototype.removeEventListener
      EventTarget.prototype.addEventListener = function (
        this: EventTarget,
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) {
        if (this === window || this === document) {
          const k = key(this, type)
          w.__leak.listeners.set(k, (w.__leak.listeners.get(k) ?? 0) + 1)
        }
        return add.call(this, type, listener, options)
      }
      EventTarget.prototype.removeEventListener = function (
        this: EventTarget,
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | EventListenerOptions,
      ) {
        if (this === window || this === document) {
          const k = key(this, type)
          w.__leak.listeners.set(k, (w.__leak.listeners.get(k) ?? 0) - 1)
        }
        return remove.call(this, type, listener, options)
      }
      const setT = window.setTimeout
      const clearT = window.clearTimeout
      window.setTimeout = ((
        handler: TimerHandler,
        timeout?: number,
        ...args: unknown[]
      ) => {
        let id = 0
        id = setT(() => {
          w.__leak.timers.delete(id)
          if (typeof handler === "function") handler(...args)
        }, timeout) as unknown as number
        w.__leak.timers.add(id)
        return id
      }) as typeof window.setTimeout
      window.clearTimeout = ((id?: number) => {
        if (id !== undefined) w.__leak.timers.delete(id)
        clearT(id)
      }) as typeof window.clearTimeout
    })

    await page.goto("/lab/pressable")
    await awaitClientHandover(page)
    const target = page.getByText("press me", { exact: true })
    await target.scrollIntoViewIfNeeded()
    const box = await target.boundingBox()
    if (!box) throw new Error("the Pressable has no box")
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    const taps = page
      .getByText("onPress fired")
      .locator("xpath=following-sibling::*[1]")

    const cdp = await page.context().newCDPSession(page)
    await cdp.send("HeapProfiler.enable")

    const snapshot = async () => {
      //let the floor timer of the last press fire before counting timers
      await page.waitForTimeout(250)
      await cdp.send("HeapProfiler.collectGarbage")
      const counters = await page.evaluate((): Counters => {
        const w = window as unknown as LeakWindow
        const listeners: Record<string, number> = {}
        for (const [k, v] of w.__leak.listeners)
          if (v !== 0) listeners[k] = v
        return { listeners, timers: w.__leak.timers.size }
      })
      const nodes = await page.evaluate(
        () => document.querySelectorAll("*").length,
      )
      const heap = await page.evaluate(
        () =>
          (
            performance as unknown as {
              memory: { usedJSHeapSize: number }
            }
          ).memory.usedJSHeapSize,
      )
      return { ...counters, nodes, heap }
    }

    const press = async (n: number) => {
      await page.mouse.move(x, y)
      for (let i = 0; i < n; i += 1) {
        await page.mouse.down()
        await page.mouse.up()
      }
    }

    await press(100)
    await expect(taps).toHaveText("100")
    const at100 = await snapshot()
    await press(100)
    await expect(taps).toHaveText("200")
    const at200 = await snapshot()
    await press(100)
    await expect(taps).toHaveText("300")
    const at300 = await snapshot()

    const report = JSON.stringify({ at100, at200, at300 }, null, 2)
    console.log(`press-leak counters:\n${report}`)

    //no press may leave a listener or a timer behind: exact, not a plateau
    expect(at300.listeners, `listeners drifted: ${report}`).toEqual(
      at100.listeners,
    )
    expect(at300.timers, `timers drifted: ${report}`).toBeLessThanOrEqual(
      at100.timers,
    )
    //the log is capped at 40 rows, so the DOM is full by 100 and stays there
    expect(at300.nodes, `DOM grew past the log's cap: ${report}`).toBe(
      at200.nodes,
    )
    //heap: the second hundred may not cost more than the first, plus a little
    //GC noise — growth that keeps pace with presses is the leak signature
    const step1 = at200.heap - at100.heap
    const step2 = at300.heap - at200.heap
    expect(
      step2,
      `heap keeps growing per press (100→200: ${step1}, 200→300: ${step2}): ${report}`,
    ).toBeLessThanOrEqual(Math.max(step1, 0) + 512 * 1024)
    //and the control is at rest
    await expect(target).not.toHaveAttribute("data-pressed")
  })
})

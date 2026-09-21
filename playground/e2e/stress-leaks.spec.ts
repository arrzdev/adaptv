import type { CDPSession, Page } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import { expect, test } from "./support/reload-guard"

/*
 * Three hundred mount/unmount cycles of every display component, three times, on
 * the harness page (`/lab/stress-display`, "Mount cycles"): each press of a cycle
 * button commits 300 mounts and 300 unmounts through `flushSync`, so every effect
 * and every cleanup runs 300 times in one task.
 *
 * The claim is not "the first 300 cycles cost nothing" — a first mount may create
 * singletons on purpose (the spinner's shared live region, the media-query
 * registry's one listener per query, the network binding). The claim is that the
 * SECOND and THIRD 300 cost exactly what the first did on every counter that a
 * leak would move: net listeners on window and document, net `change` listeners
 * on MediaQueryLists, net IntersectionObserver targets, the number of nodes in the
 * body, and the heap after a forced collection. A component that re-subscribes
 * without unsubscribing, or holds a node it removed from the tree, moves one of
 * them by a multiple of 300 — far outside the bound.
 *
 * Why three rounds and not two: in four full runs a single post-GC heap STEP of
 * 1.2–1.4 MB landed once per run on whichever test was open 35–70 s into the
 * worker's life (`text` twice, `divider` once, never in isolation), with every
 * later page's baseline ~1.1 MB higher and no `[vite]` traffic — the browser's,
 * not a component's. One increment cannot tell that step from a leak; the
 * smaller of two consecutive increments can, because a leak grows both.
 *
 * Chromium only: `HeapProfiler.collectGarbage` and `Runtime.getHeapUsage` are CDP.
 */

const CYCLE_TARGETS = [
  "image",
  "collapsible",
  "skeleton",
  "spinner",
  "progress-bar",
  "text",
  "text-plain",
  "text-clamp",
  "text-scale",
  "view",
  "divider",
  "icon",
  "offline",
  "not-found",
  "boot-error",
  "update-required",
  "orientation-guard",
  "splash",
] as const

/** A 1×1 opaque PNG: the smallest thing an `<img>` will call loaded. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
)

/**
 * How much the heap may grow across a round of 300 cycles, after a full GC, on
 * the smaller of the two later rounds. Unaffected rounds measured -280 KB..+400 KB
 * over four runs; a 5 KB-per-mount retention would show as +1.5 MB in EVERY round.
 */
const HEAP_GROWTH_BOUND_BYTES = 1_500_000

type Counters = {
  listeners: Record<string, number>
  mql: number
  observed: number
  bodyNodes: number
  stageChildren: number
}

declare global {
  interface Window {
    __listeners: Record<string, number>
    __observed: number
  }
}

async function installCounters(page: Page) {
  await page.addInitScript(() => {
    window.__listeners = {}
    window.__observed = 0

    const proto = EventTarget.prototype
    const add = proto.addEventListener
    const remove = proto.removeEventListener
    const keyFor = (target: EventTarget, type: string) => {
      if (target === window) return `window:${type}`
      if (target === document) return `document:${type}`
      if (
        typeof MediaQueryList !== "undefined" &&
        target instanceof MediaQueryList
      )
        return `mql:${type}`
      return null
    }
    proto.addEventListener = function (this: EventTarget, ...args) {
      const key = keyFor(this, String(args[0]))
      if (key) window.__listeners[key] = (window.__listeners[key] ?? 0) + 1
      return add.apply(this, args as Parameters<typeof add>)
    }
    proto.removeEventListener = function (this: EventTarget, ...args) {
      const key = keyFor(this, String(args[0]))
      if (key) window.__listeners[key] = (window.__listeners[key] ?? 0) - 1
      return remove.apply(this, args as Parameters<typeof remove>)
    }

    const io = IntersectionObserver.prototype
    const observe = io.observe
    const unobserve = io.unobserve
    const disconnect = io.disconnect
    const targets = new WeakMap<IntersectionObserver, Set<Element>>()
    io.observe = function (this: IntersectionObserver, el: Element) {
      const set = targets.get(this) ?? new Set()
      if (!set.has(el)) {
        set.add(el)
        window.__observed += 1
      }
      targets.set(this, set)
      return observe.call(this, el)
    }
    io.unobserve = function (this: IntersectionObserver, el: Element) {
      const set = targets.get(this)
      if (set?.delete(el)) window.__observed -= 1
      return unobserve.call(this, el)
    }
    io.disconnect = function (this: IntersectionObserver) {
      const set = targets.get(this)
      if (set) {
        window.__observed -= set.size
        set.clear()
      }
      return disconnect.call(this)
    }
  })
}

async function readCounters(page: Page): Promise<Counters> {
  return page.evaluate(() => ({
    listeners: Object.fromEntries(
      Object.entries(window.__listeners).filter(([, n]) => n !== 0),
    ),
    mql: window.__listeners["mql:change"] ?? 0,
    observed: window.__observed,
    //minus the shared spinner announcer's subtree: the harness's own labelled
    //ProgressBar puts a line in it at load and the region drops that line after
    //7 s (SPINNER_ANNOUNCE_CLEAR_MS), so a test that straddles that moment would
    //read one node fewer through no component's doing; the region itself, a
    //once-per-document singleton, still counts
    bodyNodes:
      document.body.querySelectorAll("*").length -
      (document
        .querySelector('[data-adaptv="spinner-announcer"]')
        ?.querySelectorAll("*").length ?? 0),
    stageChildren:
      document.querySelector('[data-testid="stress-cycle-stage"]')
        ?.childElementCount ?? -1,
  }))
}

async function heapAfterGc(cdp: CDPSession): Promise<number> {
  //twice: the first collection can leave objects a finalizer freed on the queue
  await cdp.send("HeapProfiler.collectGarbage")
  await cdp.send("HeapProfiler.collectGarbage")
  const { usedSize } = await cdp.send("Runtime.getHeapUsage")
  return usedSize
}

test.describe("300 mount/unmount cycles per component (chromium, CDP)", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "HeapProfiler and Runtime.getHeapUsage are CDP",
  )

  for (const target of CYCLE_TARGETS) {
    test(`${target}: the second and third 300 cycles move no counter the first 300 did not`, async ({
      page,
    }) => {
      const errors: string[] = []
      //the dev server's own traffic, printed with the counters: a hot update or a
      //dependency re-optimisation mid-test re-executes modules, and the heap it
      //adds is the server's, not the component's
      const vite: string[] = []
      page.on("pageerror", (error) =>
        errors.push(`uncaught: ${error.message}`),
      )
      page.on("console", (message) => {
        const text = message.text()
        if (message.type() === "error" || message.type() === "warning")
          errors.push(`console.${message.type()}: ${text}`)
        if (text.includes("[vite]")) vite.push(text)
      })
      await installCounters(page)
      //the cycled Image asks for a real URL; answer it, so the only console
      //errors left are the component's own
      await page.route("**/lab/stress-image/**", (route) =>
        route.fulfill({ contentType: "image/png", body: PNG }),
      )
      await page.goto("/lab/stress-display")
      await awaitClientHandover(page)
      const cdp = await page.context().newCDPSession(page)
      await cdp.send("HeapProfiler.enable")

      const button = page.getByTestId(`stress-cycle-${target}`)
      await expect(button).toHaveText(`${target} (0)`)

      const idle = await readCounters(page)
      await button.click()
      await expect(button).toHaveText(`${target} (300)`)
      //the premise: the cycles happened, and the last one unmounted
      const first = await readCounters(page)
      expect(first.stageChildren).toBe(0)
      const heapFirst = await heapAfterGc(cdp)

      await button.click()
      await expect(button).toHaveText(`${target} (600)`)
      const second = await readCounters(page)
      expect(second.stageChildren).toBe(0)
      const heapSecond = await heapAfterGc(cdp)

      await button.click()
      await expect(button).toHaveText(`${target} (900)`)
      const third = await readCounters(page)
      expect(third.stageChildren).toBe(0)
      const heapThird = await heapAfterGc(cdp)

      const signed = (n: number) => `${n > 0 ? "+" : ""}${n}`
      const increments = [heapSecond - heapFirst, heapThird - heapSecond]
      console.log(
        `[stress-leaks ${target}] idle ${JSON.stringify(idle)} → 300 ${JSON.stringify(first)} → 600 ${JSON.stringify(second)} → 900 ${JSON.stringify(third)}; heap ${heapFirst} → ${heapSecond} → ${heapThird} (${increments.map(signed).join(", ")}); vite ${JSON.stringify(vite)}`,
      )

      //what the first 300 created, the later rounds must not create again
      for (const round of [second, third]) {
        expect(round.listeners).toEqual(first.listeners)
        expect(round.mql).toBe(first.mql)
        expect(round.observed).toBe(first.observed)
        expect(round.bodyNodes).toBe(first.bodyNodes)
      }
      //and the heap after a full collection is where it was, within the noise
      //of the harness's own state, on the smaller of the two increments — a leak
      //grows both rounds, the browser's one-time step grows at most one
      expect(Math.min(...increments)).toBeLessThan(HEAP_GROWTH_BOUND_BYTES)
      //nothing above a first mount's singletons survives an unmount
      expect(first.observed).toBe(idle.observed)
      expect(errors).toEqual([])
    })
  }
})

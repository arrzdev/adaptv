import type { CDPSession, Page } from "@playwright/test"
import { expect } from "@playwright/test"

/*
 * Probes for the stress specs (`e2e/stress-*.spec.ts`): a rAF counter with
 * caller attribution, a live listener registry for `window` and `document`,
 * and a post-GC heap sample.
 *
 * `installProbes` is a `page.addInitScript` — it runs before any app code, so it
 * sees every `requestAnimationFrame` and every `addEventListener` the app ever
 * makes. It must not touch `document.documentElement` (it does not exist yet at
 * that point; memory `prove-the-page-idles`).
 *
 * rAF is counted twice: `rafRequested` (calls to requestAnimationFrame) and
 * `rafRan` (callbacks that actually executed). The edge-fade hook cancels and
 * reschedules on every scroll event, so its REQUESTS track scroll events while
 * its RUNS track frames — an idle claim is "both deltas are 0 over a second".
 * Every request is attributed to the first stack frame outside the wrapper so a
 * non-zero idle count names its file instead of leaving a "something is running".
 *
 * Listeners are kept as a registry, not a counter: the DOM ignores a duplicate
 * `addEventListener` and a `removeEventListener` for a listener that was never
 * added, and a naive +1/-1 would drift on both. A `once` listener leaves the
 * registry when it fires, as it leaves the browser. The registry is keyed by
 * type and capture flag, and `listenerTypes` reports the count per type, so a
 * drift names the listener (`+1 window blur`) instead of a bare number.
 *
 * The heap sample is only meaningful right after `HeapProfiler.collectGarbage`;
 * `heapSample` and `sampleProbes` do the two in sequence over CDP (see
 * `heapSample` for why not `performance.memory`) and fail loudly when the
 * number is missing, so a plateau assertion can never pass on an undefined
 * number.
 */

export type ListenerCount = { window: number; document: number }
export type ListenerTypes = {
  window: Record<string, number>
  document: Record<string, number>
}

export type ProbeReading = {
  rafRequested: number
  rafRan: number
  rafCallers: Record<string, number>
  listeners: ListenerCount
  listenerTypes: ListenerTypes
}

type ProbeState = ProbeReading & { installed: true }

declare global {
  interface Window {
    __stressProbe?: ProbeState
  }
}

export function installProbes() {
  const state: ProbeState = {
    installed: true,
    rafRequested: 0,
    rafRan: 0,
    rafCallers: {},
    listeners: { window: 0, document: 0 },
    listenerTypes: { window: {}, document: {} },
  }
  window.__stressProbe = state

  const nativeRaf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    state.rafRequested += 1
    const frames = (new Error().stack ?? "").split("\n")
    //frame 0 is "Error", 1 is this wrapper; 2 is the caller
    const caller =
      frames[2]?.match(/(https?:\/\/[^\s)]+)/)?.[1] ?? "unknown"
    state.rafCallers[caller] = (state.rafCallers[caller] ?? 0) + 1
    return nativeRaf((time) => {
      state.rafRan += 1
      callback(time)
    })
  }

  type Listener = EventListenerOrEventListenerObject
  //per target: "type|capture" → the listeners the browser holds under that
  //key, each mapped to what was actually registered (the listener itself, or
  //the `once` wrapper that drops it from the registry when it fires)
  type Registry = Map<string, Map<Listener, Listener>>
  const registries: Record<"window" | "document", Registry> = {
    window: new Map(),
    document: new Map(),
  }
  const which = (target: EventTarget) =>
    target === window ? "window" : target === document ? "document" : null
  const captureOf = (options: unknown) =>
    options === true ||
    (typeof options === "object" &&
      options !== null &&
      (options as { capture?: boolean }).capture === true)
  const sync = () => {
    for (const name of ["window", "document"] as const) {
      let total = 0
      const types: Record<string, number> = {}
      for (const [key, bucket] of registries[name]) {
        const type = key.slice(0, key.indexOf("|"))
        types[type] = (types[type] ?? 0) + bucket.size
        total += bucket.size
      }
      state.listeners[name] = total
      state.listenerTypes[name] = types
    }
  }

  const nativeAdd = EventTarget.prototype.addEventListener
  const nativeRemove = EventTarget.prototype.removeEventListener
  EventTarget.prototype.addEventListener = function (
    this: EventTarget,
    type: string,
    listener: Listener | null,
    options?: boolean | AddEventListenerOptions,
  ) {
    const name = which(this)
    if (!name || !listener)
      return nativeAdd.call(this, type, listener, options)
    const registry = registries[name]
    const key = `${type}|${captureOf(options)}`
    let bucket = registry.get(key)
    if (!bucket) {
      bucket = new Map()
      registry.set(key, bucket)
    }
    const known = bucket.get(listener)
    if (known) return nativeAdd.call(this, type, known, options)
    const once =
      typeof options === "object" &&
      options !== null &&
      Boolean(options.once)
    let actual: Listener = listener
    if (once) {
      const b = bucket
      actual = function (this: EventTarget, event: Event) {
        b.delete(listener)
        sync()
        return typeof listener === "function"
          ? listener.call(this, event)
          : listener.handleEvent(event)
      }
    }
    bucket.set(listener, actual)
    sync()
    return nativeAdd.call(this, type, actual, options)
  }
  EventTarget.prototype.removeEventListener = function (
    this: EventTarget,
    type: string,
    listener: Listener | null,
    options?: boolean | EventListenerOptions,
  ) {
    const name = which(this)
    if (!name || !listener)
      return nativeRemove.call(this, type, listener, options)
    const bucket = registries[name].get(`${type}|${captureOf(options)}`)
    const actual = bucket?.get(listener) ?? listener
    bucket?.delete(listener)
    sync()
    return nativeRemove.call(this, type, actual, options)
  }
}

/** The current probe counters; throws if the init script never installed. */
export async function readProbe(page: Page): Promise<ProbeReading> {
  const reading = await page.evaluate(() => {
    const probe = window.__stressProbe
    if (!probe?.installed) return null
    return {
      rafRequested: probe.rafRequested,
      rafRan: probe.rafRan,
      rafCallers: { ...probe.rafCallers },
      listeners: { ...probe.listeners },
      listenerTypes: {
        window: { ...probe.listenerTypes.window },
        document: { ...probe.listenerTypes.document },
      },
    }
  })
  if (!reading) {
    throw new Error(
      "the stress probe is not installed on this page — addInitScript(installProbes) must run before goto",
    )
  }
  return reading
}

/** Zero the rAF counters so the next reading is one phase's worth. */
export async function resetRafCounters(page: Page) {
  await page.evaluate(() => {
    const probe = window.__stressProbe
    if (!probe) return
    probe.rafRequested = 0
    probe.rafRan = 0
    probe.rafCallers = {}
  })
}

/**
 * rAF activity over a quiet window: the counters are zeroed, the page is left
 * alone for `ms`, and the deltas come back with the callers that produced them.
 */
export async function rafOverQuiet(page: Page, ms = 1000) {
  await resetRafCounters(page)
  await page.waitForTimeout(ms)
  const after = await readProbe(page)
  return {
    requested: after.rafRequested,
    ran: after.rafRan,
    callers: after.rafCallers,
  }
}

/**
 * Used JS heap in bytes, right after a forced GC. Chromium only.
 *
 * Read over CDP (`Runtime.getHeapUsage`), not from `performance.memory`: that
 * API is quantized unless Chromium runs with `--enable-precise-memory-info`,
 * and every sample of an earlier run read the same 29.75 MB — a bucket, not a
 * measurement, under which a small leak is invisible and a plateau assertion
 * passes vacuously. The CDP number is the allocator's own.
 */
export async function heapSample(cdp: CDPSession, page: Page) {
  await cdp.send("HeapProfiler.enable")
  await cdp.send("HeapProfiler.collectGarbage")
  const usage = (await cdp.send("Runtime.getHeapUsage")) as {
    usedSize?: number
  }
  if (typeof usage.usedSize !== "number") {
    throw new Error(
      `Runtime.getHeapUsage returned no usedSize (${JSON.stringify(usage)}) — the heap sample cannot be taken`,
    )
  }
  //the page is only touched so a detached page fails here, not in the sampler
  await page.evaluate(() => document.readyState)
  return usage.usedSize
}

export type ProbeSample = {
  heap: number
  listeners: ListenerCount
  listenerTypes: ListenerTypes
  nodes: number
}

/** GC first, then the heap, the live listener counts (by type) and the DOM
 *  size — the premise of a heap sample is the collection before it. */
export async function sampleProbes(
  page: Page,
  cdp: CDPSession,
): Promise<ProbeSample> {
  const heap = await heapSample(cdp, page)
  const reading = await readProbe(page)
  const nodes = await page.evaluate(
    () => document.getElementsByTagName("*").length,
  )
  return {
    heap,
    listeners: reading.listeners,
    listenerTypes: reading.listenerTypes,
    nodes,
  }
}

/** The listener types whose count differs between two samples, as
 *  `window +1 blur, document -2 touchmove` — or `none` when nothing moved. */
export function describeListenerDelta(
  from: { listenerTypes: ListenerTypes },
  to: { listenerTypes: ListenerTypes },
) {
  const parts: string[] = []
  for (const name of ["window", "document"] as const) {
    const a = from.listenerTypes[name]
    const b = to.listenerTypes[name]
    for (const type of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = (b[type] ?? 0) - (a[type] ?? 0)
      if (d !== 0) parts.push(`${name} ${d > 0 ? "+" : ""}${d} ${type}`)
    }
  }
  return parts.length ? parts.join(", ") : "none"
}

export const MB = 1024 * 1024
export const fmtMB = (bytes: number) => `${(bytes / MB).toFixed(2)}MB`

/**
 * Wait for a number to hold still: `reads` consecutive identical readings
 * `intervalMs` apart. Returns the settled value. Never a fixed sleep — a
 * scroll that is still gliding keeps this polling until it truly stops.
 */
export async function awaitStable(
  read: () => Promise<number>,
  {
    intervalMs = 100,
    reads = 3,
    timeout = 5000,
    message = "the value never held still",
  }: {
    intervalMs?: number
    reads?: number
    timeout?: number
    message?: string
  } = {},
) {
  let settled = Number.NaN
  await expect
    .poll(
      async () => {
        let previous = await read()
        for (let i = 1; i < reads; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, intervalMs))
          const next = await read()
          if (next !== previous) return `moving (${previous} → ${next})`
          previous = next
        }
        settled = previous
        return "stable"
      },
      { timeout, message },
    )
    .toBe("stable")
  return settled
}

/** The value span of a LabRow, found by its label text. */
export function labRowValue(page: Page, label: string) {
  return page.evaluate((text) => {
    const span = [...document.querySelectorAll("span")].find(
      (candidate) => candidate.textContent === text,
    )
    return span?.nextElementSibling?.textContent ?? null
  }, label)
}

export async function labRowNumber(page: Page, label: string) {
  const text = await labRowValue(page, label)
  if (text === null) throw new Error(`no LabRow labelled "${label}"`)
  const n = Number.parseFloat(text)
  if (!Number.isFinite(n)) {
    throw new Error(`LabRow "${label}" reads "${text}", not a number`)
  }
  return n
}

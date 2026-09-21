import type { Page } from "@playwright/test"

/*
 * Instruments for the stress specs (stress-*.spec.ts).
 *
 * Listener counting. `installListenerCounter` patches
 * `EventTarget.prototype.addEventListener` / `removeEventListener` from an init
 * script — BEFORE any app code runs — and records every registration whose target
 * is `window` or `document`, with a monotonically increasing sequence number.
 * React's delegated handlers live on the root container, not on either, so the
 * count is the framework's own window/document subscriptions (the outside-press
 * pair, the Escape capture, scroll/resize re-anchoring) and nothing else. A
 * duplicate registration is not recorded (the DOM ignores it) and a `once`
 * listener is skipped (the DOM removes it without calling removeEventListener,
 * which would read as a leak that is not one). So is anything Playwright's
 * injected script registers (its hit-target interceptors arrive on the first
 * `click()` of a page, on `window`, capture, and never leave).
 *
 * `liveListeners(page, from, to)` answers "which listeners registered in the
 * sequence window (from, to] are still live?" — so a spec can prove that what an
 * open added, a close (or an unmount by route change) removed, without a baseline
 * that other components on the next route would disturb.
 *
 * Heap. `heapUsed` runs a full GC through the CDP HeapProfiler and reads
 * `Runtime.getHeapUsage` (exact bytes, unlike the quantised `performance.memory`).
 * Chromium only — the caller skips webkit.
 */

export type LiveListeners = Record<string, number>

type ListenerHost = {
  __adaptvListeners?: {
    seq: () => number
    live: (from: number, to: number) => LiveListeners
  }
}

export function installListenerCounter(page: Page) {
  return page.addInitScript(() => {
    type Rec = {
      target: "window" | "document"
      type: string
      capture: boolean
      listener: unknown
      seq: number
      removed: boolean
    }
    const records: Rec[] = []
    let seq = 0
    const nameOf = (t: EventTarget): Rec["target"] | null =>
      t === window ? "window" : t === document ? "document" : null
    const captureOf = (o: unknown) =>
      typeof o === "boolean"
        ? o
        : Boolean((o as { capture?: boolean })?.capture)
    const onceOf = (o: unknown) =>
      typeof o === "object" &&
      o !== null &&
      Boolean((o as { once?: boolean }).once)
    const find = (
      target: Rec["target"],
      type: string,
      capture: boolean,
      listener: unknown,
    ) =>
      records.find(
        (r) =>
          !r.removed &&
          r.target === target &&
          r.type === type &&
          r.capture === capture &&
          r.listener === listener,
      )
    //Playwright's own injected script registers window listeners lazily — the
    //hit-target interceptors on the first `click()`, a global-listeners check —
    //and drops them without removeEventListener. They are the driver, not the
    //app: recognised by their frames and skipped.
    const isDriver = (type: string) =>
      type.startsWith("__playwright") ||
      /InjectedScript|HitTargetInterceptor/.test(new Error().stack ?? "")
    const add = EventTarget.prototype.addEventListener
    const remove = EventTarget.prototype.removeEventListener
    EventTarget.prototype.addEventListener = function (
      this: EventTarget,
      type: string,
      listener: unknown,
      options?: unknown,
    ) {
      const target = nameOf(this)
      if (target && listener && !onceOf(options) && !isDriver(type)) {
        const capture = captureOf(options)
        if (!find(target, type, capture, listener)) {
          records.push({
            target,
            type,
            capture,
            listener,
            seq: ++seq,
            removed: false,
          })
        }
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
      const target = nameOf(this)
      if (target && listener) {
        const rec = find(target, type, captureOf(options), listener)
        if (rec) rec.removed = true
      }
      return remove.call(
        this,
        type,
        listener as EventListenerOrEventListenerObject,
        options as EventListenerOptions | boolean | undefined,
      )
    }
    ;(window as unknown as ListenerHost).__adaptvListeners = {
      seq: () => seq,
      live: (from: number, to: number) => {
        const out: Record<string, number> = {}
        for (const r of records) {
          if (r.removed || r.seq <= from || r.seq > to) continue
          const key = `${r.target}:${r.type}${r.capture ? ":capture" : ""}`
          out[key] = (out[key] ?? 0) + 1
        }
        return out
      },
    }
  })
}

/** The current registration sequence number. */
export function listenerSeq(page: Page): Promise<number> {
  return page.evaluate(() => {
    const host = (window as unknown as ListenerHost).__adaptvListeners
    if (!host) throw new Error("the listener counter is not installed")
    return host.seq()
  })
}

/** Listeners registered in the window (from, to] that are still live, by target:type[:capture]. */
export function liveListeners(
  page: Page,
  from: number,
  to: number = Number.MAX_SAFE_INTEGER,
): Promise<LiveListeners> {
  return page.evaluate(
    ([a, b]) => {
      const host = (window as unknown as ListenerHost).__adaptvListeners
      if (!host) throw new Error("the listener counter is not installed")
      return host.live(a, b)
    },
    [from, to] as const,
  )
}

/** Every element in the document. */
export function domCount(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelectorAll("*").length)
}

/** Full GC, then the exact used heap in bytes. Chromium only. */
export async function heapUsed(page: Page): Promise<number> {
  const cdp = await page.context().newCDPSession(page)
  try {
    await cdp.send("HeapProfiler.collectGarbage")
    const usage = (await cdp.send("Runtime.getHeapUsage")) as {
      usedSize: number
    }
    return usage.usedSize
  } finally {
    await cdp.detach()
  }
}

export const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(2)} MB`

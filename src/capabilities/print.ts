//Print accessor — hand the page to the OS print dialog where one exists, and
//say where none does. ONE mechanism on every target: `window.print()`, which
//is the only print API the web has. What differs is whether anything answers.
//
//## Measured (2026-09-02)
//
//  • desktop and mobile browsers: `window.print()` opens the print dialog;
//    `beforeprint` fires as it opens and `afterprint` as it closes, whether the
//    page was printed or the dialog dismissed — the web cannot tell those apart,
//    and this module does not pretend to.
//  • headless Chromium: both events fire synchronously, 2 ms, no dialog.
//  • headless WebKit (iPhone descriptor): the call returns at once and no
//    event ever fires.
//  • Android WebView (API 36): `window.print` is a function, the call returns
//    at once, no event fires, no print activity comes to the front. The
//    WebView has no PrintManager wiring unless the host app adds one.
//  • iOS WKWebView (iOS 26 simulator): `window.print` is a function, the call
//    returns at once, no event fires, no print sheet appears.
//
//So the outcome is what the engine actually did: `opened` when `afterprint`
//came back, `silent` when the call returned and nothing followed within the
//bounded wait. A native WebView reads `unsupported` up front, because a print
//button that does nothing is the failure this capability exists to name.
//
//## A dialog that never says it closed
//
//Once `beforeprint` fires the dialog is up and the silent wait no longer
//applies, but nothing guarantees `afterprint` follows. An in-flight call that
//never settles keeps `printing` true and hands every later `print()` the same
//stuck promise, so the button is dead for the session. The dialog did open, so
//the call still resolves `opened`, just without waiting for `afterprint`: on
//the user's first sign of being back on the page (`pointerdown`, `keydown`,
//window `focus`, or the document turning visible), which no modal dialog lets
//through while it is up, or at {@link PRINT_DIALOG_MAX_MS} if none comes.
import { isNativePlatform } from "#adaptv/utils/platform"

/**
 * `"available"` — `window.print` exists and this engine is one that answers it.
 * `"unsupported"` — no `window.print`, or a native WebView, which swallows it.
 */
export type PrintStatus = "available" | "unsupported"

/**
 * `"opened"` — the dialog opened (`beforeprint` fired) and closed: `afterprint`
 * fired, or the user was back on the page, or the upper bound passed; printed
 * or dismissed, the web cannot say which.
 * `"silent"` — the call returned and no print event followed within the wait.
 * `"unsupported"` — nothing was called; see {@link PrintStatus}.
 * `"failed"` — `window.print()` threw.
 */
export type PrintOutcome = "opened" | "silent" | "unsupported" | "failed"

export interface PrintOptions {
  /** How long to wait for `beforeprint` before calling the print silent. */
  silentAfterMs?: number
}

/** The bounded wait for a print event; headless engines answer within 2 ms. */
export const PRINT_SILENT_AFTER_MS = 1500

/**
 * How long an opened dialog may go without `afterprint` or the user coming back
 * before the call settles anyway. Generous: any input on the page settles it
 * sooner, so this only bounds a dialog nobody touches.
 */
export const PRINT_DIALOG_MAX_MS = 300_000

let printing = false
const listeners = new Set<() => void>()

function notify(next: boolean) {
  if (printing === next) return
  printing = next
  for (const cb of listeners) cb()
}

/** Whether a print dialog can open here. Synchronous; never throws. */
export function getPrintStatus(): PrintStatus {
  if (typeof window === "undefined" || typeof window.print !== "function")
    return "unsupported"
  if (isNativePlatform()) return "unsupported"
  return "available"
}

/** Whether a print call is in flight (between the call and its outcome). */
export function isPrinting(): boolean {
  return printing
}

/** Subscribe to {@link isPrinting} changes; returns the unsubscribe. */
export function subscribePrint(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/**
 * Open the print dialog for the current page. Resolves the outcome once the
 * engine has said so; never rejects. A second call while one is in flight
 * shares its outcome rather than opening a second dialog.
 */
export function print(options: PrintOptions = {}): Promise<PrintOutcome> {
  if (getPrintStatus() === "unsupported")
    return Promise.resolve("unsupported")
  if (inFlight) return inFlight
  const wait = options.silentAfterMs ?? PRINT_SILENT_AFTER_MS
  let resolve!: (outcome: PrintOutcome) => void
  const call = new Promise<PrintOutcome>((r) => {
    resolve = r
  })
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const done = (outcome: PrintOutcome) => {
    if (settled) return
    settled = true
    if (timer !== undefined) clearTimeout(timer)
    window.removeEventListener("beforeprint", onBefore)
    window.removeEventListener("afterprint", onAfter)
    for (const type of RETURN_EVENTS)
      window.removeEventListener(type, onReturn)
    document.removeEventListener("visibilitychange", onVisible)
    if (inFlight === call) inFlight = null
    notify(false)
    resolve(outcome)
  }
  const onAfter = () => done("opened")
  const onReturn = () => done("opened")
  const onVisible = () => {
    if (document.visibilityState === "visible") done("opened")
  }
  //A dialog is up: the silent wait no longer applies. `afterprint` closes it,
  //and so does the user being back on the page or the upper bound.
  const onBefore = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(onAfter, PRINT_DIALOG_MAX_MS)
    for (const type of RETURN_EVENTS)
      window.addEventListener(type, onReturn)
    document.addEventListener("visibilitychange", onVisible)
  }
  window.addEventListener("beforeprint", onBefore)
  window.addEventListener("afterprint", onAfter)
  //Set before the call: an engine whose dialog blocks `window.print()` settles
  //inside it, and that settle must be the one that clears the slot.
  inFlight = call
  notify(true)
  timer = setTimeout(() => done("silent"), wait)
  try {
    window.print()
  } catch {
    done("failed")
  }
  return call
}

const RETURN_EVENTS = ["pointerdown", "keydown", "focus"] as const

let inFlight: Promise<PrintOutcome> | null = null

/** Test seam: drop the in-flight call and the subscribers. */
export function resetPrint(): void {
  inFlight = null
  printing = false
  listeners.clear()
}

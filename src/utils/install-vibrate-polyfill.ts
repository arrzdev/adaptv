/**
 * Wraps `navigator.vibrate` so every call cancels the in-flight pattern first.
 *
 * Without the cancel, overlapping calls queue: two taps in quick succession buzz
 * for the sum of both patterns rather than re-triggering, which reads as a stuck
 * device rather than as feedback.
 *
 * ## What this file used to do, and why it stopped
 *
 * There was a second branch here that mounted a hidden
 * `<input type="checkbox" switch>` and called `.click()` on it to reach the iOS
 * Taptic Engine, since iOS Safari has no `navigator.vibrate`.
 *
 * **Apple patched programmatic triggering in iOS 26.5** (June 2026, no release
 * note). The branch kept running and kept reporting success while producing no
 * haptic at all — the worst failure shape available. It has been removed rather
 * than left in as a hopeful no-op.
 *
 * The surviving technique needs a real finger on a real element, which is a
 * fundamentally *declarative* mechanism and cannot be expressed as a patched
 * imperative call. It lives in `#adaptv/capabilities/haptic-tick`.
 *
 * So: this file is now a `navigator.vibrate` wrapper and nothing more. On any
 * platform without `navigator.vibrate` — which is every iOS browser, permanently,
 * since WebKit's standards position on the Vibration API is `oppose` — it
 * installs nothing.
 */

let installed = false

function normalizePattern(
  pattern: VibratePattern | Iterable<number>,
): VibratePattern {
  if (typeof pattern === "number") return pattern
  if (Array.isArray(pattern)) return pattern
  return [...pattern]
}

function isCancelPattern(pattern: VibratePattern): boolean {
  if (typeof pattern === "number") return pattern === 0
  return pattern.length === 0
}

export function installVibratePolyfill(): void {
  if (installed) return
  if (typeof navigator === "undefined") return
  if (typeof navigator.vibrate !== "function") return

  const nativeVibrate = navigator.vibrate.bind(navigator)
  installed = true

  function vibrate(pattern: VibratePattern): boolean
  function vibrate(pattern: Iterable<number>): boolean
  function vibrate(pattern: VibratePattern | Iterable<number>): boolean {
    const normalized = normalizePattern(pattern)

    //a cancel is just a cancel — don't follow it with a pulse
    if (isCancelPattern(normalized)) return nativeVibrate(0)

    nativeVibrate(0)
    return nativeVibrate(normalized)
  }

  navigator.vibrate = vibrate
}

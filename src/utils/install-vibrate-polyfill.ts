/**
 * `navigator.vibrate`, made to exist and behave on every web target adaptv reaches.
 *
 * Two jobs:
 *  1. Where `navigator.vibrate` exists (Android / Chrome / desktop) — wrap it so each
 *     call cancels the in-flight pattern first. Without the cancel, overlapping calls
 *     queue and the device buzzes for the sum of both, which reads as stuck.
 *  2. On iOS 18+ Safari — where `navigator.vibrate` does NOT exist and never will
 *     (WebKit's standards position on the Vibration API is `oppose`) — install a shim
 *     that reaches the Taptic Engine the only way Safari allows: a native
 *     `<input type="checkbox" switch>` (Safari 17.4 / iOS 18+) whose toggle fires the
 *     system tick. The switch is wrapped in a hidden `<label>` and driven by clicking
 *     the LABEL (labeled-control activation), which is what fires the tick.
 *
 * ⚠︎ TWO things this depends on, both learned the hard way:
 *  - The switch must keep its NATIVE appearance — `appearance: none` strips the look
 *    AND kills the haptic. So the whole `<label>` is hidden with `display: none`
 *    rather than the control being visually neutralised.
 *  - Apple patched programmatic triggering in **iOS 26.5** (June 2026): on 26.5+ the
 *    click still runs and this still returns success, but NO haptic fires, with no
 *    runtime way to detect the patch. Accepted limitation — the imperative shape
 *    can't be delivered there; the only surviving route is a REAL finger on the
 *    switch (the declarative `haptic-tick` transducer the component `haptic` prop
 *    uses). The shim is kept because it works on every iOS before 26.5.
 */

let installed = false

//Safari version from the UA — the switch element is Safari 17.4 / iOS 18+, so the
//shim only makes sense from 18. Chrome-on-iOS carries "Safari" in its UA too, hence
//the explicit Chrome exclusion.
function getSafariVersion(): number | null {
  if (typeof navigator === "undefined") return null
  const ua = navigator.userAgent
  if (!ua.includes("Safari") || ua.includes("Chrome")) return null
  const match = ua.match(/Version\/(\d+(?:\.\d+)?)/)
  return match?.[1] ? Number.parseFloat(match[1]) : null
}

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

function pulseDuration(pattern: VibratePattern): number {
  if (typeof pattern === "number") return pattern
  if (pattern.length === 0) return 0
  return pattern[0] ?? 0
}

export function installVibratePolyfill(): void {
  if (installed) return
  if (typeof navigator === "undefined" || typeof document === "undefined")
    return

  const nativeVibrate =
    typeof navigator.vibrate === "function"
      ? navigator.vibrate.bind(navigator)
      : null

  const safariVersion = getSafariVersion()
  const needsSwitchPolyfill =
    !nativeVibrate && safariVersion !== null && safariVersion >= 18

  //nothing to do: no real vibrate to wrap, and not an iOS-18+ Safari to shim
  if (!nativeVibrate && !needsSwitchPolyfill) return

  installed = true

  //A hidden native switch — iOS Safari's one route to the Taptic Engine. It KEEPS
  //its native appearance (stripping it kills the haptic); the whole label is hidden
  //instead. Clicking the LABEL toggles the switch, which fires the tick.
  let switchTrigger: HTMLLabelElement | null = null
  if (needsSwitchPolyfill) {
    const label = document.createElement("label")
    label.ariaHidden = "true"
    label.style.display = "none"

    const input = document.createElement("input")
    input.type = "checkbox"
    input.setAttribute("switch", "")
    label.appendChild(input)

    const mount = () => {
      document.head.appendChild(label)
    }
    if (document.head) mount()
    else queueMicrotask(mount)

    switchTrigger = label
  }

  function cancelVibration() {
    nativeVibrate?.(0)
  }

  function vibrate(pattern: VibratePattern): boolean
  function vibrate(pattern: Iterable<number>): boolean
  function vibrate(pattern: VibratePattern | Iterable<number>): boolean {
    const normalized = normalizePattern(pattern)

    //a cancel is just a cancel — never follow it with a pulse
    if (isCancelPattern(normalized)) {
      cancelVibration()
      return true
    }

    cancelVibration()

    if (nativeVibrate) return nativeVibrate(normalized)

    //iOS Safari: one system tick per pulse (no weights, no patterns)
    if (pulseDuration(normalized) <= 0 || !switchTrigger) return false
    switchTrigger.click()
    return true
  }

  navigator.vibrate = vibrate
}

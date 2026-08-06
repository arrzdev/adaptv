/**
 * `navigator.vibrate`, made to exist and behave on every web target adaptv reaches.
 *
 * Two jobs:
 *  1. Where `navigator.vibrate` exists (Android / Chrome / desktop) — wrap it so each
 *     call cancels the in-flight pattern first. Without the cancel, overlapping calls
 *     queue and the device buzzes for the sum of both, which reads as stuck.
 *  2. On iOS web — where `navigator.vibrate` does NOT exist and never will (WebKit's
 *     standards position on the Vibration API is `oppose`) — install a shim that
 *     reaches the Taptic Engine the only way Safari allows: toggling a native
 *     `<input type="checkbox" switch>` (Safari 17.4 / iOS 18+). A hidden switch is
 *     mounted once and driven with `.click()` per pulse.
 *
 * ⚠︎ iOS 26.5 LIMIT — a known, accepted gap. Apple patched programmatic `.click()`
 * triggering in iOS 26.5 (June 2026): on 26.5+ the toggle still runs and this still
 * returns success, but NO haptic fires, and there is no runtime way to detect the
 * patch. The imperative shape simply cannot be delivered there — the only surviving
 * route is a REAL finger on the switch (the declarative `haptic-tick` transducer that
 * every component `haptic` prop routes through). The imperative shim is kept on
 * purpose: it is the API adaptv wants, and it works on every iOS before 26.5.
 */
import { isIOS, isNativePlatform } from "#adaptv/utils/platform"

let installed = false
let iosSwitch: HTMLInputElement | null = null

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

/**
 * A hidden native switch — iOS Safari's one route to the Taptic Engine. `switch` is
 * what routes the toggle to the engine; a bare checkbox produces nothing. `aria-hidden`
 * + `tabindex=-1` keep it out of the accessibility tree and the tab order. Mounted
 * once and reused (recreated only if it was detached).
 */
function iosHapticSwitch(): HTMLInputElement {
  if (iosSwitch?.isConnected) return iosSwitch
  const input = document.createElement("input")
  input.type = "checkbox"
  input.setAttribute("switch", "")
  input.setAttribute("aria-hidden", "true")
  input.tabIndex = -1
  const s = input.style
  s.position = "fixed"
  s.bottom = "0"
  s.left = "0"
  s.width = "1px"
  s.height = "1px"
  s.opacity = "0"
  s.pointerEvents = "none"
  s.appearance = "none"
  s.webkitAppearance = "none"
  document.body.appendChild(input)
  iosSwitch = input
  return input
}

export function installVibratePolyfill(): void {
  if (installed) return
  if (typeof navigator === "undefined") return
  //native uses @capacitor/haptics directly — never this web shim
  if (isNativePlatform()) return

  //Android / Chrome / desktop: a real Vibration API — wrap it (cancel-then-pulse).
  if (typeof navigator.vibrate === "function") {
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
    return
  }

  //iOS web: no Vibration API. Reach the Taptic Engine by toggling a hidden native
  //switch. ⚠ No-op on iOS 26.5+ (Apple patched programmatic .click()) — see header.
  if (typeof document !== "undefined" && isIOS()) {
    installed = true
    //mount up-front (inside a commit / gesture, so body exists) — the first pulse
    //then has nothing to build and fires instantly
    if (document.body) iosHapticSwitch()

    function vibrate(pattern: VibratePattern): boolean
    function vibrate(pattern: Iterable<number>): boolean
    function vibrate(pattern: VibratePattern | Iterable<number>): boolean {
      const normalized = normalizePattern(pattern)
      //a cancel has nothing to stop here — the system tick is instantaneous
      if (isCancelPattern(normalized)) return true
      try {
        iosHapticSwitch().click()
        return true
      } catch {
        return false
      }
    }

    navigator.vibrate = vibrate
  }
}

/**
 * The iOS-web haptic transducer — an invisible `<input type="checkbox" switch>`
 * overlaid on a tap target so the user's **actual finger** lands on it.
 *
 * ## Why this exists (and why it is shaped so strangely)
 *
 * There is no web haptics API on iOS and there never will be one: WebKit's
 * standards position on the Vibration API is formally **`oppose`** (closed
 * 2023-11-14, reopen declined Oct 2025), and Firefox removed `navigator.vibrate`
 * on desktop in 129. iOS Safari has exactly one route to the Taptic Engine — the
 * system tick fired when a `switch`-styled checkbox is toggled.
 *
 * nativ used to reach that route by mounting a hidden switch and calling
 * `.click()` on it. **Apple patched programmatic triggering in iOS 26.5** (June
 * 2026) with no release-note mention; `element.click()` no longer fires the
 * haptic. Confirmed against `ios-haptics@3.1.1` and its issue #8. The only
 * surviving technique is a genuine, hit-testable element under a real touch.
 *
 * ## The architectural consequence
 *
 * A generic imperative `haptics.impact()` is **unimplementable on iOS web** — you
 * cannot synthesise a finger. That is why nativ has two haptic surfaces and not
 * one:
 *
 * - {@link import("#nativ/capabilities/haptics").haptics} — imperative, fire-and-
 *   forget. Real on native (`@capacitor/haptics`) and on Android/Chrome web
 *   (`navigator.vibrate`). A documented **no-op on iOS web**.
 * - `attachHapticTick` (this file) — declarative, attach-to-element. The only
 *   thing that works on iOS web, and therefore the path every *tap-triggered*
 *   haptic in nativ goes through.
 *
 * `Button haptic="…"` was already declarative at the consumer's level, so it
 * routes here transparently and keeps working on all six targets.
 *
 * ## Limits, stated plainly
 *
 * System tick **only** — no impact weights, no notification patterns, no
 * intensity. WebKit-only. Requires the user to have System Haptics enabled, which
 * is not detectable. Costs one DOM node per tap target.
 *
 * @todo DEVICE VERIFICATION REQUIRED — the tests below pin structure and
 * lifecycle, which is all a DOM can prove. Whether the tick actually *fires*
 * can only be confirmed on physical iOS ≥ 26.5 hardware; simulators do not
 * produce haptics.
 */
import { isIOS, isNativePlatform } from "#nativ/utils/platform"

/** Marks the injected node so attach is idempotent and detach is exact. */
export const HAPTIC_TICK_ATTR = "data-nativ-haptic-tick"

/**
 * Whether the switch-overlay trick is the right mechanism *here*.
 *
 * Deliberately narrow. The overlay is a last resort — it costs a DOM node in
 * every tap target and can only ever produce one flavour of tick — so it stays
 * off anywhere a real engine exists:
 *
 * - **native** → `@capacitor/haptics` has the full taxonomy.
 * - **`navigator.vibrate` present** (Android/Chrome) → the imperative path is
 *   strictly better: patterns, weights, no DOM cost.
 * - **not iOS** → this is a WebKit quirk, not a web feature.
 */
export function supportsHapticTick(): boolean {
  if (typeof document === "undefined") return false
  if (isNativePlatform()) return false
  if (typeof navigator === "undefined") return false
  if (typeof navigator.vibrate === "function") return false
  return isIOS()
}

function createOverlay(): HTMLInputElement {
  const input = document.createElement("input")
  input.type = "checkbox"
  //`switch` is what routes the toggle to the Taptic Engine. Without it this is an
  //ordinary checkbox and produces nothing.
  input.setAttribute("switch", "")
  input.setAttribute(HAPTIC_TICK_ATTR, "")

  //It is a transducer, not a control. AT announcing "switch, off" on every button
  //would be a worse regression than having no haptics at all.
  input.setAttribute("aria-hidden", "true")
  input.setAttribute("tabindex", "-1")

  //Cover the host completely: a finger that misses the overlay gets no tick, and
  //the miss would be invisible to everyone but the user.
  const style = input.style
  style.position = "absolute"
  style.top = "0"
  style.left = "0"
  style.width = "100%"
  style.height = "100%"
  style.margin = "0"
  style.opacity = "0"
  //keep it from painting a control or stealing the text cursor
  style.appearance = "none"
  style.webkitAppearance = "none"
  return input
}

/**
 * Overlay a haptic transducer on `host`. Returns a detach function.
 *
 * Safe to call unconditionally: on every platform with a real haptic engine this
 * injects nothing and returns a no-op detach. That is the point — callers never
 * branch on platform, which is the burden nativ exists to absorb (doctrine §0.2).
 *
 * The overlay is a **child** of the host, so a tap that lands on it bubbles to the
 * host and the host's own click handler still runs — no event forwarding, no lost
 * activation, keyboard activation entirely unaffected (the overlay is not
 * focusable).
 *
 * ⚠︎ Nesting an `<input>` inside a `<button>` is invalid HTML. It is done here
 * anyway, knowingly: the node is DOM-appended rather than parsed, so no reparenting
 * occurs; it is `aria-hidden` and unfocusable, so the accessibility tree is
 * unchanged; and the alternative — a sibling overlay — would swallow the host's
 * activation and force every click to be synthetically forwarded, which breaks
 * `event.isTrusted` and with it the very user-activation this feature depends on.
 */
export function attachHapticTick(host: HTMLElement): () => void {
  if (!supportsHapticTick()) return () => {}
  if (host.querySelector(`[${HAPTIC_TICK_ATTR}]`)) return () => {}

  //an absolutely-positioned child needs a containing block, but a host that
  //already positions itself must not be second-guessed
  const positioned = host.style.position !== ""
  if (!positioned) host.style.position = "relative"

  const overlay = createOverlay()
  host.appendChild(overlay)

  return () => {
    overlay.remove()
    if (!positioned) host.style.removeProperty("position")
  }
}

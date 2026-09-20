import { useEffect, useReducer, useRef } from "react"
import { getActiveInputElement } from "#adaptv/hooks/use-keyboard"

/**
 * How much the LAYOUT viewport has shrunk while `active`, in px — `window.innerHeight` at rest
 * minus `window.innerHeight` now, floored at 0.
 *
 * `--adaptv-keyboard-height` is the keyboard's own height on every target, but what a component
 * has to move for is the part of that height the viewport has NOT already given up. iOS never gives
 * any up (the OS resize is off, the sheet and the page keep their whole height); the Android WebView
 * gives all of it up (Capacitor's `SystemBars` pads the WebView by the IME inset, measured 923 → 587
 * for a 336px keyboard, with `virtualKeyboard.overlaysContent` reading true the whole time); a
 * plain-http Chromium tab gives the visual viewport up with no API to say so. Reading the shrink is
 * the one answer that is right on all three without a platform table, and it is what lets a lift
 * or a room be `keyboard - shrink` rather than a double count.
 *
 * While inactive the hook only remembers the rest height, re-read on every resize so a rotation or
 * a browser bar does not pass for a keyboard later. While active it reads the shrink live on every
 * render and re-renders the caller on every resize, so the value is right in the commit that opens
 * the keyboard when the resize came first, and one resize later when it did not.
 *
 * "At rest" means with no keyboard on its way. A resize that lands while a text field holds focus
 * is the keyboard raising, not a new rest: Android Chrome reports `innerHeight` as rest PLUS the
 * keyboard for ~100ms of the raise (783 → 1095 → 783 for a 312px keyboard, `overlaysContent` held),
 * and that frame lands before `useKeyboard` reports open. Taken as the rest it reads as a
 * keyboard-sized shrink once the viewport is back, and the sheet gives up the room it had just
 * grown into. A keyboard never changes the width, so a resize that does is a rotation and is taken
 * even under focus; and the first sample is always taken, so a field that autofocuses on mount
 * (the keyboard not yet moving) still leaves a rest to measure against.
 */
export function useLayoutViewportShrink(active: boolean): number {
  const restRef = useRef({ width: 0, height: 0 })
  const [, rerender] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!active) {
      const rememberRest = () => {
        const rest = restRef.current
        const rotated = window.innerWidth !== rest.width
        if (rest.height > 0 && !rotated && getActiveInputElement()) return
        restRef.current = {
          width: window.innerWidth,
          height: window.innerHeight,
        }
      }
      rememberRest()
      window.addEventListener("resize", rememberRest)
      return () => window.removeEventListener("resize", rememberRest)
    }
    window.addEventListener("resize", rerender)
    return () => window.removeEventListener("resize", rerender)
  }, [active])

  // Read at render time, never remembered: the keyboard event and the OS resize race in either
  // order (measured on the Android WebView: the plugin's event first on one raise, the resize
  // first on the next), and an effect-driven state would hand the caller a stale 0 for the commit
  // that opens the keyboard. A live read is right in the same commit whenever the resize has
  // landed, and the resize listener re-renders the caller when it lands later.
  if (!active || typeof window === "undefined") return 0
  const rest = restRef.current.height
  return rest > 0 ? Math.max(0, rest - window.innerHeight) : 0
}

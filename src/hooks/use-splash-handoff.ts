//The launch handoff: OS splash → the app's own splash. Both are on screen at once for
//a moment, on purpose, and this decides when that moment ends.
import { useEffect, useState } from "react"
import { hideNativeSplash } from "#adaptv/capabilities/splash"
import { firstLaunchHold } from "#adaptv/ota/updater"

/**
 * Stamped on `<html>` the moment the OS splash is off.
 *
 * Its **absence** is the paused state, so the very first painted frame is already
 * correct with nothing written pre-paint. The rule that reads it lives in the critical
 * CSS (`shell/critical-css.ts`) — inline in `<head>`, because a splash animation must
 * be held from frame one, long before the app stylesheet has loaded.
 */
export const SPLASH_REVEALED_ATTR = "data-adaptv-splash-revealed"

/**
 * How long the paint gate may wait before handing off anyway.
 *
 * Belt and braces: a WebView that never runs a frame callback while it is covered by
 * an opaque native view would otherwise leave the OS splash up for good — an app that
 * never launches, traded for a flash that never happens. The ceiling makes the worst
 * case "the handoff is a bit early", which is what the code did before the gate.
 */
const PAINT_GATE_CEILING_MS = 400

/**
 * Resolve once the browser has painted the current tree.
 *
 * Two frames, not one: the first callback runs *before* the pending paint, the second
 * only after it has happened. That is the guarantee the handoff needs — `useEffect`
 * alone does not have it (React flushes passive effects in a scheduler task that can
 * run either side of the paint), and hiding the OS splash over an unpainted WebView is
 * the white flash `launchAutoHide: false` exists to prevent.
 */
function afterNextPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== "function") return Promise.resolve()
  return new Promise((resolve) => {
    const ceiling = setTimeout(resolve, PAINT_GATE_CEILING_MS)
    const done = () => {
      clearTimeout(ceiling)
      resolve()
    }
    requestAnimationFrame(() => requestAnimationFrame(done))
  })
}

/**
 * Run the launch handoff and report **when the app's splash went on screen**.
 *
 * Returns `Date.now()` from the moment the OS splash is gone, and `null` until then —
 * which is `SplashScreenProps.revealedAt`, handed to the app's splash so it can time
 * itself against the thing the user is actually looking at.
 *
 * The order is the whole point, and every step earns its place:
 *
 * 1. **`firstLaunchHold()`** — on a first launch with OTA on, the app may be about to
 *    be replaced by a newer bundle, and the wait for that answer is spent under the OS
 *    splash rather than under a splash that would be torn down by the `reload()`.
 *    Resolves immediately on every other launch, on the web, and whenever OTA is off.
 * 2. **A painted frame** — the app's splash is mounted *underneath* the OS splash, so
 *    it is already drawn when the OS splash lifts. That overlap is the seamless part.
 * 3. **`hideNativeSplash()`** — resolves when the OS splash has finished fading, not
 *    when the bridge acknowledged the call. → `capabilities/splash.ts`
 *
 * Only then is the splash *seen*, so only then does its clock start. Timing it from
 * mount instead is the bug this exists to remove: on a slow boot — or any first launch
 * that waits on an update — a splash written to stay up for a second had already spent
 * that second behind the OS splash, and flashed for the remainder.
 */
export function useSplashHandoff(): number | null {
  const [revealedAt, setRevealedAt] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const handoff = async () => {
      try {
        await firstLaunchHold()
      } catch {
        //the hold is an optimisation, never a gate: a rejected update check must
        //not be the reason an app stays behind its launch screen
      }
      await afterNextPaint()
      await hideNativeSplash()
      if (cancelled) return
      //the attribute and the state describe the same instant, so they are set in the
      //same tick — the splash's CSS animations start on the frame its clock starts
      document.documentElement.setAttribute(SPLASH_REVEALED_ATTR, "")
      setRevealedAt(Date.now())
    }
    void handoff()
    return () => {
      cancelled = true
    }
  }, [])

  return revealedAt
}

import { useEffect, useRef } from "react"
import {
  GesturePriority,
  useGestureCapture,
} from "#adaptv/hooks/use-gesture-capture"

export interface EdgeSwipeGesturesProps {
  /**
   * Fired on a swipe in from the **left** screen edge (a rightward drag) — the
   * iOS "back" gesture. Wire it to `adaptvBack()` rather than to a navigation, so
   * an open drawer or menu takes the swipe first, as it takes Android's back button;
   * a `navigate` here leaves the page with the drawer still open on it. With no
   * history left the chain's floor exits a native Android app, so a screen that must
   * not exit on a swipe registers its own fallback above `BackPriority.RouterBack`
   * for the length of the call.
   */
  left?: () => void
  /**
   * Fired on a swipe in from the **right** screen edge (a leftward drag) — the
   * iOS "forward" gesture.
   */
  right?: () => void
  /**
   * Off switch. When `false`, no listeners are attached and nothing fires. Gate
   * this to the installed app (e.g. `isInstalledApp()` from `@arrzdev/adaptv/utils`) so
   * it doesn't double-fire with the browser's own edge-swipe nav in a tab. Covers
   * both the standalone PWA and a native Capacitor build.
   * @default true
   */
  enabled?: boolean
  /** How close to a screen edge (px) a touch must start to count. @default 30 */
  edgeZone?: number
  /** Horizontal distance (px) the touch must travel to trigger. @default 56 */
  threshold?: number
}

const DEFAULT_EDGE_ZONE_PX = 30
const DEFAULT_THRESHOLD_PX = 56

/**
 * Custom edge-swipe gesture surface — renders nothing, just listens. Fires
 * {@link EdgeSwipeGesturesProps.left} / {@link EdgeSwipeGesturesProps.right} when
 * the user swipes in from a screen edge.
 *
 * Built for the installed app (standalone PWA or native Capacitor build) where the
 * OS edge-swipe is neutralised (in-memory history → no browser entry to navigate
 * to), so the native gesture is inert and this can own it. **Gate `enabled` to the
 * installed app** — in a browser tab the native swipe-nav still works and this
 * would double up with it.
 *
 * Listeners are passive (never block scroll); a swipe only counts when it starts
 * within the edge strip and is horizontal-dominant past `threshold`, so vertical
 * scrolls and taps are ignored.
 *
 * @example
 * ```tsx
 * import { adaptvBack } from "@arrzdev/adaptv/hooks"
 * import { isInstalledApp } from "@arrzdev/adaptv/utils"
 * <EdgeSwipeGestures enabled={isInstalledApp()} left={() => adaptvBack()} />
 * ```
 */
export function EdgeSwipeGestures({
  left,
  right,
  enabled = true,
  edgeZone = DEFAULT_EDGE_ZONE_PX,
  threshold = DEFAULT_THRESHOLD_PX,
}: EdgeSwipeGesturesProps) {
  //keep the latest callbacks in refs so the effect doesn't re-bind every render
  const leftRef = useRef(left)
  const rightRef = useRef(right)
  leftRef.current = left
  rightRef.current = right

  //Highest band: an edge swipe is system-level navigation the user expects to
  //win from anywhere. `onLost` cannot fire in practice (nothing outranks it),
  //but it is wired so a future higher-priority gesture cannot strand this one.
  const capture = useGestureCapture({
    priority: GesturePriority.EdgeSwipe,
    enabled,
  })
  const captureRef = useRef(capture)
  captureRef.current = capture

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return

    let edge: "left" | "right" | null = null
    let startX = 0
    let startY = 0

    function onTouchStart(event: TouchEvent) {
      const touch = event.touches[0]
      //ignore multi-touch (pinch/zoom) and touches away from an edge
      if (event.touches.length !== 1 || !touch) {
        edge = null
        return
      }
      const width = window.innerWidth
      if (touch.clientX <= edgeZone) edge = "left"
      else if (touch.clientX >= width - edgeZone) edge = "right"
      else edge = null

      //Claim the shared arbiter as soon as a touch STARTS in an edge strip.
      //This recogniser only decides at touchend, but waiting until then would be
      //too late to stop a row swipe or drawer drag running underneath the same
      //finger. The condition is deliberately narrow — a few edge pixels — so
      //holding the pointer here does not starve ordinary gestures, and
      //suppressing a row swipe under an edge touch is the intended outcome:
      //system-level back navigation outranks in-content gestures.
      if (edge !== null && !captureRef.current.request()) edge = null

      startX = touch.clientX
      startY = touch.clientY
    }

    function onTouchEnd(event: TouchEvent) {
      const startedFrom = edge
      edge = null
      if (startedFrom !== null) captureRef.current.release()
      const touch = event.changedTouches[0]
      if (!startedFrom || !touch) return

      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      //must be horizontal-dominant, past the distance, in the edge's direction
      if (Math.abs(dx) <= Math.abs(dy) || Math.abs(dx) < threshold) return
      if (startedFrom === "left" && dx > 0) leftRef.current?.()
      else if (startedFrom === "right" && dx < 0) rightRef.current?.()
    }

    function onTouchCancel() {
      if (edge !== null) captureRef.current.release()
      edge = null
    }

    const options = { passive: true } as const
    document.addEventListener("touchstart", onTouchStart, options)
    document.addEventListener("touchend", onTouchEnd, options)
    document.addEventListener("touchcancel", onTouchCancel, options)
    return () => {
      document.removeEventListener("touchstart", onTouchStart)
      document.removeEventListener("touchend", onTouchEnd)
      document.removeEventListener("touchcancel", onTouchCancel)
    }
  }, [enabled, edgeZone, threshold])

  return null
}

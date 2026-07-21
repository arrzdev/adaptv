import { useCallback, useEffect, useId, useRef } from "react"
import type { CaptureOptions } from "#nativ/capabilities/gesture-controller"
import { gestureController } from "#nativ/capabilities/gesture-controller"

export type GestureCapture = {
  /** Ask to own the pointer. `false` means a higher-priority gesture holds it. */
  request: () => boolean
  /** Give it up. Ignored if this gesture no longer holds it. */
  release: () => void
  /** Whether this gesture currently owns the pointer. */
  isCaptured: () => boolean
}

export type GestureCaptureOptions = CaptureOptions & {
  /** Higher wins a contested start. See `BackPriority`-style bands in the controller. */
  priority: number
  /** Fires when a higher-priority gesture takes the pointer away. Reset state here. */
  onLost?: () => void
  /** `false` releases any held capture and refuses new ones. */
  enabled?: boolean
}

/**
 * Bind a component to the shared gesture arbiter.
 *
 * Each mounted instance gets its own identity, so two `Swipeable` rows on the
 * same screen compete as separate gestures rather than aliasing into one.
 *
 * ## Why primitives need this
 *
 * A `Drawer` drag, a `Swipeable` row, a `ScrollView` and edge-swipe-back all
 * compete for the same pointer on a real screen. Each one's own state machine is
 * blind to the others, so without a shared arbiter two can start at once and the
 * winner depends on listener registration order — which is to say, on accident.
 *
 * `useGestureEngine` still owns tap-vs-swipe *within* one element; this decides
 * *which element* gets to start. They compose.
 *
 * `onLost` is not optional in practice: without it a pre-empted gesture stays
 * mid-drag forever — its `onEnd` never runs and the element is left translated.
 */
export function useGestureCapture(
  options: GestureCaptureOptions,
): GestureCapture {
  const id = useId()
  const optionsRef = useRef(options)
  optionsRef.current = options

  const enabled = options.enabled ?? true
  useEffect(() => {
    gestureController.setEnabled(id, enabled)
    //releases any held capture on unmount — a component that disappears
    //mid-drag must not leave the pointer permanently held, which would silently
    //deaden every gesture on the screen
    return () => gestureController.setEnabled(id, false)
  }, [id, enabled])

  const request = useCallback(
    () =>
      gestureController.requestCapture(
        id,
        optionsRef.current.priority,
        () => optionsRef.current.onLost?.(),
        { blocksScroll: optionsRef.current.blocksScroll },
      ),
    [id],
  )

  const release = useCallback(() => gestureController.release(id), [id])
  const isCaptured = useCallback(
    () => gestureController.getCaptured() === id,
    [id],
  )

  return { request, release, isCaptured }
}

/**
 * Priority bands for the built-in primitives.
 *
 * Named so the common cases don't invent numbers, and spaced so an app can slot
 * something between them.
 *
 * ⏳ **The ordering is reasoned, not yet device-tuned.** Edge-swipe outranks a
 * row swipe because it is a system-level navigation the user expects to win from
 * anywhere; a drawer drag outranks scrolling because the drawer is the
 * foreground surface. Both want confirming on hardware with all three on one
 * screen.
 */
export const GesturePriority = {
  EdgeSwipe: 400,
  DrawerDrag: 300,
  SwipeableRow: 200,
  Scroll: 100,
} as const

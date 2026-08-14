import { useCallback, useRef } from "react"
import {
  POINTER_PRESS_OUTSET_PX,
  TOUCH_PRESS_OUTSET_PX,
} from "#adaptv/hooks/use-gesture-engine"

/** The pointer handlers to spread onto the element doing its own hit-testing. */
export type ClickFixHandlers = {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void
  onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void
}

export type UseClickFixOptions = {
  /**
   * Travel (px, per axis) past which a release stops counting as a tap.
   *
   * Defaults to the press engine's own budget, chosen by pointer type — the
   * point of this hook is to agree with it. Pin it only for a surface whose
   * targets are genuinely smaller or larger than a finger.
   */
  maxTravel?: number
}

/**
 * A tap on a target the DOM cannot see — the case the press engine can't serve.
 *
 * Every adaptv primitive already answers "was that a tap, or a scroll that
 * happened to end here?" — {@link useGestureEngine} does it by *containment*,
 * asking whether the release landed inside the element's frame plus a
 * pointer-adaptive margin. That is the better test whenever a frame exists,
 * because a fingertip that wobbles 30px on a large button never left the button.
 *
 * It needs a frame. A canvas painting its own clickable shapes has exactly one
 * element, and every point of every shape is inside it, so containment answers
 * `true` for a scroll that started on a shape and travelled half the screen.
 * The only signal left is how far the pointer moved, which is what this
 * measures.
 *
 * ```tsx
 * const handlers = useClickFix((e) => {
 *   const shape = hitTest(e.clientX, e.clientY)
 *   if (shape) select(shape)
 * })
 * return <canvas {...handlers} />
 * ```
 *
 * ⚠︎ Deliberately does NOT call `preventDefault` or `stopPropagation`. An
 * earlier version of this hook did both, on both handlers, and each is a bug
 * here: `preventDefault` on `pointerdown` suppresses focus and any nested
 * scrolling the surface still wants, and `stopPropagation` hides the pointer
 * from the gesture controller, so the surface silently stops taking part in the
 * arbitration that decides who owns the finger (`COORDINATION.md §3`). Suppress
 * from the callback, where you know which shape was hit.
 *
 * @param onClick Called on a release that stayed within the travel budget.
 */
export function useClickFix(
  onClick: (e: React.PointerEvent<HTMLElement>) => void,
  options: UseClickFixOptions = {},
): ClickFixHandlers {
  const { maxTravel } = options

  //keyed by pointerId, not a single slot: a canvas is pinch-zoomable, so two
  //fingers are ordinary here rather than exotic. One shared anchor lets the
  //second `pointerdown` overwrite the first finger's origin, and the first
  //finger's release is then measured against the wrong point.
  const anchors = useRef(new Map<number, { x: number; y: number }>())

  //latest-ref so the returned handlers keep a stable identity across renders —
  //a canvas re-rendering per frame would otherwise rebind three listeners a frame
  const latest = useRef(onClick)
  latest.current = onClick
  const travel = useRef(maxTravel)
  travel.current = maxTravel

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      anchors.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    },
    [],
  )

  //a scroll or a platform steal ends the pointer without a `pointerup`. Dropping
  //the anchor is what makes the miss detectable below rather than silent.
  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      anchors.current.delete(e.pointerId)
    },
    [],
  )

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const anchor = anchors.current.get(e.pointerId)
    anchors.current.delete(e.pointerId)
    //no anchor: this pointer went down somewhere else, or was cancelled and is
    //now reporting a release we must not read as a tap
    if (!anchor) return

    const budget =
      travel.current ??
      (e.pointerType === "touch"
        ? TOUCH_PRESS_OUTSET_PX
        : POINTER_PRESS_OUTSET_PX)

    //per-axis, matching the engine's rectangular press region — a radial test
    //would disagree with it diagonally, which is where a thumb actually drifts
    const dx = Math.abs(e.clientX - anchor.x)
    const dy = Math.abs(e.clientY - anchor.y)
    if (Math.max(dx, dy) > budget) return

    latest.current(e)
  }, [])

  return { onPointerDown, onPointerUp, onPointerCancel }
}

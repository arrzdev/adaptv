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

/**
 * Travel budget: one number for every pointer, or one per kind.
 *
 * The object form is the reason this is not just `number`. A surface almost never
 * wants the *same* budget for a finger and a mouse — a fingertip needs room a
 * cursor does not — so pinning one kind must not silently pin the other. Whatever
 * is left out keeps the engine's default for that kind.
 */
export type ClickFixTravel =
  | number
  | {
      /** Budget for a finger. Omitted keeps {@link TOUCH_PRESS_OUTSET_PX}. */
      touch?: number
      /** Budget for a mouse or pen. Omitted keeps {@link POINTER_PRESS_OUTSET_PX}. */
      pointer?: number
    }

export type UseClickFixOptions = {
  /**
   * Travel (px, per axis) past which a release stops counting as a tap.
   *
   * Defaults to the press engine's own budget, chosen by pointer type — agreeing
   * with it is the point of this hook, so reach for this only when the surface's
   * targets really are smaller or larger than everything else on the screen. A
   * dense diagram wants less; a game board of big cells can afford more.
   */
  maxTravel?: ClickFixTravel
  /**
   * How long (ms) a press may last and still count as a tap. Unbounded by default.
   *
   * Opt-in because a bound is a claim about the surface, not about the platform:
   * it only makes sense once the surface gives a *hold* its own meaning — tap to
   * select, hold to pan. Set it to the moment the hold takes over, and the tap
   * stops firing underneath it.
   */
  maxDuration?: number
}

/** The budget in force for this pointer — the escape hatch, or the engine's. */
function budgetFor(
  travel: ClickFixTravel | undefined,
  pointerType: string,
): number {
  const isTouch = pointerType === "touch"
  const fallback = isTouch
    ? TOUCH_PRESS_OUTSET_PX
    : POINTER_PRESS_OUTSET_PX
  if (travel === undefined) return fallback
  if (typeof travel === "number") return travel
  //`?? fallback`, not `?? travel.touch` — an object that names only one kind is
  //pinning that kind, and leaving the other adaptive is the whole reason to
  //accept an object at all
  return (isTouch ? travel.touch : travel.pointer) ?? fallback
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
 * Both thresholds carry adaptv's answer by default and take the surface's own if
 * it has one — a dense diagram tightening the budget, a board that gives a hold
 * its own meaning capping the duration:
 *
 * ```tsx
 * useClickFix(select, { maxTravel: { touch: 12 }, maxDuration: 400 })
 * ```
 *
 * @param onClick Called on a release that stayed within the budgets.
 * @param options Per-surface overrides. See {@link UseClickFixOptions}.
 */
export function useClickFix(
  onClick: (e: React.PointerEvent<HTMLElement>) => void,
  options: UseClickFixOptions = {},
): ClickFixHandlers {
  const { maxTravel, maxDuration } = options

  //keyed by pointerId, not a single slot: a canvas is pinch-zoomable, so two
  //fingers are ordinary here rather than exotic. One shared anchor lets the
  //second `pointerdown` overwrite the first finger's origin, and the first
  //finger's release is then measured against the wrong point.
  const anchors = useRef(
    new Map<number, { x: number; y: number; at: number }>(),
  )

  //latest-refs so the returned handlers keep a stable identity across renders —
  //a canvas re-rendering per frame would otherwise rebind three listeners a frame
  const latest = useRef(onClick)
  latest.current = onClick
  const travel = useRef(maxTravel)
  travel.current = maxTravel
  const duration = useRef(maxDuration)
  duration.current = maxDuration

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      //`e.timeStamp`, not `Date.now()` — it is the event's own clock, so a press
      //queued behind a slow frame is not charged for the time it spent waiting
      anchors.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
        at: e.timeStamp,
      })
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

    //a hold the surface gave its own meaning to is not also a tap
    const held = duration.current
    if (held !== undefined && e.timeStamp - anchor.at > held) return

    const budget = budgetFor(travel.current, e.pointerType)

    //per-axis, matching the engine's rectangular press region — a radial test
    //would disagree with it diagonally, which is where a thumb actually drifts
    const dx = Math.abs(e.clientX - anchor.x)
    const dy = Math.abs(e.clientY - anchor.y)
    if (Math.max(dx, dy) > budget) return

    latest.current(e)
  }, [])

  return { onPointerDown, onPointerUp, onPointerCancel }
}

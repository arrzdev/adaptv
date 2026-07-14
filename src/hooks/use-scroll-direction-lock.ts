import type { RefObject } from "react"
import { useEffect } from "react"
import { isIOS } from "#nativ/utils/platform"

export type ScrollAxis = "x" | "y"

// the gesture must travel at least this far before an axis is read — below it the
// direction is noise. Small, so the decision still lands on the first real move.
const DECISION_DISTANCE_PX = 8

// suppress a cross-axis gesture only when it dominates the scroller's own axis by
// this factor — biases toward scrolling, so a sloppy-but-on-axis flick never
// wedges. This is the knob to tune from on-device data.
const CROSS_AXIS_DOMINANCE = 1.5

type DirectionLockOptions = {
  /** The scroller's own axis; the lock suppresses gestures dominated by the other axis. */
  axis: ScrollAxis
  /** Master switch (wired from `ScrollView`'s `directionalLockEnabled`). */
  enabled?: boolean
}

// Does anything between the touch target and the scroller already scroll `axis`?
// If so, the cross-axis gesture belongs to that nested scroller (e.g. a horizontal
// chip row inside a vertical page) — yield instead of suppressing it.
function pathScrollsAxis(
  target: EventTarget | null,
  stopAt: HTMLElement,
  axis: ScrollAxis,
): boolean {
  let node = target instanceof Element ? target : null
  while (node && node !== stopAt) {
    if (node instanceof HTMLElement) {
      const scrolls =
        axis === "x"
          ? node.scrollWidth > node.clientWidth + 1
          : node.scrollHeight > node.clientHeight + 1
      if (scrolls) return true
    }
    node = node.parentElement
  }
  return false
}

/**
 * iOS directional scroll-lock — the web analog of
 * `UIScrollView.isDirectionalLockEnabled`. The web has no native equivalent, so a
 * managed scroller otherwise picks up the cross-axis component of any diagonal
 * gesture (scrolling feels "too sensitive"). Attaches a non-passive `touchmove` to
 * `ref`'s node that commits to one axis on the first significant move of a gesture:
 * a cross-axis-dominant gesture is suppressed (`preventDefault`), everything else
 * scrolls. A nested scroller that owns the cross axis is detected and yielded to,
 * so this never wedges a parent's scroll.
 *
 * iOS-only (every other engine commits to an axis itself). First-move-decides:
 * once `preventDefault` fires, native scrolling for that touch can't be handed
 * back — so the lock only ever blocks on confident cross-axis dominance.
 *
 * NOTE: tune {@link CROSS_AXIS_DOMINANCE} from a REAL device — the Simulator's
 * synthetic swipe is perfectly axis-aligned and won't reproduce diagonal bleed.
 */
export function useScrollDirectionLock(
  ref: RefObject<HTMLElement | null>,
  { axis, enabled = true }: DirectionLockOptions,
) {
  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return
    if (!isIOS()) return

    const crossAxis: ScrollAxis = axis === "y" ? "x" : "y"
    let startX = 0
    let startY = 0
    let decided = false
    let locked = false

    function onTouchStart(event: TouchEvent) {
      // a second finger is pinch/zoom — never lock
      if (event.touches.length !== 1) {
        decided = true
        locked = false
        return
      }
      const touch = event.touches[0]
      startX = touch?.clientX ?? 0
      startY = touch?.clientY ?? 0
      decided = false
      locked = false
    }

    function onTouchMove(event: TouchEvent) {
      if (decided) {
        // one decision per gesture: keep suppressing if locked, else let it scroll
        if (locked && event.cancelable) event.preventDefault()
        return
      }
      const touch = event.touches[0]
      if (!touch) return
      const dx = Math.abs(touch.clientX - startX)
      const dy = Math.abs(touch.clientY - startY)
      if (Math.max(dx, dy) < DECISION_DISTANCE_PX) return

      decided = true
      const crossDominant =
        axis === "y"
          ? dx > dy * CROSS_AXIS_DOMINANCE
          : dy > dx * CROSS_AXIS_DOMINANCE
      // not a confident cross-axis gesture → let it scroll natively
      if (!crossDominant) return
      // a nested scroller owns the cross axis → it's theirs, don't suppress
      if (el && pathScrollsAxis(event.target, el, crossAxis)) return

      locked = true
      if (event.cancelable) event.preventDefault()
    }

    function reset() {
      decided = false
      locked = false
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true })
    el.addEventListener("touchmove", onTouchMove, { passive: false })
    el.addEventListener("touchend", reset, { passive: true })
    el.addEventListener("touchcancel", reset, { passive: true })

    return () => {
      el.removeEventListener("touchstart", onTouchStart)
      el.removeEventListener("touchmove", onTouchMove)
      el.removeEventListener("touchend", reset)
      el.removeEventListener("touchcancel", reset)
    }
  }, [ref, axis, enabled])
}

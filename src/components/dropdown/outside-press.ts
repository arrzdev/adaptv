import { gestureController } from "#adaptv/capabilities/gesture-controller"

/**
 * Outside press for a floating panel (Dropdown, Select): a press anywhere but
 * the panel or its trigger dismisses it.
 *
 * Mouse and pen are decided on `pointerdown` in the capture phase, so the panel
 * is gone before the pressed element's own handler runs.
 *
 * Touch is decided later, on `touchstart` in the bubble phase on `window`, and
 * the reason is event order. `pointerdown` fires BEFORE `touchstart`, and
 * `touchstart` is where the edge-swipe recogniser claims the shared pointer
 * arbiter. Deciding touch at `pointerdown` closed the panel under a back gesture
 * before the gesture existed; at `touchend` the back chain then found nothing to
 * consume and the swipe navigated, which is exactly what coordination.md §2
 * orders against. By `touchstart`-bubble on `window` every document-level
 * recogniser has run, and a pointer a gesture already owns is not a press at
 * all: the gesture decides what happens to the panel (a back swipe closes it
 * through the chain; a cancelled one leaves it open).
 */
export function subscribeOutsidePress(
  isInside: (target: EventTarget | null) => boolean,
  onOutside: () => void,
): () => void {
  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "touch") return
    if (isInside(event.target)) return
    onOutside()
  }
  const onTouchStart = (event: TouchEvent) => {
    if (isInside(event.target)) return
    if (gestureController.getCaptured() !== null) return
    onOutside()
  }
  window.addEventListener("pointerdown", onPointerDown, true)
  window.addEventListener("touchstart", onTouchStart)
  return () => {
    window.removeEventListener("pointerdown", onPointerDown, true)
    window.removeEventListener("touchstart", onTouchStart)
  }
}

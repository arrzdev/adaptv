import { useEffect } from "react"

//iOS recognizes a double-tap only when the second tap lands within ~this window
//of the first; past it the OS reads two separate single taps and never arms the
//loupe — so there is nothing to suppress beyond it. Matching the OS window
//(rather than a wider one) is what keeps a tap-then-scroll from looking like a
//double-tap: the scroll flick almost always begins later than this.
const DOUBLE_TAP_MS = 350

//the two taps of a loupe double-tap land on essentially the same point
const DOUBLE_TAP_RADIUS_PX = 28

//travel past which a touch is a scroll/swipe, not a stationary tap
const TAP_MOVE_SLOP_PX = 10

//a press held longer than this is a long-press (drag, callout), not the quick
//tap that opens a double-tap — don't let it arm the next touch
const TAP_MAX_MS = 700

//interactive controls keep their native touch flow untouched. `.clickable` is the
//design-system marker every control root carries (Button / Link / Checkbox /
//Switch); the native + ARIA selectors catch anything that doesn't use it. We skip
//these so a genuine rapid double-tap on a control never loses its second tap, and
//so we never interfere with the gesture engine. Activation rides pointer events,
//which preventDefault on touchstart doesn't touch — but skipping is the clean line.
const INTERACTIVE_SELECTOR =
  '.clickable, a[href], button, [role="button"], [role="link"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="slider"]'

//editable hosts keep the native caret loupe and double-tap-to-select-word. Covers
//inherited contenteditable (isContentEditable) plus every explicit editable mode,
//without matching a `contenteditable="false"` island.
const EDITABLE_SELECTOR =
  "input, textarea, select, [contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only']"

//a touch over one of these must be left fully native — never suppressed
function isProtectedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target instanceof HTMLElement && target.isContentEditable)
    return true
  if (target.closest(EDITABLE_SELECTOR)) return true
  return target.closest(INTERACTIVE_SELECTOR) !== null
}

/**
 * Suppresses the iOS Safari / WebKit text-selection magnifier ("loupe") — the
 * bubble that pops up on a double-tap (tap, then tap-and-hold) over ANY web
 * content, including non-selectable text and empty space.
 *
 * It is NOT governed by `user-select`, `-webkit-touch-callout`, or `touch-action`
 * (those control selection, the callout menu, and pan/zoom), so no CSS turns it
 * off. This is WebKit bug 231161. The loupe is armed by the SECOND `touchstart`
 * of a double-tap, so the only thing that stops it is a non-passive `touchstart`
 * listener that `preventDefault()`s exactly that second tap. Wired always-on into
 * {@link RoutingShell} as part of the native-feeling shell.
 *
 * ## Why this shape (and not a time-only heuristic)
 *
 * `preventDefault()` on a `touchstart` cancels the WHOLE gesture that touch would
 * start — including scrolling. So a suppressor that fires on any quick second
 * `touchstart` also kills rapid scroll flicks and chains across tap-spam. To cut
 * the loupe and nothing else, a touch is only treated as a double-tap's second
 * tap when ALL hold:
 *
 *  1. It follows a COMPLETED, stationary, single-finger tap (tracked via
 *     `touchend`). A scroll flick moves, so it never records as that first tap —
 *     a following flick is therefore never read as a second tap. Scrolling is
 *     safe by construction, not by threshold tuning.
 *  2. It arrives inside {@link DOUBLE_TAP_MS} — the OS's own double-tap window;
 *     past it iOS arms no loupe, so there's nothing to suppress.
 *  3. It lands within {@link DOUBLE_TAP_RADIUS_PX} of that first tap.
 *  4. It is single-finger (a second finger is pinch/zoom, never the loupe).
 *  5. Its target is neither editable nor interactive ({@link isProtectedTarget}).
 *
 * After a suppression the first-tap anchor is cleared and the consumed touch is
 * not re-recorded, so a third rapid tap starts a fresh pair instead of chaining
 * `preventDefault` across every following touch (the old tap-spam freeze).
 *
 * We never `stopPropagation`, so pointer events, the gesture engine, and the
 * dnd-kit `TouchSensor` still see every touch — only the browser's default loupe
 * is cut.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THIS IS A WORKAROUND FOR AN APPLE BUG — DELETE IT ONCE APPLE RE-FIXES IT.
 * Apple already fixed 231161 once (iOS 15.2) and then RE-REGRESSED it (reported
 * again 2025+), so do not assume it's gone — re-test on each major iOS release
 * before removing:
 *   1. Comment out the `useSuppressTextMagnifier()` call in `RoutingShell`
 *      (`shell/shell-layout.tsx`).
 *   2. On a REAL iOS device (the Simulator does NOT reliably reproduce the
 *      loupe), double-tap-then-hold a plain, non-editable bit of text.
 *   3. No magnifier bubble appears → WebKit has fixed it: delete this hook and
 *      its call site. Bubble still appears → keep the patch.
 * Upstream status: https://bugs.webkit.org/show_bug.cgi?id=231161
 * ───────────────────────────────────────────────────────────────────────────
 */
export function useSuppressTextMagnifier({
  enabled = true,
}: {
  enabled?: boolean
} = {}) {
  useEffect(() => {
    if (!enabled) return
    //anchor: the last clean, stationary single-finger tap (recorded at its
    //touchend). a following touch is measured against this to decide "second tap".
    let lastTapAt = 0
    let lastTapX = 0
    let lastTapY = 0

    //state of the touch currently down (the loupe gesture is single-finger)
    let startX = 0
    let startY = 0
    let startAt = 0
    let moved = false
    let multiTouch = false
    //set when we cancelled this touch as a double-tap's second tap — so its
    //touchend doesn't re-arm as a fresh first tap and chain into the next touch
    let consumedAsSecondTap = false

    function onTouchStart(event: TouchEvent) {
      const now = Date.now()

      //a second finger is a pinch/zoom gesture, never a loupe double-tap
      if (event.touches.length > 1) {
        multiTouch = true
        lastTapAt = 0
        return
      }

      const touch = event.changedTouches[0]
      const x = touch?.clientX ?? 0
      const y = touch?.clientY ?? 0

      //reset per-touch tracking for this new finger
      startX = x
      startY = y
      startAt = now
      moved = false
      multiTouch = false
      consumedAsSecondTap = false

      const withinTime =
        lastTapAt !== 0 && now - lastTapAt <= DOUBLE_TAP_MS
      const withinSpot =
        Math.abs(x - lastTapX) <= DOUBLE_TAP_RADIUS_PX &&
        Math.abs(y - lastTapY) <= DOUBLE_TAP_RADIUS_PX

      if (!withinTime || !withinSpot) return
      if (isProtectedTarget(event.target)) return

      //this is the second tap of a double-tap over plain content: its default
      //action arms the loupe. cancel only this; passive:false (below) allows it.
      if (event.cancelable) event.preventDefault()

      //break the pair so a third rapid tap doesn't chain off this one
      lastTapAt = 0
      consumedAsSecondTap = true
    }

    //passive: observing movement must never block the scroll it's watching
    function onTouchMove(event: TouchEvent) {
      if (moved || multiTouch) return
      const touch = event.changedTouches[0]
      if (!touch) return
      if (
        Math.abs(touch.clientX - startX) > TAP_MOVE_SLOP_PX ||
        Math.abs(touch.clientY - startY) > TAP_MOVE_SLOP_PX
      ) {
        moved = true
      }
    }

    function onTouchEnd(event: TouchEvent) {
      //fingers still down → this was part of a multi-touch gesture, not a tap
      const wasMultiTouch = multiTouch || event.touches.length > 0
      const duration = Date.now() - startAt
      const isCleanTap =
        !wasMultiTouch &&
        !moved &&
        !consumedAsSecondTap &&
        duration <= TAP_MAX_MS

      if (isCleanTap) {
        //record as the first tap of a potential double-tap
        lastTapAt = Date.now()
        lastTapX = startX
        lastTapY = startY
      } else {
        //a scroll, long-press, multi-touch, or already-consumed touch can't open
        //a double-tap — drop any pending anchor
        lastTapAt = 0
      }

      if (event.touches.length === 0) multiTouch = false
    }

    //the system took over the gesture (scroll handoff, etc.) — drop all state so
    //a stale anchor can't manufacture a false double-tap on the next touch
    function onTouchCancel() {
      lastTapAt = 0
      moved = false
      multiTouch = false
      consumedAsSecondTap = false
    }

    //capture: run before any inner stopPropagation so we can always evaluate.
    //passive:false on touchstart is what makes preventDefault on it allowed.
    document.addEventListener("touchstart", onTouchStart, {
      capture: true,
      passive: false,
    })
    document.addEventListener("touchmove", onTouchMove, {
      capture: true,
      passive: true,
    })
    document.addEventListener("touchend", onTouchEnd, {
      capture: true,
      passive: true,
    })
    document.addEventListener("touchcancel", onTouchCancel, {
      capture: true,
      passive: true,
    })

    return () => {
      document.removeEventListener("touchstart", onTouchStart, {
        capture: true,
      })
      document.removeEventListener("touchmove", onTouchMove, {
        capture: true,
      })
      document.removeEventListener("touchend", onTouchEnd, {
        capture: true,
      })
      document.removeEventListener("touchcancel", onTouchCancel, {
        capture: true,
      })
    }
  }, [enabled])
}

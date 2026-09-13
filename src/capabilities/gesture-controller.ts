/**
 * The gesture controller — a single arbiter for the pointer stream.
 * → `docs/design/coordination.md §3`
 *
 * ## The problem
 *
 * On a real screen, a `Drawer` drag, a `Swipeable` row, a `ScrollView` and
 * edge-swipe-back all compete for the same pointer. Exactly one may win. Without
 * a shared arbiter each handler is blind to the others, so two can start at once
 * and the result depends on listener registration order — which is to say, on
 * accident.
 *
 * `useGestureEngine` already handles tap-vs-swipe **on a single element** via
 * pointer capture. This is the layer above it: it decides *which element's*
 * gesture starts when several could. The two compose; neither replaces the other.
 *
 * Modelled on Ionic's gesture controller, whose semantics are well-tested — with
 * the arbitration kept as **pure logic**, no DOM, so the hard part is unit-
 * testable and the DOM binding stays a thin shell.
 * @see https://github.com/ionic-team/ionic-framework/blob/6251eb85db0e5b43b9e09604248dc8451e1664c0/core/src/utils/gesture/gesture-controller.ts
 * Why: the priority/capture model and the `disableScroll` reference-counting
 * approach are load-bearing behaviours Ionic arrived at over years of device
 * bugs. MIT © 2015-present Drifty Co. — see `THIRD_PARTY_LICENSES`.
 */

export type CaptureOptions = {
  /**
   * Stop the scroll container while this gesture owns the pointer.
   *
   * This exists because **`touch-action` cannot be changed mid-touch on iOS** —
   * once a touch sequence begins, the value latched at `touchstart` applies for
   * its whole life. Blocking the scroller imperatively is the only reliable
   * cross-platform way to stop a scroll that a drag has taken over from.
   */
  blocksScroll?: boolean
}

type Holder = {
  id: string
  priority: number
  onLost?: () => void
  blocksScroll: boolean
}

export type GestureController = ReturnType<typeof createGestureController>

/**
 * Create a gesture controller. adaptv uses one shared instance
 * ({@link gestureController}); this factory exists so tests get a clean arbiter
 * instead of leaking capture state between cases.
 */
export function createGestureController() {
  let holder: Holder | null = null
  const disabled = new Set<string>()

  function releaseHolder(notify: boolean): void {
    const previous = holder
    holder = null
    if (notify) previous?.onLost?.()
  }

  return {
    /**
     * Ask to own the pointer. Returns whether the request was granted.
     *
     * Pre-emption requires a **strictly** higher priority. Ties must not
     * pre-empt: two same-priority handlers would otherwise steal the pointer back
     * and forth on every move event, and neither would ever complete.
     *
     * `onLost` fires if this gesture is later pre-empted or disabled — without
     * it, the loser stays mid-drag forever, its `onEnd` never runs, and the
     * element is left translated.
     */
    requestCapture(
      id: string,
      priority: number,
      onLost?: () => void,
      options: CaptureOptions = {},
    ): boolean {
      if (disabled.has(id)) return false

      const next: Holder = {
        id,
        priority,
        onLost,
        blocksScroll: options.blocksScroll ?? false,
      }

      if (holder === null) {
        holder = next
        return true
      }
      //re-requesting your own capture is a refresh, not a steal — and must not
      //fire your own onLost
      if (holder.id === id) {
        holder = next
        return true
      }
      if (priority <= holder.priority) return false

      releaseHolder(true)
      holder = next
      return true
    },

    /**
     * Give up the pointer.
     *
     * Ignored unless `id` currently holds it. A pre-empted gesture's cleanup must
     * not free the pointer out from under the gesture that took it — a real
     * ordering hazard, because the loser's own `pointerup` routinely arrives
     * *after* the winner has already started.
     */
    release(id: string): void {
      if (holder?.id !== id) return
      releaseHolder(false)
    },

    /** The gesture currently owning the pointer, if any. */
    getCaptured(): string | null {
      return holder?.id ?? null
    },

    /** Whether the scroll container should be held still right now. */
    isScrollBlocked(): boolean {
      return holder?.blocksScroll === true
    },

    /**
     * Enable/disable a gesture by id.
     *
     * Disabling the current holder **releases** the capture. A drawer unmounting
     * mid-drag must not leave the pointer permanently held — that would silently
     * deaden every gesture on the screen with no error anywhere.
     */
    setEnabled(id: string, enabled: boolean): void {
      if (enabled) {
        disabled.delete(id)
        return
      }
      disabled.add(id)
      if (holder?.id === id) releaseHolder(true)
    },

    /**
     * Forget a gesture that no longer exists.
     *
     * Releases the capture exactly as disabling does — `onLost` included, since
     * a component that disappears mid-drag must not leave the pointer held — and
     * then drops every trace of `id`.
     *
     * This is not `setEnabled(id, false)` because disabling has to *remember*:
     * a disabled gesture is refused until it is enabled again. A gone one never
     * asks again, and its React binding mints a fresh `useId` per mount, so an
     * unmount that disabled instead of unregistering grew this controller by one
     * id for good — 9 per `/` ↔ `/settings` round trip in the playground.
     */
    unregister(id: string): void {
      disabled.delete(id)
      if (holder?.id === id) releaseHolder(true)
    },
  }
}

/** The shared arbiter. One per app — gestures compete against each other, not in isolation. */
export const gestureController = createGestureController()

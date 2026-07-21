import { useCallback, useRef } from "react"
import { attachHapticTick } from "#nativ/capabilities/haptic-tick"

/**
 * Attach the iOS-web haptic transducer to an element. Returns a ref callback.
 *
 * ```tsx
 * const ref = useHapticTick()
 * return <button ref={ref}>Save</button>
 * ```
 *
 * On every platform with a real haptic engine — native, and any browser with
 * `navigator.vibrate` — this attaches nothing and costs nothing, so callers never
 * branch on platform. See `haptic-tick.ts` for why tap-triggered haptics on iOS
 * web *must* be declarative.
 *
 * Implemented as a **ref callback rather than an effect** on purpose: the overlay
 * has to exist by the time the user's finger can land, and a ref callback runs
 * during commit, before paint. A `useEffect` would leave the first frame of a
 * freshly-mounted button silent — which is exactly the frame a user tapping
 * through a fast flow is most likely to hit.
 *
 * @param enabled pass `false` to detach (e.g. a `haptic` prop toggling off).
 */
export function useHapticTick(
  enabled = true,
): (el: HTMLElement | null) => void {
  const detachRef = useRef<(() => void) | null>(null)

  return useCallback(
    (el: HTMLElement | null) => {
      //always tear down first: this callback re-fires when `enabled` changes or
      //the host node is swapped, and a stale overlay would be orphaned on the old
      //element with no way left to reach it
      detachRef.current?.()
      detachRef.current = null

      if (el && enabled) detachRef.current = attachHapticTick(el)
    },
    [enabled],
  )
}

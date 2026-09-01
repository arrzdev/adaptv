import { useEffect } from "react"
import { haptics } from "#adaptv/capabilities/haptics"
import { installVibratePolyfill } from "#adaptv/utils/install-vibrate-polyfill"

/**
 * Unified haptic feedback — one hook, imperative, called from an event handler:
 *
 * ```tsx
 * const haptic = useHaptics()
 * <button onClick={() => haptic.impact("light")}>Save</button>
 * ```
 *
 * The platform branching lives *inside* — you never pick a mechanism:
 * - **native** (iOS / Android via Capacitor) → the real Taptic / OS engine, full taxonomy.
 * - **Android / desktop web** → `navigator.vibrate` patterns.
 * - **iOS web** → a hidden native `<input switch>` toggled to fire the system tick.
 *   ⚠︎ **No-op on iOS 26.5+** — Apple patched programmatic triggering, and no
 *   imperative call can reach the Taptic Engine there. **`isSupported()` still
 *   returns `true`**: the patch has no runtime tell, so the shim installs and
 *   `navigator.vibrate` is a function that fires nothing
 *   (`utils/install-vibrate-polyfill.ts`). Do not gate UI on it for this case.
 *   Every iOS before 26.5 feels it.
 *
 * The hook installs the iOS transducer on mount so the first tap fires instantly. For
 * component tap feedback that must also work on iOS 26.5+, use a primitive's `haptic`
 * prop (`<Button haptic="light">`) — it routes through the declarative transducer,
 * the one path a patched imperative call cannot replace.
 */
export function useHaptics() {
  //mount the iOS switch up-front, so the first imperative call in a handler fires
  //without a build step racing the tap. A no-op everywhere a real engine exists.
  useEffect(() => {
    installVibratePolyfill()
  }, [])

  return haptics
}

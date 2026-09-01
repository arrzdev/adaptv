//Haptics — imperative device feedback, platform-branched. NATIVE uses the real
//engine (@capacitor/haptics); WEB approximates the taxonomy with navigator.vibrate
//patterns. Exposed as a plain API (not a hook): firing feedback is fire-and-forget
//— see the hook-vs-API rule in VISION.md.
//
//⚠︎ iOS WEB: fires the system tick by toggling a hidden native `<input switch>`
//(see install-vibrate-polyfill.ts) — but ONLY before iOS 26.5. Apple patched
//programmatic `.click()` in 26.5, so on 26.5+ the call reports success and produces
//nothing, with no runtime way to detect the patch. That gap is accepted: the only
//mechanism surviving 26.5 is a REAL finger on the switch — the declarative
//`attachHapticTick` / `useHapticTick` transducer (#adaptv/capabilities/haptic-tick)
//that every primitive's `haptic` prop routes through, so `Button haptic="light"`
//keeps working on 26.5+ while this imperative call does not.
//
//Use this API — or the `useHaptics` hook wrapping it — for feedback not necessarily
//tied to a tap (a completed upload, a countdown). @see docs/decisions/register.md B10
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics"
import { installVibratePolyfill } from "#adaptv/utils/install-vibrate-polyfill"
import { hasNativePlugin } from "#adaptv/utils/native-plugins"
import { isNativePlatform } from "#adaptv/utils/platform"

export type ImpactWeight = "light" | "medium" | "heavy"
export type NotifyType = "success" | "warning" | "error"

/**
 * Whether the pulse goes through the native plugin. The impact/notify/selection
 * branches ask THIS rather than `isNativePlatform()`: an OTA bundle can be
 * running on a binary that predates the plugin, and each branch then falls
 * through to the web pulse instead of doing nothing. → `docs/design/ota.md §5.6`
 */
function viaPlugin(): boolean {
  return isNativePlatform() && hasNativePlugin("Haptics")
}

const COOLDOWN_MS = 200
let lastPulseAt = 0

//web pulse approximations of the native taxonomy (navigator.vibrate patterns)
const WEB_IMPACT: Record<ImpactWeight, VibratePattern> = {
  light: 8,
  medium: 22,
  heavy: 26,
}
const WEB_NOTIFY: Record<NotifyType, VibratePattern> = {
  success: 40,
  warning: [26, 50, 26],
  error: [40, 50, 40],
}
const WEB_SELECTION: VibratePattern = 8

const IMPACT_STYLE: Record<ImpactWeight, ImpactStyle> = {
  light: ImpactStyle.Light,
  medium: ImpactStyle.Medium,
  heavy: ImpactStyle.Heavy,
}
const NOTIFY_TYPE: Record<NotifyType, NotificationType> = {
  success: NotificationType.Success,
  warning: NotificationType.Warning,
  error: NotificationType.Error,
}

function webPulse(pattern: VibratePattern): void {
  if (typeof navigator === "undefined") return
  //install the iOS-18 polyfill lazily so `haptics` works standalone (the call site
  //is a user gesture, which is exactly when the polyfill needs to fire)
  installVibratePolyfill()
  if (typeof navigator.vibrate !== "function") return
  //throttle: rapid repeats on web feel like noise (native handles its own cadence)
  const now = Date.now()
  if (now - lastPulseAt < COOLDOWN_MS) return
  lastPulseAt = now
  navigator.vibrate(pattern)
}

/**
 * Imperative haptic feedback. Same call on every platform; the right backend is
 * chosen underneath (native engine / web pulse / no-op when unsupported).
 */
export const haptics = {
  /** A physical tap. `weight` maps to the native impact style; approximated on web. */
  impact(weight: ImpactWeight = "light"): void {
    if (viaPlugin()) {
      try {
        void Haptics.impact({ style: IMPACT_STYLE[weight] })
        return
      } catch {
        //plugin unavailable — fall through to the web pulse
      }
    }
    webPulse(WEB_IMPACT[weight])
  },
  /** Notification feedback — success / warning / error. */
  notify(type: NotifyType): void {
    if (viaPlugin()) {
      try {
        void Haptics.notification({ type: NOTIFY_TYPE[type] })
        return
      } catch {
        //plugin unavailable — fall through
      }
    }
    webPulse(WEB_NOTIFY[type])
  },
  /** A light selection tick (list/segmented changes). */
  selection(): void {
    if (viaPlugin()) {
      try {
        void Haptics.selectionChanged()
        return
      } catch {
        //plugin unavailable — fall through
      }
    }
    webPulse(WEB_SELECTION)
  },
  /** Whether haptic feedback is available here (installs the iOS polyfill first). */
  isSupported(): boolean {
    if (viaPlugin()) return true
    if (typeof navigator === "undefined") return false
    installVibratePolyfill()
    return typeof navigator.vibrate === "function"
  },
}

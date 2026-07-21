//Haptics — imperative device feedback, platform-branched. NATIVE uses the real
//engine (@capacitor/haptics); WEB approximates the taxonomy with navigator.vibrate
//patterns. Exposed as a plain API (not a hook): firing feedback is fire-and-forget
//— see the hook-vs-API rule in VISION.md.
//
//⚠︎ THIS API IS A NO-OP ON iOS WEB, AND THAT IS NOT FIXABLE HERE.
//
//iOS Safari has no navigator.vibrate and never will (WebKit's standards position
//on the Vibration API is formally `oppose`). Its one route to the Taptic Engine is
//the system tick fired when a `switch`-styled checkbox is toggled BY A REAL FINGER
//— Apple patched programmatic .click() in iOS 26.5. You cannot synthesise a touch,
//so no imperative call can reach it.
//
//That is a shape mismatch, not a missing feature: the mechanism is inherently
//declarative. For tap-triggered feedback use `attachHapticTick` /
//`useHapticTick` (#nativ/capabilities/haptic-tick), which every nativ primitive
//with a `haptic` prop already routes through — so `Button haptic="light"` works on
//all six targets while `haptics.impact()` silently does nothing on one of them.
//
//Use this API for feedback NOT tied to a tap (a completed upload, a countdown).
//Accept that iOS web won't feel it. @see docs/DECISIONS.md B10
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics"
import { installVibratePolyfill } from "#nativ/utils/install-vibrate-polyfill"
import { isNativePlatform } from "#nativ/utils/platform"

export type ImpactWeight = "light" | "medium" | "heavy"
export type NotifyType = "success" | "warning" | "error"

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
    if (isNativePlatform()) {
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
    if (isNativePlatform()) {
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
    if (isNativePlatform()) {
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
    if (isNativePlatform()) return true
    if (typeof navigator === "undefined") return false
    installVibratePolyfill()
    return typeof navigator.vibrate === "function"
  },
}

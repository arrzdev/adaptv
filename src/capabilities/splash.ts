//Native splash bridge. The Capacitor OS splash covers launch → first JS frame; we
//hide it once the app's own splash has painted so it hands off seamlessly (no gap,
//no double-splash). No-op on web — there the OS/browser splash and the custom
//overlay are handled by the manifest + critical CSS.
import { SplashScreen } from "@capacitor/splash-screen"
import { isNativePlatform } from "#adaptv/utils/platform"

/**
 * How long the OS splash takes to fade out once `hide()` is called.
 *
 * The plugin's default on **both** platforms, and adaptv does not override it: iOS
 * runs a 200 ms linear `UIView.transition`, Android a 200 ms `launchFadeOutDuration`
 * (its per-call `fadeOutDuration` is ignored for the *launch* splash — it warns and
 * uses the config value, which is why there is nothing to pass here).
 */
export const NATIVE_SPLASH_FADE_MS = 200

/**
 * Hide the native launch splash, and resolve when it is actually **gone**.
 *
 * Resolving on the fade rather than on the bridge is deliberate, twice over:
 *
 * - `hide()`'s promise means "the fade has been *started*", not "the splash is off".
 *   iOS resolves the call immediately after dispatching the animation, so awaiting it
 *   would report the handoff ~200 ms early — and the whole point of this promise is to
 *   time what the user can see (`SplashScreenProps.revealedAt`).
 * - It is never awaited, so a bridge that hangs (or a plugin that is missing) cannot
 *   strand the app behind its own splash. The reveal is a wall-clock fact about a
 *   native animation; it must not be hostage to a JS→native round trip.
 *
 * Safe to call anytime; resolves immediately off native, where there is no OS splash
 * to take down.
 */
export function hideNativeSplash(): Promise<void> {
  if (!isNativePlatform()) return Promise.resolve()
  //Plugin unavailable or the OS refused: the config `launchAutoHide` still clears
  //the splash. A bridge failure arrives as a rejection, never a throw, and an
  //unawaited one would reach the window's `unhandledrejection` event (the console,
  //any error reporter the app installed) on every launch.
  void SplashScreen.hide().catch(() => {})
  return new Promise((resolve) =>
    setTimeout(resolve, NATIVE_SPLASH_FADE_MS),
  )
}

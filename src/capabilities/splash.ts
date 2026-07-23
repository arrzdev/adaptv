//Native splash bridge. The Capacitor OS splash covers launch → first JS frame; we
//hide it once the app has painted so it hands off seamlessly to the custom React
//splash (no gap, no double-splash). No-op on web — there the OS/browser splash and
//the custom overlay are handled by the manifest + critical CSS.
import { SplashScreen } from "@capacitor/splash-screen"
import { isNativePlatform } from "#adaptv/utils/platform"

/** Hide the native launch splash. Safe to call anytime; no-op off native. */
export function hideNativeSplash(): void {
  if (!isNativePlatform()) return
  try {
    void SplashScreen.hide()
  } catch {
    //plugin unavailable — the config `launchAutoHide` still clears it
  }
}

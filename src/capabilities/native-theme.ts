//Mirror the app's theme PREFERENCE into native storage so the launch code can read
//it before any JS runs — this is what lets the OS splash colour follow the app theme
//(light/dark) instead of the system setting. The OS draws the splash before the
//WebView exists, so it can't read localStorage; the native side reads this value and
//applies a per-app night mode the OS honours for the next launch's splash.
//No-op off native. Stored via @capacitor/preferences (Android SharedPreferences
//"CapacitorStorage" / iOS UserDefaults) under a stable key the native launch reads.
import type { UiThemePreference } from "#nativ/hooks/use-theme"
import { isNativePlatform } from "#nativ/utils/platform"

/** Native storage key the launch code (MainActivity / AppDelegate) reads. */
export const NATIVE_THEME_PREF_KEY = "nativ-theme"

/** Persist the theme preference to native storage (native only; fire-and-forget). */
export async function persistNativeThemePreference(
  preference: UiThemePreference,
): Promise<void> {
  if (!isNativePlatform()) return
  try {
    const { Preferences } = await import("@capacitor/preferences")
    await Preferences.set({
      key: NATIVE_THEME_PREF_KEY,
      value: preference,
    })
  } catch {
    //plugin unavailable — the OS splash falls back to system appearance
  }
}

//Mirror the app's theme PREFERENCE into native storage so the launch code can read
//it before any JS runs — this is what lets the OS splash colour follow the app theme
//(light/dark) instead of the system setting. The OS draws the splash before the
//WebView exists, so it can't read localStorage; the native side reads this value and
//applies a per-app night mode the OS honours for the next launch's splash.
//No-op off native. Stored via @capacitor/preferences (Android SharedPreferences
//"CapacitorStorage" / iOS UserDefaults) under a stable key the native launch reads.
import { isNativePlatform } from "#adaptv/utils/platform"

/**
 * What the user asked for, as distinct from what is painted: `"system"`
 * follows the OS. Declared here, at the bottom of the ladder, because the
 * hook, the pre-paint script and the config all speak it and this is the one
 * module none of them sits below.
 */
export type UiThemePreference = "light" | "dark" | "system"

/** Native storage key the launch code (MainActivity / AppDelegate) reads. */
export const NATIVE_THEME_PREF_KEY = "adaptv-theme"

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

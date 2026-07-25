//Status-bar accessor — NATIVE ONLY. This is the thing a PWA can't do: on a native
//Android/iOS build we control the system bars (and, via edge-to-edge, draw content
//under them with safe-area padding). On web it's a no-op — the browser owns them.
//
//Icon styling goes through Capacitor 8's core `SystemBars` (@capacitor/core), the
//supported 2026 path: `@capacitor/status-bar`'s setBackgroundColor is dead on Android
//API 35+/36 (resolves successfully, does nothing — DECISIONS.md §6.0 / NATIVE-SHELL
//§0.0), and its setStyle is status-bar-only. SystemBars.setStyle styles BOTH the status
//and navigation bars, so nav-bar icon contrast is now first-party too.
//
//`SystemBarsStyle` naming is inverted vs intuition (same as the old StatusBar plugin):
//  Style.Dark  = light content (for a DARK background)
//  Style.Light = dark content  (for a LIGHT background)
import { SystemBars, SystemBarsStyle } from "@capacitor/core"
import { StatusBar } from "@capacitor/status-bar"
import { isNativePlatform } from "#adaptv/utils/platform"

export type StatusBarAppearance = "light" | "dark"

/**
 * Sync the native system bars' icon style to the app's resolved theme. No-op on web.
 * Background colour is deliberately NOT set here: `setBackgroundColor` is dead on modern
 * Android and always was on iOS. The bar background comes from CSS — the rendered
 * html/body colour under the inset (DECISIONS.md B17) — not a native call.
 */
export function applyStatusBar(appearance: StatusBarAppearance): void {
  if (!isNativePlatform()) return
  try {
    void SystemBars.setStyle({
      style:
        appearance === "dark"
          ? SystemBarsStyle.Dark
          : SystemBarsStyle.Light,
    }).catch(() => {})
  } catch {
    //plugin unavailable / unsupported call — leave the OS bars as-is
  }
}

/**
 * Enable edge-to-edge on native: content draws under the system bars, and the shell's
 * safe-area utilities pad it back. No-op on web.
 *
 * On Android API 36 edge-to-edge is unconditional and SystemBars owns it, so this call
 * is a no-op there; it survives because `setOverlaysWebView(true)` still does real work
 * on iOS and Android ≤ 14. @adaptv/shell (roadmap #4) retires the last StatusBar call
 * once the SystemBars-only path is verified on device.
 */
export function enableEdgeToEdge(): void {
  if (!isNativePlatform()) return
  try {
    void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {})
  } catch {
    //older plugin / unsupported — safe to ignore
  }
}

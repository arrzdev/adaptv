//Status-bar accessor — NATIVE ONLY. This is the thing a PWA can't do: on a native
//Android/iOS build we control the status bar (and, via edge-to-edge, draw content
//under it with safe-area padding). On web it's a no-op — the browser owns the bar.
//
//Capacitor `Style` naming is inverted vs intuition:
//  Style.Dark  = light content (for a DARK background)
//  Style.Light = dark content  (for a LIGHT background)
import { StatusBar, Style } from "@capacitor/status-bar"
import { isNativePlatform } from "#adaptv/utils/platform"

export type StatusBarAppearance = "light" | "dark"

/**
 * Sync the native status bar to the app's resolved theme. `backgroundColor` is
 * applied on Android only (iOS ignores / throws — swallowed). No-op on web.
 */
export function applyStatusBar(
  appearance: StatusBarAppearance,
  backgroundColor?: string,
): void {
  if (!isNativePlatform()) return
  try {
    void StatusBar.setStyle({
      style: appearance === "dark" ? Style.Dark : Style.Light,
    })
    if (backgroundColor) {
      void StatusBar.setBackgroundColor({ color: backgroundColor }).catch(
        () => {},
      )
    }
  } catch {
    //plugin unavailable / unsupported call — leave the OS bar as-is
  }
}

/**
 * Enable edge-to-edge on native: content draws under the status bar, and safe-area
 * insets pad it back (the `app:` / `p-safe` utilities already apply on native). Call
 * once at startup. No-op on web.
 */
export function enableEdgeToEdge(): void {
  if (!isNativePlatform()) return
  try {
    void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {})
  } catch {
    //older plugin / unsupported — safe to ignore
  }
}

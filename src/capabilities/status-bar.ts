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

//The JS bridge object `SystemBars` installs on Android (`addJavascriptInterface`).
//Capacitor's own native-bridge calls `onDOMReady()` from a `DOMContentLoaded` listener;
//nothing else in the plugin's surface re-runs the probe behind it. Not on `window`'s
//public types — hence the local shape.
type SystemBarsAndroidBridge = { onDOMReady?: () => void }

function androidSystemBarsBridge(): SystemBarsAndroidBridge | null {
  if (typeof window === "undefined") return null
  const bridge = (window as unknown as Record<string, unknown>)
    .CapacitorSystemBarsAndroidInterface as
    | SystemBarsAndroidBridge
    | undefined
  return typeof bridge?.onDOMReady === "function" ? bridge : null
}

/**
 * ANDROID ONLY — re-run Capacitor `SystemBars`' `viewport-fit=cover` probe. No-op
 * everywhere else (the bridge object doesn't exist).
 *
 * SystemBars decides **once**, from a `DOMContentLoaded` listener, whether the page opted
 * into drawing under the system bars: it reads the LAST `meta[name=viewport]` and looks
 * for the literal `viewport-fit=cover`. That answer (`hasViewportCover`) then gates its
 * whole inset pipeline, and nothing re-checks it — not a rotation, not a new page commit.
 *
 * adaptv's app shell ships that meta statically, but the router's head management
 * *replaces* the tag on the client during boot. If the probe lands in the gap between the
 * removal and the re-insert it reads "no cover" and the app is stuck on the fallback path
 * for the rest of the process: the WebView's parent is padded down by the system-bar
 * insets natively, `--safe-area-inset-*` are injected as `0`, and the strip the app no
 * longer covers shows the window background — the grey status-bar band. Measured on a
 * Pixel (API 37, WebView 149): `innerHeight` 845 of 923, `--safe-area-inset-top: 0px`.
 *
 * `onDOMReady()` is the exact entry point Capacitor's own bridge calls, so re-running it
 * is idempotent — it re-reads the meta and requests a fresh inset pass. One JS→native hop.
 */
export function reprobeAndroidInsets(): void {
  const bridge = androidSystemBarsBridge()
  if (!bridge) return
  try {
    bridge.onDOMReady?.()
  } catch {
    //bridge went away mid-teardown — the next mount re-probes anyway
  }
}

//How long to keep watching the boot for a lost inset pass. Covers the whole window in
//which the client can still rewrite `<head>` or re-reconcile `<html>` — first commit,
//splash handoff, first route transition — and then stops for good.
const ANDROID_INSET_WATCH_MS = 2000

/** The property SystemBars writes; its presence IS the proof a pass landed. */
const INJECTED_INSET_VAR = "--safe-area-inset-top"

function hasInjectedAndroidInsets(): boolean {
  return (
    document.documentElement.style.getPropertyValue(INJECTED_INSET_VAR) !==
    ""
  )
}

/**
 * Re-probe on every frame that has no injected insets, until {@link
 * ANDROID_INSET_WATCH_MS} is up. Android only, boot only.
 *
 * A single re-probe is not enough, for two independent reasons, both measured on device:
 * the probe can run *before* the head settles (it reads "no cover" and the app is stuck on
 * the padded fallback), and a pass that DID land can have its properties wiped afterwards,
 * because the router reconciles `<html>` on the SPA/native client path and takes the inline
 * style with it — the same reconcile `applyPlatformStamp` already exists to undo.
 *
 * Watching the *result* instead of guessing a delay means neither ordering has to be
 * predicted, and the loop costs one style read per frame while it runs. Only when that read
 * comes back empty does it pay for a native hop.
 */
function watchAndroidInsets(): void {
  if (typeof requestAnimationFrame !== "function") return
  if (!androidSystemBarsBridge()) return
  const deadline = Date.now() + ANDROID_INSET_WATCH_MS
  const tick = () => {
    if (!hasInjectedAndroidInsets()) reprobeAndroidInsets()
    if (Date.now() < deadline) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

/**
 * Enable edge-to-edge on native: content draws under the system bars, and the shell's
 * safe-area utilities pad it back. No-op on web.
 *
 * Two mechanisms, one per platform generation:
 *
 *  - `setOverlaysWebView(true)` — iOS (all versions) and Android ≤ 14, where the window
 *    still has to be told to lay out behind the bars. On Android 15+ it resolves and does
 *    nothing (NATIVE-SHELL §0.0 point 4); harmless, and the only thing keeping the pre-15
 *    devices edge-to-edge until @adaptv/shell (roadmap #4) replaces the plugin.
 *  - {@link reprobeAndroidInsets} + {@link watchAndroidInsets} — Android of every version,
 *    where SystemBars owns edge-to-edge and its one-shot viewport probe can lose a race
 *    with the app's own boot. Probe now, then watch the result until it holds.
 */
export function enableEdgeToEdge(): void {
  if (!isNativePlatform()) return
  try {
    void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {})
  } catch {
    //older plugin / unsupported — safe to ignore
  }
  reprobeAndroidInsets()
  watchAndroidInsets()
}

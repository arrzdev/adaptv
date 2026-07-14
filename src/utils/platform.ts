//Single source of truth for "what am I running in". Everything that used to key
//off `display-mode: standalone` should key off these instead, so a Capacitor
//WebView (which reports `display-mode: browser`) is treated as an installed app,
//not a browser tab.
//
//Native detection reads the Capacitor-injected `window.Capacitor` GLOBAL — it does
//NOT import `@capacitor/core`, so a pure web build needs nothing installed.

/** Runtime environment. `web` = browser tab, `standalone` = installed PWA, `native` = Capacitor. */
export type PlatformTag = "web" | "standalone" | "native"

/** Device OS. `web` = desktop / unknown (not a mobile OS we special-case). */
export type PlatformOS = "ios" | "android" | "web"

type CapacitorGlobal = {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
}

function capacitor(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined
  return (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor
}

/** Whether the current device is iOS/iPadOS (including iPadOS reporting as MacIntel). */
export function isIOS() {
  if (typeof navigator === "undefined") return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  )
}

/** True inside a Capacitor native shell (iOS/Android app). False on web/PWA. */
export function isNativePlatform(): boolean {
  return capacitor()?.isNativePlatform?.() === true
}

/**
 * Installed PWA (home-screen / standalone display) vs an in-browser tab. The media
 * query covers modern iOS/Android; `navigator.standalone` covers legacy iOS Safari.
 * A Capacitor WebView reports `browser` here, so use {@link isInstalledApp} when you
 * mean "installed app" in general.
 */
export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false
  const mql =
    window.matchMedia?.("(display-mode: standalone)").matches ?? false
  const iosLegacy =
    (window.navigator as { standalone?: boolean }).standalone === true
  return mql || iosLegacy
}

/** Device OS — from Capacitor when native, else a UA sniff. */
export function getOS(): PlatformOS {
  const platform = capacitor()?.getPlatform?.()
  if (platform === "ios" || platform === "android") return platform
  if (isIOS()) return "ios"
  if (
    typeof navigator !== "undefined" &&
    /Android/i.test(navigator.userAgent)
  ) {
    return "android"
  }
  return "web"
}

/**
 * The single "is this the installed app?" predicate — native Capacitor OR an
 * installed/standalone PWA. This is what widens the `app:` styling, memory
 * history, and edge-swipe gating so a native WebView isn't treated as a browser tab.
 */
export function isInstalledApp(): boolean {
  return isNativePlatform() || isStandaloneDisplay()
}

/** Coarse runtime tag used for the pre-paint `<html data-nativ-platform>` stamp. */
export function resolvePlatformTag(): PlatformTag {
  if (isNativePlatform()) return "native"
  if (isStandaloneDisplay()) return "standalone"
  return "web"
}

/**
 * Blocking inline `<head>` script — runs before first paint. Stamps
 * `document.documentElement`:
 *   • `data-nativ-platform` → `native` / `standalone` / `web` (drives the `app:` /
 *     `web:` Tailwind variants + attribute-scoped critical CSS, incl. the splash
 *     policy — the custom splash shows when installed, a browser tab opts in)
 *   • `data-nativ-os` → `ios` / `android` / `web` (OS-specific styling)
 * Both resolve from the very first frame, before the app stylesheet loads. Mirrors
 * {@link resolvePlatformTag} / {@link getOS} in plain JS (can't import this module).
 */
export function getPlatformInitScript(): string {
  return `(function(){try{var C=window.Capacitor;var n=!!(C&&C.isNativePlatform&&C.isNativePlatform());var s=(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||window.navigator.standalone===true;var ua=navigator.userAgent||'';var os=(n&&C.getPlatform)?C.getPlatform():((/iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1))?'ios':(/Android/i.test(ua)?'android':'web'));var r=document.documentElement;r.dataset.nativPlatform=n?'native':(s?'standalone':'web');r.dataset.nativOs=os;}catch(e){}})();`
}

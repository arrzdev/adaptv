//Single source of truth for "what am I running in". Everything that used to key
//off `display-mode: standalone` should key off these instead, so a Capacitor
//WebView (which reports `display-mode: browser`) is treated as an installed app,
//not a browser tab.
//
//Native detection reads the Capacitor-injected `window.Capacitor` GLOBAL — it does
//NOT import `@capacitor/core`, so a pure web build needs nothing installed.
//
//══ TWO AXES. Pick one from each — they are independent ══════════════════════
//
//  shell — what is hosting the page?      web  │ standalone │ native
//      total answer  resolvePlatformTag()
//      predicates    isStandaloneDisplay()  isNativePlatform()
//      the union     isInstalledApp()  =  standalone + native  ( = the `app:`
//                    CSS variant, and the `"app"` ui scope. One concept, and
//                    these are its three spellings.)
//
//  device OS — what is it running on?     ios  │ android    │ web
//      total answer  getOS()
//      predicates    isIOS()                        + getOSVersion() /
//                                                     isOSVersionAtLeast()
//
//Reading `isIOS()` and `isNativePlatform()` as if they were alternatives is the
//mistake this block exists to prevent: iOS Safari is `ios` + `web`, and an iOS
//Capacitor build is `ios` + `native`. Same OS, different shell, different rules.
//
//**There is deliberately NO cross-product** — no `isAndroidNative()`,
//`isIOSStandalone()`, `isBrowserTab()`. 3 shells × 3 OSes is 9 predicates, and
//the whole codebase writes a shell×OS condition in exactly ONE load-bearing place
//(`use-android-back-button.ts`, where the hardware back key only exists on
//android+native). One call site does not earn a name — and every extra predicate
//is one more way to reach for the almost-right one, which is precisely how a gate
//ends up silently off on the target it was written for. Write the `&&`.
//
//The browser-tab branch has no predicate for the same reason: in JS it is asked
//once, while in CSS the `web:` variant carries it ~45 times. That branch is a
//styling concern, and the styling path costs zero re-renders (see utils.css).

import type {
  AdaptvUiConfig,
  UiPatchScope,
} from "#adaptv/config/app-config"

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
 * OS version as a dotted string (`"18.4"`, `"14"`), or `null` when the UA
 * doesn't carry one (desktop, or an OS we don't parse).
 *
 * Read from the user-agent string rather than `@capacitor/device`, for two
 * reasons: it is **synchronous** (the Capacitor bridge is not, and a version
 * check that forces a loading state is useless for gating a render), and the
 * WebView's UA carries the same number the plugin would return. Use
 * `getDeviceInfo()` when you want the plugin's full, authoritative record.
 */
export function getOSVersion(): string | null {
  if (typeof navigator === "undefined") return null
  const ua = navigator.userAgent
  //iOS says "CPU iPhone OS 18_4 like Mac OS X", iPadOS says "CPU OS 18_4".
  //Requiring digits immediately after "OS " is deliberate: it excludes desktop
  //Safari/Chrome's "Mac OS X 10_15_7", which every browser has frozen at that
  //value for years and which therefore says nothing about the real OS.
  const apple = ua.match(/(?:iPhone )?OS (\d+)[._](\d+)(?:[._](\d+))?/)
  if (apple) {
    return [apple[1], apple[2], apple[3]].filter(Boolean).join(".")
  }
  const android = ua.match(/Android (\d+(?:\.\d+)*)/)
  if (android) return android[1]
  return null
}

/**
 * Whether {@link getOSVersion} is at or above `major.minor`. `false` when the
 * version is unknown — callers use this to gate a known-broken-below-X
 * workaround, and an unknown OS must get the workaround, not skip it.
 */
export function isOSVersionAtLeast(major: number, minor = 0): boolean {
  const version = getOSVersion()
  if (!version) return false
  const [gotMajor = 0, gotMinor = 0] = version.split(".").map(Number)
  if (gotMajor !== major) return gotMajor > major
  return gotMinor >= minor
}

/**
 * The single "is this the installed app?" predicate — native Capacitor OR an
 * installed/standalone PWA. This is what widens the `app:` styling, memory
 * history, and edge-swipe gating so a native WebView isn't treated as a browser tab.
 */
export function isInstalledApp(): boolean {
  return isNativePlatform() || isStandaloneDisplay()
}

/** Coarse runtime tag used for the pre-paint `<html data-adaptv-platform>` stamp. */
export function resolvePlatformTag(): PlatformTag {
  if (isNativePlatform()) return "native"
  if (isStandaloneDisplay()) return "standalone"
  return "web"
}

/* ============================================================================
 * ui stamps — `config × platform` resolved ONCE, into a boolean attribute
 * ========================================================================== */

/**
 * The `<html>` attribute each `ui` option stamps when it resolves to "on", paired
 * with the config key that decides it.
 *
 * Boolean-presence attributes, deliberately: the CSS in `styles/patches.css` then
 * stays one static rule per patch (`html[data-adaptv-no-select] * { … }`) instead
 * of adaptv emitting a different stylesheet per config — which would make
 * `styles.css` non-static and turn every reset into a build matrix.
 */
export const UI_STAMPS = [
  ["noSelect", "data-adaptv-no-select"],
  ["hideScrollbars", "data-adaptv-hide-scrollbars"],
  ["touchCallout", "data-adaptv-no-touch-callout"],
] as const satisfies ReadonlyArray<readonly [keyof AdaptvUiConfig, string]>

/**
 * The default scope per option. Not one shared constant, because the options do not
 * share a right answer: selection and the iOS link callout are genuine browser
 * affordances a tab should keep, while a scrollbar is desktop chrome that has a
 * per-scroller escape (`ScrollView showsVerticalScrollIndicator` →
 * `scrollbar-visible`, which outranks the reset). An option with a working escape
 * can afford the stricter default; one without cannot.
 */
const UI_SCOPE_DEFAULTS = {
  noSelect: "app",
  hideScrollbars: "all",
  touchCallout: "app",
} as const satisfies Record<keyof AdaptvUiConfig, UiPatchScope>

/**
 * Coerce an untrusted config value to a scope. Anything unrecognized —
 * `undefined`, a typo, a non-string — becomes that option's documented default
 * rather than throwing: this runs inside the pre-paint script's generator, and a
 * malformed config must not be able to leave the page unstamped.
 */
export function normalizeUiScope(
  value: unknown,
  key: keyof AdaptvUiConfig = "noSelect",
): UiPatchScope {
  return value === "all" || value === "off" || value === "app"
    ? value
    : UI_SCOPE_DEFAULTS[key]
}

/** Whether a scope is "on" for a given runtime platform. `app` = standalone + native. */
export function resolveUiStamp(
  scope: UiPatchScope,
  platform: PlatformTag,
): boolean {
  if (scope === "all") return true
  if (scope === "off") return false
  return platform !== "web"
}

/**
 * Re-apply the `data-adaptv-platform` / `data-adaptv-os` stamp on `<html>`.
 *
 * The pre-paint init script ({@link getPlatformInitScript}) sets these before the
 * first frame, but React does not render them (they can't be server-rendered — the
 * server has no `window` — without a hydration mismatch). On the SPA/native client
 * path React reconciles `<html>` and **drops** the script-applied attributes, which
 * silently disables every `app:` / `web:` variant and the attribute-scoped critical
 * CSS — most visibly `env()` safe-area padding, leaving content under the status bar.
 * Call this from a layout effect at the root so the stamp is restored before paint.
 *
 * `ui` is the app's {@link AdaptvUiConfig}; the same resolution the init script did
 * pre-paint is re-run here, for the same reason and against the same defaults. Pass
 * the config — calling this bare re-resolves against the `"app"` defaults, which
 * would silently drop a stamp an `"all"` config asked for.
 */
export function applyPlatformStamp(ui?: AdaptvUiConfig): void {
  if (typeof document === "undefined") return
  const root = document.documentElement
  const platform = resolvePlatformTag()
  root.dataset.adaptvPlatform = platform
  root.dataset.adaptvOs = getOS()
  for (const [key, attr] of UI_STAMPS) {
    const on = resolveUiStamp(normalizeUiScope(ui?.[key], key), platform)
    if (on) root.setAttribute(attr, "")
    else root.removeAttribute(attr)
  }
}

/**
 * Blocking inline `<head>` script — runs before first paint. Stamps
 * `document.documentElement`:
 *   • `data-adaptv-platform` → `native` / `standalone` / `web` (drives the `app:` /
 *     `web:` Tailwind variants + attribute-scoped critical CSS, incl. the splash
 *     policy — the custom splash shows when installed, a browser tab opts in)
 *   • `data-adaptv-os` → `ios` / `android` / `web` (OS-specific styling)
 *   • one boolean attribute per {@link UI_STAMPS} entry — `config × platform` for the
 *     questionable app-feel resets, resolved HERE so the stylesheet stays static
 * All resolve from the very first frame, before the app stylesheet loads. Mirrors
 * {@link resolvePlatformTag} / {@link getOS} in plain JS (can't import this module).
 *
 * Defensive by construction: the whole body is one `try`, the scopes are normalized
 * to a known literal **before** they reach the string (so a malformed `ui` config
 * cannot produce a script that throws), and the ui loop runs LAST — if it ever did
 * fail, the platform/OS stamps it follows are already applied.
 */
export function getPlatformInitScript(ui?: AdaptvUiConfig): string {
  //[attribute, scope] pairs — scope is always one of the three literals
  const stamps = UI_STAMPS.map(
    ([key, attr]) => [attr, normalizeUiScope(ui?.[key], key)] as const,
  )
  return `(function(){try{var C=window.Capacitor;var n=!!(C&&C.isNativePlatform&&C.isNativePlatform());var s=(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||window.navigator.standalone===true;var ua=navigator.userAgent||'';var os=(n&&C.getPlatform)?C.getPlatform():((/iPad|iPhone|iPod/.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1))?'ios':(/Android/i.test(ua)?'android':'web'));var r=document.documentElement;r.dataset.adaptvPlatform=n?'native':(s?'standalone':'web');r.dataset.adaptvOs=os;var u=${JSON.stringify(stamps)};for(var i=0;i<u.length;i++){if(u[i][1]==='all'||(u[i][1]!=='off'&&(n||s)))r.setAttribute(u[i][0],'');else r.removeAttribute(u[i][0]);}}catch(e){}})();`
}

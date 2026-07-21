//App state accessor — foreground / background, one signal across platforms:
//  • native  → @capacitor/app `resume` / `pause`
//  • web/PWA → `visibilitychange` + `pageshow` (bfcache restore)
//
//Exposed as a subscribe/get pair, not only a hook, because the most important
//consumers are NOT components: the OTA updater checks for a new bundle on resume,
//and auth refreshes the token before the first request goes out.
//
//## Why this exists at all
//
//React effects and route lifecycle only run while the app is foregrounded. The
//most common mobile lifecycle event — background, then resume — fires NONE of
//them. Concretely: **a native WebView resume is not a browser focus event**, so
//TanStack Query's `refetchOnWindowFocus` silently never fires on native. This
//accessor is the fix. → `COORDINATION.md §1`
import { App } from "@capacitor/app"
import type { PluginListenerHandle } from "@capacitor/core"
import { isNativePlatform } from "#nativ/utils/platform"

export type AppState = "active" | "background"

const listeners = new Set<(state: AppState) => void>()
let nativeState: AppState = "active"
let lastNotified: AppState = "active"
let bound = false
let nativeHandles: PluginListenerHandle[] = []

/** Current foreground state. Assumes `active` during SSR — never render a paused app. */
export function getAppState(): AppState {
  if (isNativePlatform()) return nativeState
  if (typeof document === "undefined") return "active"
  return document.visibilityState === "hidden" ? "background" : "active"
}

function emit(force = false): void {
  const state = getAppState()
  //edge-triggered, not level-triggered: a token refresh on resume must not fire
  //again on every subsequent notification while already foregrounded
  if (state === lastNotified && !force) return
  lastNotified = state
  for (const listener of listeners) listener(state)
}

function bindWeb(): void {
  document.addEventListener("visibilitychange", () => emit())

  //A bfcache restore is unambiguously a resume — and it needs `force`.
  //
  //While a page sits in the back-forward cache it is FROZEN: no timers, no
  //events. So the pause that put it there may never have been observed, leaving
  //`lastNotified` stale at "active" — and an edge-triggered emit would then drop
  //the resume entirely. That is the single most common "the app is back" event on
  //mobile Safari, so dropping it is not acceptable.
  //
  //`persisted` distinguishes a real bfcache restore from an ordinary first load,
  //which must NOT be reported as a resume.
  window.addEventListener("pageshow", (event) => {
    emit((event as PageTransitionEvent).persisted === true)
  })
}

function bindNative(): void {
  void App.addListener("resume", () => {
    nativeState = "active"
    emit()
  }).then((handle) => nativeHandles.push(handle))

  void App.addListener("pause", () => {
    nativeState = "background"
    emit()
  }).then((handle) => nativeHandles.push(handle))
}

function bind(): void {
  if (bound || typeof window === "undefined") return
  bound = true
  lastNotified = getAppState()
  if (isNativePlatform()) bindNative()
  else bindWeb()
}

/**
 * Subscribe to foreground/background changes; returns an unsubscribe.
 * SSR-safe (no-op on the server). Edge-triggered — see {@link emit}.
 */
export function subscribeAppState(
  listener: (state: AppState) => void,
): () => void {
  if (typeof window === "undefined") return () => {}
  bind()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && nativeHandles.length > 0) {
      for (const handle of nativeHandles) void handle.remove()
      nativeHandles = []
      bound = false
    }
  }
}

/** Run `callback` when the app returns to the foreground. Returns an unsubscribe. */
export function onResume(callback: () => void): () => void {
  return subscribeAppState((state) => {
    if (state === "active") callback()
  })
}

/** Run `callback` when the app leaves the foreground. Returns an unsubscribe. */
export function onPause(callback: () => void): () => void {
  return subscribeAppState((state) => {
    if (state === "background") callback()
  })
}

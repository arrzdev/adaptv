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
//accessor is the fix. → `docs/design/coordination.md §1`
import { App } from "@capacitor/app"
import type { PluginListenerHandle } from "@capacitor/core"
import { isNativePlatform } from "#adaptv/utils/platform"

export type AppState = "active" | "background"

const listeners = new Set<(state: AppState) => void>()
let nativeState: AppState = "active"
let lastNotified: AppState = "active"
let bound = false

/**
 * Whether the resume for the page's latest trip into the back-forward cache has
 * already gone out: `false` from its `pagehide`, `true` once a resume is delivered,
 * `null` while no trip is open. Read by the `pageshow` that ends the trip — see
 * {@link bindWeb}.
 */
let restoreResumed: boolean | null = null

/**
 * The live native binding, or `null` when none is held. `disposed` is per binding
 * because the bridge answers asynchronously: the last subscriber can leave before
 * either `addListener` resolves (StrictMode's dev double-mount always does), and a
 * handle that arrives afterwards must remove itself rather than keep a listener
 * nobody will ever release.
 */
type NativeBinding = { disposed: boolean; handles: PluginListenerHandle[] }
let nativeBinding: NativeBinding | null = null

//A bridge call that rejects (plugin missing from this binary, an OS error) is
//fire-and-forget here, so nothing would handle it: it would reach the window's
//`unhandledrejection` event, and with it the console and any error reporter the
//app installed — at boot, because the OTA updater subscribes there. Without the
//listeners the app simply reads as `active`, which is the degraded answer.
const ignoreBridgeRejection = () => {}

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
  if (state === "active" && restoreResumed === false) restoreResumed = true
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
  //
  //But force only a resume nobody delivered yet. Chromium restores with
  //`visibilitychange → visible` BEFORE `pageshow`, and that edge is already the
  //resume — forcing again made one return two resumes, measured in
  //`playground/e2e/app-state.spec.ts`. The trip is opened by the `pagehide` that
  //sends the page into the cache, which a browser dispatches before freezing it
  //(it is the one departure event that cannot be missed), and `emit` closes it on
  //the first resume it delivers. A `pageshow` with no trip open is still forced.
  window.addEventListener("pagehide", (event) => {
    if ((event as PageTransitionEvent).persisted) restoreResumed = false
  })
  window.addEventListener("pageshow", (event) => {
    const restore = (event as PageTransitionEvent).persisted === true
    const force = restore && restoreResumed !== true
    if (restore) restoreResumed = null
    emit(force)
  })
}

function bindNative(): void {
  const binding: NativeBinding = { disposed: false, handles: [] }
  nativeBinding = binding
  const keep = (handle: PluginListenerHandle) => {
    if (binding.disposed) void handle.remove().catch(ignoreBridgeRejection)
    else binding.handles.push(handle)
  }

  void App.addListener("resume", () => {
    nativeState = "active"
    emit()
  }).then(keep, ignoreBridgeRejection)

  void App.addListener("pause", () => {
    nativeState = "background"
    emit()
  }).then(keep, ignoreBridgeRejection)
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
    if (listeners.size === 0 && nativeBinding) {
      nativeBinding.disposed = true
      for (const handle of nativeBinding.handles) {
        void handle.remove().catch(ignoreBridgeRejection)
      }
      nativeBinding = null
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

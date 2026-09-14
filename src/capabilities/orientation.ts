//Screen-orientation accessor — read, subscribe, lock, unlock:
//  • native   → @capacitor/screen-orientation
//  • web/PWA  → screen.orientation (+ .lock(), where it exists)
//
//## Reading always works. Locking usually does not, and that is the point.
//
//`screen.orientation.type` is everywhere. `screen.orientation.lock()` is not:
//WebKit has never shipped it, so **every iOS browser and every iOS installed
//PWA returns `"unsupported"` from {@link lockScreenOrientation}** — and on
//Chromium the same call rejects with SecurityError unless the document is
//fullscreen or installed. Both are ordinary, expected answers here, which is
//why the lock functions resolve to an {@link OrientationLockOutcome} instead of
//rejecting: the app has to render something either way.
//
//That gap is why `OrientationGuard` (src/components/orientation-guard.tsx)
//exists at all — where the orientation cannot be *held*, the only honest option
//is to detect the mismatch and ask the user to rotate. The two are meant to be
//used together: lock first, and fall back to the guard when this accessor says
//the lock is unavailable. `useManifestOrientation` remains the separate,
//declarative path (the manifest's `orientation` field, which Android enforces
//natively at launch); this accessor is the imperative one, for a single screen
//that needs a different orientation from the rest of the app.
import { ScreenOrientation } from "@capacitor/screen-orientation"
import { hasNativePlugin } from "#adaptv/utils/native-plugins"
import { isNativePlatform } from "#adaptv/utils/platform"

/** The four concrete orientations, matching the DOM's `OrientationType`. */
export type ScreenOrientationType =
  | "portrait-primary"
  | "portrait-secondary"
  | "landscape-primary"
  | "landscape-secondary"

/** What can be asked for. `"natural"` = the device's own default. */
export type ScreenOrientationLock =
  | "any"
  | "natural"
  | "portrait"
  | "portrait-primary"
  | "portrait-secondary"
  | "landscape"
  | "landscape-primary"
  | "landscape-secondary"

/**
 * `"ok"` — the platform accepted it.
 * `"unsupported"` — there is no lock API here (iOS on the WEB: WebKit has never
 * shipped `screen.orientation.lock()`; a native iOS build locks through the
 * ScreenOrientation plugin). Asking again cannot help, and the app should fall
 * back to `OrientationGuard`.
 * `"rejected"` — the API exists but refused this call (Chromium outside
 * fullscreen / not installed); a retry from the right context can succeed.
 */
export type OrientationLockOutcome = "ok" | "unsupported" | "rejected"

const DEFAULT_ORIENTATION: ScreenOrientationType = "portrait-primary"

//TypeScript's DOM library still models `ScreenOrientation` without `lock`/
//`unlock` — they were dropped from the lib when the spec moved them behind a
//"not on every platform" note, which is exactly the situation this file exists
//to handle. Reach for them through a local shape rather than a bare `any`.
type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: ScreenOrientationLock) => Promise<void>
  unlock?: () => void
}

function webOrientation(): LockableScreenOrientation | undefined {
  if (typeof window === "undefined") return undefined
  return window.screen?.orientation as
    | LockableScreenOrientation
    | undefined
}

const listeners = new Set<() => void>()
let nativeOrientation: ScreenOrientationType = DEFAULT_ORIENTATION
let webBound = false

/**
 * The live native binding, or `null` when none is held. `disposed` is per binding
 * because the bridge answers asynchronously: the last subscriber can leave before
 * `addListener` resolves (useSyncExternalStore under StrictMode always does in
 * dev), and the handle that arrives afterwards must remove itself rather than
 * keep a listener nobody will ever release.
 */
type NativeBinding = {
  disposed: boolean
  handle: { remove: () => Promise<void> } | null
}
let nativeBinding: NativeBinding | null = null

//A bridge call that rejects (plugin missing from this binary, an OS error) is
//fire-and-forget in the subscription, so nothing would handle it: it would reach
//the window's `unhandledrejection` event, and with it the console and any error
//reporter the app installed. The last known orientation is the degraded answer.
//Passed as `.then`'s second argument, not `.catch`, so an exception thrown by a
//subscriber still surfaces.
const ignoreBridgeRejection = () => {}

function emit(): void {
  for (const cb of listeners) cb()
}

function normalize(type: string | undefined): ScreenOrientationType {
  if (
    type === "portrait-primary" ||
    type === "portrait-secondary" ||
    type === "landscape-primary" ||
    type === "landscape-secondary"
  ) {
    return type
  }
  return DEFAULT_ORIENTATION
}

/**
 * Current orientation. Synchronous so it can seed a `useSyncExternalStore`
 * snapshot; the native value is the last one the plugin pushed (seeded on the
 * first subscribe), because the plugin's own read is async.
 */
export function getScreenOrientation(): ScreenOrientationType {
  if (viaPlugin()) return nativeOrientation
  if (typeof window === "undefined") return DEFAULT_ORIENTATION
  const type = webOrientation()?.type
  if (type) return normalize(type)
  //pre-16.4 WebKit has no screen.orientation at all; the media query is coarse
  //(no primary/secondary) but it is never wrong about the axis
  const portrait =
    window.matchMedia?.("(orientation: portrait)").matches ?? true
  return portrait ? "portrait-primary" : "landscape-primary"
}

function bindWeb(): void {
  if (webBound || typeof window === "undefined") return
  webBound = true
  webOrientation()?.addEventListener?.("change", emit)
  //`orientationchange` is the only signal on pre-16.4 WebKit. Both are bound
  //unconditionally: a browser that fires both just emits twice, and every
  //consumer of this is a snapshot read, so a duplicate notification is free.
  window.addEventListener("orientationchange", emit)
}

function bindNative(): void {
  if (nativeBinding) return
  const binding: NativeBinding = { disposed: false, handle: null }
  nativeBinding = binding
  void ScreenOrientation.orientation().then((result) => {
    if (binding.disposed) return
    nativeOrientation = normalize(result.type)
    emit()
  }, ignoreBridgeRejection)
  void ScreenOrientation.addListener(
    "screenOrientationChange",
    (result) => {
      nativeOrientation = normalize(result.type)
      emit()
    },
  ).then((handle) => {
    if (binding.disposed) void handle.remove().catch(ignoreBridgeRejection)
    else binding.handle = handle
  }, ignoreBridgeRejection)
}

function unbindNative(): void {
  if (!nativeBinding) return
  nativeBinding.disposed = true
  void nativeBinding.handle?.remove().catch(ignoreBridgeRejection)
  nativeBinding = null
}

/**
 * Subscribe to orientation changes; returns an unsubscribe. SSR-safe (no-op on
 * the server). Web listeners are process singletons and cheap to keep; the
 * native handle is released once the last subscriber leaves.
 */
export function subscribeScreenOrientation(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  listeners.add(cb)
  if (viaPlugin()) bindNative()
  else bindWeb()
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0) unbindNative()
  }
}

/**
 * Whether the call goes through the native plugin. Every native branch asks
 * THIS rather than `isNativePlatform()`: an OTA bundle can be running on a
 * binary that predates the plugin. → `docs/design/ota.md §5.6`
 *
 * The read and the subscription ask it too, not only the lock. On such a binary
 * the plugin's read and listener reject into {@link ignoreBridgeRejection}, so a
 * native branch would answer the default orientation forever and never notify,
 * while the WebView's own `screen.orientation` and `orientationchange` work. The
 * lock falls through the same way: `screen.orientation.lock` is a real fallback
 * inside an Android WebView.
 */
function viaPlugin(): boolean {
  return isNativePlatform() && hasNativePlugin("ScreenOrientation")
}

/**
 * Whether a lock can be attempted at all. Synchronous, so a "rotate to
 * landscape" button can be absent from the first render on iOS web rather than
 * appearing and then failing.
 *
 * `true` here still does not promise the lock will take — Chromium refuses
 * outside fullscreen/standalone. That is what {@link lockScreenOrientation}'s
 * `"rejected"` outcome is for.
 */
export function isOrientationLockSupported(): boolean {
  if (viaPlugin()) return true
  if (typeof window === "undefined") return false
  return typeof webOrientation()?.lock === "function"
}

/**
 * Hold the screen in `lock`. Never rejects — see {@link OrientationLockOutcome}
 * for how to tell "cannot" from "would not".
 *
 * ⚠︎ One case this cannot report: on Android 16+ with `targetSdk` 36, the OS
 * ignores orientation locks on large screens. The plugin resolves successfully
 * and the tablet keeps rotating. There is no query for it, so an app that
 * genuinely depends on the lock holding must still verify with
 * {@link subscribeScreenOrientation} rather than trusting `"ok"`.
 */
export async function lockScreenOrientation(
  lock: ScreenOrientationLock,
): Promise<OrientationLockOutcome> {
  if (!isOrientationLockSupported()) return "unsupported"
  if (viaPlugin()) {
    try {
      await ScreenOrientation.lock({ orientation: lock })
      return "ok"
    } catch {
      //plugin missing from this shell, or the OS refused the value
      return "rejected"
    }
  }
  try {
    await webOrientation()?.lock?.(lock)
    return "ok"
  } catch {
    //SecurityError outside fullscreen/standalone, NotSupportedError for a value
    //this browser doesn't implement — both mean "try again from somewhere else"
    return "rejected"
  }
}

/** Release a lock taken by {@link lockScreenOrientation}. Never rejects. */
export async function unlockScreenOrientation(): Promise<OrientationLockOutcome> {
  if (!isOrientationLockSupported()) return "unsupported"
  if (viaPlugin()) {
    try {
      await ScreenOrientation.unlock()
      return "ok"
    } catch {
      return "rejected"
    }
  }
  try {
    webOrientation()?.unlock?.()
    return "ok"
  } catch {
    return "rejected"
  }
}

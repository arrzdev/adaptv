import { useEffect, useRef, useSyncExternalStore } from "react"
import type { AppState } from "#adaptv/capabilities/app-state"
import {
  getAppState,
  subscribeAppState,
} from "#adaptv/capabilities/app-state"

/**
 * Reactive foreground state — `"active"` or `"background"`.
 *
 * Backed by the accessor pair, so it is accurate on every target:
 * `@capacitor/app` `resume`/`pause` on native, `visibilitychange` + `pageshow` on
 * web. Optimistically `"active"` during SSR. → `COORDINATION.md §1`
 */
export function useAppState(): AppState {
  return useSyncExternalStore(
    subscribeAppState,
    getAppState,
    () => "active" as const,
  )
}

/**
 * Run a callback when the app returns to the foreground.
 *
 * This is the hook that fixes the most-missed mobile lifecycle event: **a native
 * WebView resume is not a browser focus event**, so `refetchOnWindowFocus` and
 * anything else keyed on `focus`/`visibilitychange` silently never fires on
 * native. Token refresh, biometric re-lock, socket reconnect and the OTA update
 * check all hang off this.
 *
 * The callback is held in a ref, so an inline arrow does not re-subscribe on
 * every render.
 */
export function useOnResume(callback: () => void): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(
    () =>
      subscribeAppState((state) => {
        if (state === "active") callbackRef.current()
      }),
    [],
  )
}

/** Run a callback when the app leaves the foreground. See {@link useOnResume}. */
export function useOnPause(callback: () => void): void {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(
    () =>
      subscribeAppState((state) => {
        if (state === "background") callbackRef.current()
      }),
    [],
  )
}

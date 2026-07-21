/**
 * Recovery for the stale-chunk failure. → `DECISIONS.md` B3/B4, `RENDERING.md §3.3`
 *
 * ## The failure this exists for
 *
 * A tab is open. A new build deploys. The user navigates to a route they haven't
 * visited, so the router lazily `import()`s its chunk — but that chunk's hashed
 * filename belongs to the *previous* build. The new service worker's precache no
 * longer lists it, and the host no longer serves it. The import rejects, and the
 * user gets a white screen with no path out.
 *
 * Vite emits a `vite:preloadError` event for exactly this. Nothing in nativ
 * listened for it, so nothing recovered.
 *
 * ## Why the guard is not optional
 *
 * The fix is to reload — the tab then picks up the new manifest and everything
 * resolves. But if the chunk is *genuinely* missing (a bad deploy, a host that
 * pruned the previous build), reloading cannot help, and an unguarded handler
 * spins the browser forever.
 *
 * So: **one reload attempt per session**, recorded in `sessionStorage` because
 * the reload itself wipes memory — an in-memory flag would reset on every attempt
 * and guard nothing. Re-armed by {@link clearPreloadErrorGuard} once the app
 * boots successfully, so a later deploy is still recoverable.
 */

export const PRELOAD_ERROR_GUARD_KEY = "nativ:preload-error-reload"

/**
 * Whether to reload in response to a `vite:preloadError`.
 *
 * Fails **closed** when storage is unavailable — Safari private mode and
 * partitioned third-party contexts both throw on access. Without storage there
 * is no way to guard, and the asymmetry is stark: failing closed costs the user
 * one manual refresh, failing open spins the browser indefinitely.
 */
export function shouldReloadAfterPreloadError(): boolean {
  try {
    if (sessionStorage.getItem(PRELOAD_ERROR_GUARD_KEY) !== null)
      return false
    sessionStorage.setItem(PRELOAD_ERROR_GUARD_KEY, String(Date.now()))
    return true
  } catch {
    return false
  }
}

/** Re-arm the guard. Call once the app has booted successfully. */
export function clearPreloadErrorGuard(): void {
  try {
    sessionStorage.removeItem(PRELOAD_ERROR_GUARD_KEY)
  } catch {
    //nothing to clear if we could never write it
  }
}

/**
 * Install the `vite:preloadError` net. Returns a teardown function.
 *
 * `onUnrecoverable` fires when a chunk is missing and a reload has already been
 * tried — the point at which nativ renders the offline/error UI rather than
 * leaving a blank page. Calling `event.preventDefault()` first is required: it
 * stops Vite's default of rethrowing, which would surface as an unhandled
 * rejection.
 */
export function installPreloadErrorRecovery(
  onUnrecoverable?: (error: unknown) => void,
): () => void {
  if (typeof window === "undefined") return () => {}

  const handler = (event: Event) => {
    event.preventDefault()
    if (shouldReloadAfterPreloadError()) {
      window.location.reload()
      return
    }
    onUnrecoverable?.((event as Event & { payload?: unknown }).payload)
  }

  window.addEventListener("vite:preloadError", handler)
  return () => window.removeEventListener("vite:preloadError", handler)
}

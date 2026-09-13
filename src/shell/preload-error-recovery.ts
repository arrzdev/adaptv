/**
 * Recovery for the stale-chunk failure. → `docs/decisions/register.md` B3/B4, `docs/design/rendering.md §3.3`
 *
 * ## The failure this exists for
 *
 * A tab is open. A new build deploys. The user navigates to a route they haven't
 * visited, so the router lazily `import()`s its chunk — but that chunk's hashed
 * filename belongs to the *previous* build. The new service worker's precache no
 * longer lists it, and the host no longer serves it. The import rejects, and the
 * user gets a white screen with no path out.
 *
 * Vite emits a `vite:preloadError` event for exactly this, and this
 * module is the only thing in adaptv that listens for it.
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
 * and guard nothing. Re-armed by {@link clearPreloadErrorGuard} once the APP
 * decides it has booted successfully, so a later deploy is still recoverable —
 * see that function for why the app, and never adaptv, owns that call.
 */

export const PRELOAD_ERROR_GUARD_KEY = "adaptv:preload-error-reload"

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

/**
 * Re-arm the guard, so a *later* deploy in the same tab session is still
 * recoverable. Exported from `@arrzdev/adaptv/shell`.
 *
 * ## adaptv deliberately never calls this itself, and that is not an omission
 *
 * There is no moment inside the framework where calling it is safe. The reload
 * lands back on the SAME url, so the router immediately re-imports the chunk that
 * just failed — and if the chunk is *genuinely* missing, clearing the guard on
 * mount re-arms it a beat before that second failure. That is the infinite reload
 * this whole module exists to prevent, rebuilt out of its own recovery path.
 *
 * "Booted successfully" is therefore an APP-level judgement, not a framework one:
 * it means whatever the app treats as proof it is alive and past its lazy routes
 * — first successful data load, first navigation the user drove. Only the app can
 * name that moment, so only the app calls this.
 */
export function clearPreloadErrorGuard(): void {
  try {
    sessionStorage.removeItem(PRELOAD_ERROR_GUARD_KEY)
  } catch {
    //nothing to clear if we could never write it
  }
}

/**
 * Set once THIS document has asked for a reload, and never cleared: the reload
 * replaces the document, and this module with it.
 *
 * The guard alone cannot answer "is a reload already on its way". It is spent the
 * instant the first error reloads, so every later error in the same document
 * reads exactly like the case the guard exists for — a reload that already
 * happened and did not help — and would render the offline screen over a recovery
 * that is still in flight. Later errors are routine, not exotic: Vite dispatches
 * one event per failed dependency of an import and one more for the module itself.
 *
 * Module scope rather than per installation, so the answer is the document's
 * whatever installed the listener. adaptv's shell is the one net; an app that also
 * calls {@link installPreloadErrorRecovery} gets the same answer instead of a
 * second, contradictory one.
 */
let reloadRequested = false

/**
 * Install the `vite:preloadError` net. Returns a teardown function.
 *
 * adaptv's shell installs it once, with the offline screen as `onUnrecoverable`.
 * That callback fires only when the chunk is missing in a document that a reload
 * already produced — the guard was spent before this document existed, so
 * reloading again cannot help, and the offline UI beats a blank page.
 *
 * ## Why the reloading document leaves the error alone
 *
 * `event.preventDefault()` does not make a failed import go away: it stops Vite
 * rethrowing, and the import then RESOLVES — to `undefined`. The router reads a
 * component off that, throws, and the app's error boundary is drawn over the
 * reload while it is in flight (measured in Chromium: "Something went wrong" for
 * the reload's whole round trip). Left alone, the import rejects with the
 * engine's own missing-module error, which the router holds as a reload in
 * progress and draws nothing for. So the net prevents the default only where it
 * takes the failure over itself — the unrecoverable case, which renders the
 * offline screen — and every error in a document that is already reloading,
 * first or later, is left exactly as the engine raised it.
 *
 * What that cannot reach, measured in `e2e-sw/stale-chunk.spec.ts`: the router
 * recognises the missing-module wordings, not every failure. WebKit behind a host
 * that rewrites a missing chunk to the index rejects with a MIME-type error
 * instead, and the error boundary is drawn over the reload there. Nothing an
 * event listener does can hold the import pending, so that one is the router's.
 */
export function installPreloadErrorRecovery(
  onUnrecoverable?: (error: unknown) => void,
): () => void {
  if (typeof window === "undefined") return () => {}

  const handler = (event: Event) => {
    if (reloadRequested) return
    if (shouldReloadAfterPreloadError()) {
      reloadRequested = true
      window.location.reload()
      return
    }
    event.preventDefault()
    onUnrecoverable?.((event as Event & { payload?: unknown }).payload)
  }

  window.addEventListener("vite:preloadError", handler)
  return () => window.removeEventListener("vite:preloadError", handler)
}

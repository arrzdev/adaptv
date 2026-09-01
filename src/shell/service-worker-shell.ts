import { DEV_SW_ENABLED, registerSW } from "virtual:adaptv/pwa-register"
import { installPreloadErrorRecovery } from "#adaptv/shell/preload-error-recovery"
import { unregisterForeignServiceWorkers } from "#adaptv/shell/unregister-foreign-service-workers"
import { isNativePlatform } from "#adaptv/utils/platform"

/* ============================================================================
 * The `serviceWorkerUpdate: "prompt"` signal
 *
 * Only ever written under that policy — under `"auto"` a waiting worker is
 * applied at launch and never surfaces, so `updateAvailable` stays false and
 * `useServiceWorkerUpdate()` costs an app nothing to call.
 *
 * A subscribe/get accessor pair rather than component state (`docs/VISION.md` §2.6, L9):
 * `useSyncExternalStore` reads it without tearing, and a non-React caller can
 * subscribe to the same signal.
 * ========================================================================== */

let updateAvailable = false
let applyWaitingUpdate: (() => void) | null = null
const updateListeners = new Set<() => void>()

/** Subscribe to "a new version is waiting". Returns an unsubscribe function. */
export function subscribeServiceWorkerUpdate(
  listener: () => void,
): () => void {
  updateListeners.add(listener)
  return () => {
    updateListeners.delete(listener)
  }
}

export function getServiceWorkerUpdateAvailable(): boolean {
  return updateAvailable
}

/**
 * Apply a waiting update now — the user-intent path.
 *
 * A no-op when nothing is waiting, so an app can wire it to a button that is
 * always mounted without guarding the call.
 */
export function applyServiceWorkerUpdate(): void {
  applyWaitingUpdate?.()
}

function offerUpdate(apply: () => void): void {
  applyWaitingUpdate = apply
  //Re-offering an already-offered update must not re-notify: subscribers would
  //re-render for a state that did not change.
  if (updateAvailable) return
  updateAvailable = true
  for (const listener of updateListeners) listener()
}

/**
 * Purge every service worker and cache. The remediation path for a broken worker,
 * and the defensive sweep on the Capacitor target.
 *
 * A SW registered during a `server.url` live-reload dev session otherwise survives
 * into the installed app, where it silently serves the old bundle — which also
 * **breaks OTA**: the app "updates", `serverBasePath` moves, and the WebView keeps
 * showing old code with no error anywhere. → `docs/design/rendering.md §3.5`
 */
export async function destroyServiceWorkers(): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      const registrations =
        await navigator.serviceWorker.getRegistrations()
      await Promise.allSettled(registrations.map((r) => r.unregister()))
    }
    if (typeof caches !== "undefined") {
      const names = await caches.keys()
      await Promise.allSettled(names.map((name) => caches.delete(name)))
    }
  } catch {
    //best-effort teardown — never block boot on it
  }
}

/**
 * Ask the browser to exempt this origin's storage from automatic eviction.
 *
 * Without it the precache is "best-effort" and the browser may drop it under disk
 * pressure or heuristics — which on a PWA means the app silently stops working
 * offline with nothing to observe. WebKit grants persistence to installed web
 * apps, Chromium decides from engagement signals; both are a no-op when already
 * granted, and both fail closed, so an unsupported browser just keeps the old
 * behaviour.
 *
 * Deliberately fire-and-forget: nothing downstream may wait on a permission
 * decision that some browsers surface to the user.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) {
      return false
    }
    if (await navigator.storage.persisted?.()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

/**
 * Register the service worker. Called once when the shell mounts.
 *
 * Takes no options, and that is the design. The worker is core product
 * behaviour — the thing that makes a web build navigate like the native one — so
 * there is no `register` mode and no enable flag. Whether a waiting worker is
 * applied silently or offered to the app is the one thing that IS configurable,
 * by `serviceWorkerUpdate`, and the registration module bakes that in — under
 * `"auto"` it applies at the only moment where a reload costs nothing.
 * → `docs/design/rendering.md §3.4`
 */
export function registerPwaServiceWorkerRuntime(): void {
  //The stale-chunk net is unconditional: it must be armed even when adaptv never
  //registers a worker, because the failure is a *deploy* artifact, not a SW one.
  installPreloadErrorRecovery()

  //Capacitor never gets a service worker — not configurable. §3.5
  if (isNativePlatform()) {
    void destroyServiceWorkers()
    return
  }

  //SW is production/preview only — Vite dev URLs are not cache-stable.
  if (import.meta.env.DEV) {
    //ADAPTV_DEV_SW=1 opts in to serving the APP's own worker modules here, so a
    //`serviceWorkers: []` module can be exercised without a production build.
    //adaptv's own worker is still absent: it is precache + navigation + static
    //delivery, none of which can exist against a dev server. → vite/sw-dev.ts
    if (DEV_SW_ENABLED) {
      registerSW(offerUpdate)
      return
    }
    //DESTROY any worker+cache in dev, not just foreign ones: a adaptv SW registered
    //in a prior prod/preview session on the same origin (or dragged in by a
    //live-reload dev server) otherwise survives into dev and silently serves the
    //OLD bundle inside the WebView, breaking hot reload. Dev is always SW-free.
    void destroyServiceWorkers()
    return
  }

  void requestPersistentStorage()
  void unregisterForeignServiceWorkers().then(() => {
    //`offerUpdate` is only ever called under `serviceWorkerUpdate: "prompt"` —
    //the registration module bakes the policy and, under `"auto"`, applies the
    //waiting worker itself without telling anyone.
    registerSW(offerUpdate)
  })
}

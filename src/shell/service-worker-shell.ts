import { registerSW } from "virtual:adaptv/pwa-register"
import type { PwaServiceWorkerRuntimeConfig } from "#adaptv/config/types"
import { installPreloadErrorRecovery } from "#adaptv/shell/preload-error-recovery"
import {
  resolveUpdateMode,
  shouldApplyUpdateNow,
} from "#adaptv/shell/sw-update-mode"
import { unregisterForeignServiceWorkers } from "#adaptv/shell/unregister-foreign-service-workers"
import { isNativePlatform } from "#adaptv/utils/platform"

/** Set when a new worker is installed and waiting. Read by `useServiceWorkerUpdate`. */
let updateAvailable = false
let applyWaitingUpdate: (() => void) | null = null
const updateListeners = new Set<() => void>()

function notifyUpdateListeners(): void {
  for (const listener of updateListeners) listener()
}

/** Subscribe to "a new version is waiting". Accessor shape, so non-React callers work too. */
export function subscribeServiceWorkerUpdate(
  listener: () => void,
): () => void {
  updateListeners.add(listener)
  return () => updateListeners.delete(listener)
}

export function getServiceWorkerUpdateAvailable(): boolean {
  return updateAvailable
}

/** Apply a waiting update now (user-intent path). No-op if nothing is waiting. */
export function applyServiceWorkerUpdate(): void {
  applyWaitingUpdate?.()
}

/**
 * Purge every service worker and cache. The remediation path for a broken worker,
 * and the defensive sweep on the Capacitor target.
 *
 * A SW registered during a `server.url` live-reload dev session otherwise survives
 * into the installed app, where it silently serves the old bundle — which also
 * **breaks OTA**: the app "updates", `serverBasePath` moves, and the WebView keeps
 * showing old code with no error anywhere. → `RENDERING.md §3.5`
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

function registerWithMode(
  mode: Exclude<ReturnType<typeof resolveUpdateMode>, null>,
): void {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      updateAvailable = true
      applyWaitingUpdate = () => {
        void updateSW(true)
      }
      notifyUpdateListeners()

      if (mode !== "autoUpdate") return

      //autoUpdate still waits for a SAFE moment. Applying while the tab is
      //visible reloads out from under someone who may be mid-form.
      const applyWhenHidden = () => {
        if (!shouldApplyUpdateNow(mode, document.visibilityState)) return
        document.removeEventListener("visibilitychange", applyWhenHidden)
        void updateSW(true)
      }
      document.addEventListener("visibilitychange", applyWhenHidden)
      applyWhenHidden()
    },
  })
}

/** Register the SW — called when the shell mounts. */
export function registerPwaServiceWorkerRuntime(
  serviceWorker: PwaServiceWorkerRuntimeConfig | undefined,
): void {
  const { register, unregisterForeign = true } = serviceWorker ?? {}

  //The stale-chunk net is unconditional: it must be armed even when adaptv never
  //registers a worker, because the failure is a *deploy* artifact, not a SW one.
  installPreloadErrorRecovery()

  //Capacitor never gets a service worker — not configurable. §3.5
  if (isNativePlatform()) {
    void destroyServiceWorkers()
    return
  }

  const mode = resolveUpdateMode(register)
  if (mode === null) return

  //SW is production/preview only — Vite dev URLs are not cache-stable
  if (import.meta.env.DEV) {
    //DESTROY any worker+cache in dev, not just foreign ones: a adaptv SW registered
    //in a prior prod/preview session on the same origin (or dragged in by a
    //live-reload dev server) otherwise survives into dev and silently serves the
    //OLD bundle inside the WebView, breaking hot reload. Dev is always SW-free.
    void destroyServiceWorkers()
    return
  }

  if (!unregisterForeign) {
    registerWithMode(mode)
    return
  }

  void unregisterForeignServiceWorkers().then(() => registerWithMode(mode))
}

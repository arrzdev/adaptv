import { useCallback, useSyncExternalStore } from "react"
import {
  applyServiceWorkerUpdate,
  getServiceWorkerUpdateAvailable,
  subscribeServiceWorkerUpdate,
} from "#adaptv/shell/service-worker-shell"

export type ServiceWorkerUpdate = {
  /** A new version has installed and is waiting. */
  updateAvailable: boolean
  /** Activate the waiting worker and reload. Safe to call when nothing is waiting. */
  applyUpdate: () => void
}

/**
 * The app side of `serviceWorkerUpdate: "prompt"`. → `RENDERING.md §3.4`
 *
 * Under that policy a new worker installs and **waits**: the old build's chunks
 * stay reachable and nothing reloads without intent. This hook is how the app
 * offers that intent.
 *
 * ```tsx
 * const { updateAvailable, applyUpdate } = useServiceWorkerUpdate()
 * if (updateAvailable) return <Banner onClick={applyUpdate}>New version ready</Banner>
 * ```
 *
 * Under the default `"auto"` policy `updateAvailable` is **always false** — the
 * waiting worker is applied at cold launch and there is no moment to offer. That
 * is not a failure mode to guard against: calling this in a shared component is
 * free, and switching the config flips the behaviour without touching the UI.
 *
 * Also always false on native and in dev, where adaptv registers no worker at all.
 */
export function useServiceWorkerUpdate(): ServiceWorkerUpdate {
  const updateAvailable = useSyncExternalStore(
    subscribeServiceWorkerUpdate,
    getServiceWorkerUpdateAvailable,
    //server snapshot: there is no worker during SSR, so never claim an update —
    //a banner rendered on the server would hydrate into one that cannot be acted on
    () => false,
  )

  const applyUpdate = useCallback(() => {
    applyServiceWorkerUpdate()
  }, [])

  return { updateAvailable, applyUpdate }
}

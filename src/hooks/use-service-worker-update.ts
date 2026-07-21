import { useCallback, useSyncExternalStore } from "react"
import {
  applyServiceWorkerUpdate,
  getServiceWorkerUpdateAvailable,
  subscribeServiceWorkerUpdate,
} from "#nativ/shell/service-worker-shell"

export type ServiceWorkerUpdate = {
  /** A new version has installed and is waiting. */
  updateAvailable: boolean
  /** Activate the waiting worker and reload. Safe to call when nothing is waiting. */
  applyUpdate: () => void
}

/**
 * The consumer side of `register: "prompt"` (the default).
 *
 * In prompt mode a new worker installs and **waits** — the old build's chunks
 * stay reachable, and nothing reloads without user intent. This hook is how the
 * app offers that intent:
 *
 * ```tsx
 * const { updateAvailable, applyUpdate } = useServiceWorkerUpdate()
 * if (updateAvailable) return <Banner onClick={applyUpdate}>New version ready</Banner>
 * ```
 *
 * Built on a `subscribe`/`get` accessor pair rather than component state, per the
 * reactive-hook rule (VISION §2.6, L9) — a non-React consumer can subscribe to the
 * same signal.
 */
export function useServiceWorkerUpdate(): ServiceWorkerUpdate {
  const updateAvailable = useSyncExternalStore(
    subscribeServiceWorkerUpdate,
    getServiceWorkerUpdateAvailable,
    //server snapshot: there is no worker during SSR, so never claim an update
    () => false,
  )

  const applyUpdate = useCallback(() => {
    applyServiceWorkerUpdate()
  }, [])

  return { updateAvailable, applyUpdate }
}

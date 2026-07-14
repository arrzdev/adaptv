import { useEffect } from "react"
import type { PwaServiceWorkerRuntimeConfig } from "#nativ/config/types"
import { registerPwaServiceWorkerRuntime } from "#nativ/shell/service-worker-shell"

/** Wired from `createRootRoute({ serviceWorker })` — apps do not call this directly. */
export function useRegisterPwaServiceWorker(
  serviceWorker: PwaServiceWorkerRuntimeConfig | undefined,
) {
  useEffect(() => {
    registerPwaServiceWorkerRuntime(serviceWorker)
  }, [
    serviceWorker?.register,
    serviceWorker?.unregisterForeign,
    serviceWorker,
  ])
}

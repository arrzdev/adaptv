import { useEffect } from "react"
import type { PwaServiceWorkerRuntimeConfig } from "#adaptv/config/types"
import { registerPwaServiceWorkerRuntime } from "#adaptv/shell/service-worker-shell"

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

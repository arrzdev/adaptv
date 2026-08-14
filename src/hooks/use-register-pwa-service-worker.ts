import { useEffect } from "react"
import { registerPwaServiceWorkerRuntime } from "#adaptv/shell/service-worker-shell"

/**
 * Mounted by the shell. Apps do not call this, and there is nothing to pass:
 * adaptv's worker is not configurable. → `RENDERING.md §3.4`
 */
export function useRegisterPwaServiceWorker() {
  useEffect(() => {
    registerPwaServiceWorkerRuntime()
  }, [])
}

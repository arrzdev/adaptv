import { registerSW } from "virtual:nativ/pwa-register"
import type { PwaServiceWorkerRuntimeConfig } from "#nativ/config/types"
import { unregisterForeignServiceWorkers } from "#nativ/shell/unregister-foreign-service-workers"

function registerAutoUpdateServiceWorker(): void {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      void updateSW(true)
    },
  })
}

function registerAfterForeignCleanup(): void {
  //SW is production/preview only — Vite dev URLs are not cache-stable
  if (import.meta.env.DEV) return

  registerAutoUpdateServiceWorker()
}

/** Register the SW — called when the shell mounts. */
export function registerPwaServiceWorkerRuntime(
  serviceWorker: PwaServiceWorkerRuntimeConfig | undefined,
): void {
  const { register, unregisterForeign = true } = serviceWorker ?? {}
  if (!register) return

  const registerCurrent = () => registerAfterForeignCleanup()

  if (import.meta.env.DEV) {
    if (unregisterForeign) void unregisterForeignServiceWorkers()
    return
  }

  if (!unregisterForeign) {
    registerCurrent()
    return
  }

  void unregisterForeignServiceWorkers().then(registerCurrent)
}

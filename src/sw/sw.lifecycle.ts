import { serviceWorkerScope } from "#nativ/sw/sw.scope"
import type { ServiceWorkerLifecycleOptions } from "#nativ/sw/sw.types"

export function registerSkipWaitingOnMessage() {
  const sw = serviceWorkerScope()

  sw.addEventListener("message", (event: ExtendableMessageEvent) => {
    if (event.data?.type === "SKIP_WAITING") {
      void sw.skipWaiting()
    }
  })
}

export function registerClientsClaimOnActivate() {
  const sw = serviceWorkerScope()

  sw.addEventListener("activate", (event: ExtendableEvent) => {
    event.waitUntil(sw.clients.claim())
  })
}

export function registerServiceWorkerLifecycle(
  options: ServiceWorkerLifecycleOptions = {},
) {
  const { claimClients = true, skipWaitingOnMessage = true } = options

  if (skipWaitingOnMessage) registerSkipWaitingOnMessage()
  if (claimClients) registerClientsClaimOnActivate()
}

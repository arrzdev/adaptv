import { selectStaleCaches } from "#adaptv/sw/sw.navigation-policy"
import { serviceWorkerScope } from "#adaptv/sw/sw.scope"
import type { ServiceWorkerLifecycleOptions } from "#adaptv/sw/sw.types"

/**
 * Delete previous builds' runtime caches. → `DECISIONS.md` B2
 *
 * `cleanupOutdatedCaches()` only purges *precaches*, so adaptv's runtime buckets
 * (`static-<tag>`, `pages-<tag>`, `documents-<tag>`) accumulated one full set per
 * deploy, forever, ending in a quota error on a frequently-deployed app.
 *
 * **Never rejects.** This runs inside `event.waitUntil()` during activate, and a
 * rejection there can leave the worker stuck and the app unbootable. Losing a
 * sweep is survivable; losing activation is not. Every failure is swallowed
 * deliberately — the next activate will try again.
 */
export async function sweepStaleRuntimeCaches(
  currentBuildTag: string,
): Promise<void> {
  try {
    if (typeof caches === "undefined") return
    const stale = selectStaleCaches(await caches.keys(), currentBuildTag)
    await Promise.allSettled(stale.map((name) => caches.delete(name)))
  } catch {
    //storage unavailable or partitioned — try again next activate
  }
}

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

/**
 * Sweep previous builds' runtime caches on activate. Pass the build tag the
 * worker was stamped with (`__ADAPTV_BUILD_TAG__`).
 */
export function registerRuntimeCacheSweep(buildTag: string) {
  const sw = serviceWorkerScope()

  sw.addEventListener("activate", (event: ExtendableEvent) => {
    event.waitUntil(sweepStaleRuntimeCaches(buildTag))
  })
}

export function registerServiceWorkerLifecycle(
  options: ServiceWorkerLifecycleOptions = {},
) {
  const {
    claimClients = true,
    skipWaitingOnMessage = true,
    buildTag,
  } = options

  if (skipWaitingOnMessage) registerSkipWaitingOnMessage()
  if (claimClients) registerClientsClaimOnActivate()
  //without a build tag there is nothing to compare against, so sweeping would
  //either delete everything or nothing — skip rather than guess
  if (buildTag) registerRuntimeCacheSweep(buildTag)
}

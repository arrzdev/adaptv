import { selectStaleCaches } from "#adaptv/sw/sw.navigation-policy"
import { serviceWorkerScope } from "#adaptv/sw/sw.scope"
import type { ServiceWorkerLifecycleOptions } from "#adaptv/sw/sw.types"

/**
 * Delete previous builds' runtime caches. Which ones qualify, and why the sweep
 * is needed at all: {@link selectStaleCaches} / `isStaleRuntimeCache` in
 * `sw.navigation-policy.ts`.
 *
 * **Never rejects.** This runs inside `event.waitUntil()` during activate, and a
 * rejection there can leave the worker stuck and the app unbootable. Losing a
 * sweep is survivable; losing activation is not. Every failure is swallowed
 * deliberately — the next activate will try again.
 */
export async function sweepStaleRuntimeCaches(
  currentBuildTag: string,
  base: string,
): Promise<void> {
  try {
    if (typeof caches === "undefined") return
    const stale = selectStaleCaches(
      await caches.keys(),
      currentBuildTag,
      base,
    )
    await Promise.allSettled(stale.map((name) => caches.delete(name)))
  } catch {
    //storage unavailable or partitioned — try again next activate
  }
}

function registerSkipWaitingOnMessage() {
  const sw = serviceWorkerScope()

  sw.addEventListener("message", (event: ExtendableMessageEvent) => {
    if (event.data?.type === "SKIP_WAITING") {
      void sw.skipWaiting()
    }
  })
}

function registerClientsClaimOnActivate() {
  const sw = serviceWorkerScope()

  sw.addEventListener("activate", (event: ExtendableEvent) => {
    event.waitUntil(sw.clients.claim())
  })
}

/**
 * Sweep previous builds' runtime caches on activate. Pass the build tag the
 * worker was stamped with (`__ADAPTV_BUILD_TAG__`) and the base it is scoped to.
 */
function registerRuntimeCacheSweep(buildTag: string, base: string) {
  const sw = serviceWorkerScope()

  sw.addEventListener("activate", (event: ExtendableEvent) => {
    event.waitUntil(sweepStaleRuntimeCaches(buildTag, base))
  })
}

/**
 * Turn Navigation Preload on — or deliberately off. → `docs/design/rendering.md §3.3`
 *
 * A registered worker sits in the path of every navigation, so the browser pays
 * SW startup (~50–250ms cold on mobile) *before* the document request even
 * leaves. Preload starts that request in parallel with startup, so the two costs
 * overlap instead of stacking.
 *
 * **Enabled state lives on the REGISTRATION, not on the worker**, and survives
 * every update — so `false` here is not "skip a step", it is the one thing that
 * undoes a previous build's `enable()`. An app that switches `render` from `ssr`
 * to `spa` otherwise keeps preloading a document its worker will never read: one
 * wasted request per navigation, plus a cancellation warning in the console.
 *
 * **Never rejects.** Like the sweep, this runs inside `event.waitUntil()` during
 * activate, where a rejection can leave the worker stuck and the app unbootable.
 * Preload is an optimisation; activation is not.
 *
 * Returns whether preload is on afterwards — `false` on a browser without it
 * (Safari only shipped it in 15.4).
 */
export async function applyNavigationPreload(
  enabled: boolean,
): Promise<boolean> {
  try {
    const preload = serviceWorkerScope().registration?.navigationPreload
    if (!preload) return false
    if (enabled) await preload.enable()
    else await preload.disable()
    return enabled
  } catch {
    //unsupported, or the registration went away mid-activate
    return false
  }
}

/**
 * Apply the preload decision on activate.
 *
 * Deliberately **not** part of `registerServiceWorkerLifecycle`: whether a
 * preload is useful is a property of the navigation policy, and enabling one
 * nobody consumes is strictly worse than leaving it off. `registerNavigationRoute`
 * owns the call, so the two cannot disagree.
 */
export function registerNavigationPreload(enabled: boolean) {
  const sw = serviceWorkerScope()

  sw.addEventListener("activate", (event: ExtendableEvent) => {
    event.waitUntil(applyNavigationPreload(enabled))
  })
}

export function registerServiceWorkerLifecycle(
  options: ServiceWorkerLifecycleOptions = {},
) {
  const { claimClients = true, skipWaitingOnMessage = true } = options

  if (skipWaitingOnMessage) registerSkipWaitingOnMessage()
  if (claimClients) registerClientsClaimOnActivate()
  //without a build tag there is nothing to compare against, so sweeping would
  //either delete everything or nothing — skip rather than guess
  if (options.buildTag) {
    registerRuntimeCacheSweep(options.buildTag, options.base)
  }
}

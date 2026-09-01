import { registerRoute } from "workbox-routing"
import {
  createCacheFirstStrategy,
  createNetworkFirstStrategy,
  createStaleWhileRevalidateStrategy,
} from "#adaptv/sw/sw.strategies"

/**
 * Runtime caching for an app's OWN requests, from a module listed in
 * `serviceWorkers: []`.
 *
 * The strategy is a string rather than a constructed object on purpose: the
 * caching library is an implementation detail adaptv reserves the right to swap
 * (`docs/design/rendering.md §3.6`), and a signature that takes its objects would make every
 * app that caches anything a blocker on that decision.
 */

export type CacheRouteStrategy =
  /** Fresh when possible, cached when the network is slow or down. */
  | "network-first"
  /** Cached forever once seen. Only correct for immutable URLs. */
  | "cache-first"
  /** Cached copy immediately, refreshed in the background for next time. */
  | "stale-while-revalidate"

export type CacheRouteOptions = {
  /** Which requests this rule claims. */
  match: (url: URL, request: Request) => boolean
  strategy: CacheRouteStrategy
  /**
   * Bucket name, namespaced to `app-<name>` so it can never collide with — or be
   * swept by — adaptv's own per-build caches.
   */
  cacheName: string
  /** Rolling window. Omit both for a permanent cache. */
  maxEntries?: number
  maxAgeSeconds?: number
  /** `network-first` only: seconds before falling back to the cached copy. */
  networkTimeoutSeconds?: number
}

/**
 * Register a runtime cache.
 *
 * ⚠︎ Never route **navigation** requests or credentialed documents through this.
 * Cache Storage is keyed by URL and scoped per-ORIGIN, not per-user, so a cached
 * personalized response is served to whoever asks for the same URL next — a
 * cross-user leak rather than a stale-data bug. → `docs/design/rendering.md §3.2`
 */
export function cacheRoute(options: CacheRouteOptions): void {
  const expiration =
    options.maxEntries === undefined && options.maxAgeSeconds === undefined
      ? undefined
      : {
          maxEntries: options.maxEntries,
          maxAgeSeconds: options.maxAgeSeconds,
        }

  const strategyOptions = {
    cacheName: `app-${options.cacheName}`,
    expiration,
  }

  const strategy =
    options.strategy === "cache-first"
      ? createCacheFirstStrategy(strategyOptions)
      : options.strategy === "stale-while-revalidate"
        ? createStaleWhileRevalidateStrategy(strategyOptions)
        : createNetworkFirstStrategy({
            ...strategyOptions,
            networkTimeoutSeconds: options.networkTimeoutSeconds,
          })

  registerRoute(({ url, request }) => {
    //An app route may never answer a navigation. On `ssr`/`spa` adaptv's own
    //navigation route is registered first and normally wins anyway; on the
    //`capacitor` target NO navigation route is registered at all
    //(`sw.navigation-policy.ts`: `kind: "none"`), so there is nothing in front
    //and this guard is the only thing stopping a broad app matcher from
    //serving a document out of a runtime cache.
    if (request.mode === "navigate") return false
    return options.match(url, request)
  }, strategy)
}

import type { WorkboxPlugin } from "workbox-core/types"
import type { Strategy } from "workbox-strategies"
import type { NavigationRouteMatchOptions } from "#nativ/sw/sw.navigation-match"

export type PrecacheManifestEntry = {
  url: string
  revision: string | null
}

/** Rolling window + TTL for a cache bucket. Omit for permanent caches. */
export type CacheExpirationOptions = {
  maxEntries?: number
  maxAgeSeconds?: number
  purgeOnQuotaError?: boolean
}

export type CacheMatchOptions = {
  ignoreVary?: boolean
  ignoreSearch?: boolean
  ignoreMethod?: boolean
}

export type StrategyFactoryOptions = {
  cacheName: string
  matchOptions?: CacheMatchOptions
  expiration?: CacheExpirationOptions
  plugins?: WorkboxPlugin[]
}

export type NetworkFirstStrategyOptions = StrategyFactoryOptions & {
  /**
   * Seconds to wait for the network before falling back to cache.
   * The network request continues in the background and updates the cache on 200 —
   * stale-while-revalidate behaviour when a cached response exists.
   */
  networkTimeoutSeconds?: number
}

export type IncrementalNavigationRouteOptions =
  NavigationRouteMatchOptions & {
    buildTag: string
    cacheBucket?: string
    strategy?: Strategy
    networkTimeoutSeconds?: number
    expiration?: CacheExpirationOptions
    offlineFallbackPath?: string
    matchOptions?: CacheMatchOptions
  }

export type StaticAssetsRouteOptions = {
  buildTag: string
  cacheBucket?: string
  expiration?: CacheExpirationOptions
  excludePathPrefixes?: string[]
  matchOptions?: CacheMatchOptions
}

export type WarmRoutesOnInstallOptions = {
  buildTag: string
  cacheBucket?: string
  routes: readonly string[]
  /** Also prefetched on install (skip when the page is precached via `__WB_MANIFEST`). */
  offlineFallbackPath?: string
}

export type ServiceWorkerLifecycleOptions = {
  claimClients?: boolean
  skipWaitingOnMessage?: boolean
}

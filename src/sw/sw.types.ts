import type { WorkboxPlugin } from "workbox-core/types"

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

export type StaticAssetsRouteOptions = {
  buildTag: string
  cacheBucket?: string
  expiration?: CacheExpirationOptions
  excludePathPrefixes?: string[]
  matchOptions?: CacheMatchOptions
}

export type ServiceWorkerLifecycleOptions = {
  claimClients?: boolean
  skipWaitingOnMessage?: boolean
  /**
   * The build tag this worker was stamped with (`__ADAPTV_BUILD_TAG__`). Enables
   * the activate-time sweep of previous builds' runtime caches (B2). Omit to
   * skip sweeping.
   */
  buildTag?: string
}

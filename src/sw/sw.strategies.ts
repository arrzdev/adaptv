import type { Strategy } from "workbox-strategies"
import {
  CacheFirst,
  NetworkFirst,
  StaleWhileRevalidate,
} from "workbox-strategies"
import { createCacheName } from "#nativ/sw/sw.cache-name"
import { createExpirationPlugins } from "#nativ/sw/sw.expiration"
import { createCacheOkResponsesPlugin } from "#nativ/sw/sw.plugins"
import type {
  NetworkFirstStrategyOptions,
  StrategyFactoryOptions,
} from "#nativ/sw/sw.types"

function resolveStrategyPlugins(
  options: StrategyFactoryOptions,
): Strategy["plugins"] {
  return [
    createCacheOkResponsesPlugin(),
    ...createExpirationPlugins(options.expiration),
    ...(options.plugins ?? []),
  ]
}

function resolveMatchOptions(options: StrategyFactoryOptions) {
  return {
    ignoreVary: true,
    ...options.matchOptions,
  }
}

/**
 * Network-first with optional timeout. After timeout, serves cache when present
 * while the network request continues in the background (stale-while-revalidate).
 */
export function createNetworkFirstStrategy(
  options: NetworkFirstStrategyOptions,
): Strategy {
  return new NetworkFirst({
    cacheName: options.cacheName,
    networkTimeoutSeconds: options.networkTimeoutSeconds,
    matchOptions: resolveMatchOptions(options),
    plugins: resolveStrategyPlugins(options),
  })
}

/** Stale-while-revalidate — serve cache immediately, refresh in background. */
export function createStaleWhileRevalidateStrategy(
  options: StrategyFactoryOptions,
): Strategy {
  return new StaleWhileRevalidate({
    cacheName: options.cacheName,
    matchOptions: resolveMatchOptions(options),
    plugins: resolveStrategyPlugins(options),
  })
}

/** Cache-first — offline-friendly assets with optional TTL / max entries. */
export function createCacheFirstStrategy(
  options: StrategyFactoryOptions,
): Strategy {
  return new CacheFirst({
    cacheName: options.cacheName,
    matchOptions: resolveMatchOptions(options),
    plugins: resolveStrategyPlugins(options),
  })
}

export function createPagesNetworkFirstStrategy(
  buildTag: string,
  options: Omit<NetworkFirstStrategyOptions, "cacheName"> & {
    cacheBucket?: string
  } = {},
): Strategy {
  const cacheBucket = options.cacheBucket ?? "pages"
  return createNetworkFirstStrategy({
    ...options,
    cacheName: createCacheName(buildTag, cacheBucket),
  })
}

export function createStaticStaleWhileRevalidateStrategy(
  buildTag: string,
  options: Omit<StrategyFactoryOptions, "cacheName"> & {
    cacheBucket?: string
  } = {},
): Strategy {
  const cacheBucket = options.cacheBucket ?? "static"
  return createStaleWhileRevalidateStrategy({
    ...options,
    cacheName: createCacheName(buildTag, cacheBucket),
  })
}

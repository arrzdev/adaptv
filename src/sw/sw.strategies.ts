import type { Strategy } from "workbox-strategies"
import {
  CacheFirst,
  NetworkFirst,
  StaleWhileRevalidate,
} from "workbox-strategies"
import { createCacheName } from "#adaptv/sw/sw.cache-name"
import { createExpirationPlugins } from "#adaptv/sw/sw.expiration"
import { createCacheOkResponsesPlugin } from "#adaptv/sw/sw.plugins"
import type {
  NetworkFirstStrategyOptions,
  StrategyFactoryOptions,
} from "#adaptv/sw/sw.types"

function resolveStrategyPlugins(
  options: StrategyFactoryOptions,
): Strategy["plugins"] {
  return [
    createCacheOkResponsesPlugin(),
    ...createExpirationPlugins(options.expiration),
    ...(options.plugins ?? []),
  ]
}

/**
 * Cache match options — passed through untouched, and that is the whole point.
 *
 * **`ignoreVary` must never be defaulted on here.** Forcing `ignoreVary: true`
 * on every strategy defeats `Vary: Cookie` on *documents* — the one HTTP
 * mechanism that partitions a per-user response — so user A's server-rendered
 * HTML can be served to user B on the same device. A privacy bug, not a tuning
 * knob. → `docs/decisions/register.md` B5/B25, `docs/design/rendering.md §3.2`
 *
 * Opt in per rule where it is provably safe; {@link createHashedAssetStrategy}
 * is the one place adaptv does.
 */
function resolveMatchOptions(options: StrategyFactoryOptions) {
  return { ...options.matchOptions }
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

/**
 * The strategy for **content-hashed build assets**.
 *
 * Cache-first, not stale-while-revalidate: the filename *is* the version, so a
 * changed file arrives under a changed URL and a cached entry can never be stale.
 * SWR here revalidates every asset on every load — guaranteed-useless traffic.
 *
 * This is also the one place `ignoreVary` is safe: with the version in the URL,
 * response headers cannot make two entries meaningfully different, and honouring
 * `Vary: Accept-Encoding` just causes redundant misses.
 */
export function createHashedAssetStrategy(
  options: StrategyFactoryOptions,
): Strategy {
  return createCacheFirstStrategy({
    ...options,
    matchOptions: { ignoreVary: true, ...options.matchOptions },
  })
}

export function createStaticAssetStrategy(
  buildTag: string,
  options: Omit<StrategyFactoryOptions, "cacheName"> & {
    cacheBucket?: string
  } = {},
): Strategy {
  const cacheBucket = options.cacheBucket ?? "static"
  return createHashedAssetStrategy({
    ...options,
    cacheName: createCacheName(buildTag, cacheBucket),
  })
}

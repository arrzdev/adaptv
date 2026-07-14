import { matchPrecache } from "workbox-precaching"
import { registerRoute } from "workbox-routing"
import type { Strategy } from "workbox-strategies"
import { createCacheName } from "#nativ/sw/sw.cache-name"
import { createNavigationRouteMatch } from "#nativ/sw/sw.navigation-match"
import { serviceWorkerScope } from "#nativ/sw/sw.scope"
import { createPagesNetworkFirstStrategy } from "#nativ/sw/sw.strategies"
import type { IncrementalNavigationRouteOptions } from "#nativ/sw/sw.types"

async function resolveOfflineFallbackResponse(
  offlineFallbackPath: string | undefined,
) {
  if (!offlineFallbackPath) return Response.error()

  const sw = serviceWorkerScope()
  const offlineUrl = new URL(offlineFallbackPath, sw.location.origin).href
  //precache only — pages cache can hold a stale warmed copy with old shell colors
  return (await matchPrecache(offlineUrl)) ?? Response.error()
}

function resolveNavigationStrategy(
  options: IncrementalNavigationRouteOptions,
): Strategy {
  if (options.strategy) return options.strategy

  const {
    buildTag,
    cacheBucket = "pages",
    networkTimeoutSeconds,
    expiration,
    matchOptions,
  } = options

  return createPagesNetworkFirstStrategy(buildTag, {
    cacheBucket,
    networkTimeoutSeconds,
    expiration,
    matchOptions,
  })
}

async function handleIncrementalNavigation(
  strategy: Strategy,
  offlineFallbackPath: string | undefined,
  handlerOptions: { request: Request; event: ExtendableEvent },
) {
  try {
    const response = await strategy.handle(handlerOptions)
    if (response) return response
  } catch {
    //NetworkFirst throws when both network and cache miss
  }

  return resolveOfflineFallbackResponse(offlineFallbackPath)
}

/**
 * Incremental navigation cache scoped by path prefix, pattern, or custom match.
 * Register **specific routes first**, then the catch-all (omit `pathPrefix` / `pathPattern`).
 *
 * Omit `expiration` for a permanent visit cache; pass `maxEntries` / `maxAgeSeconds`
 * for a rolling window (e.g. product listing pages).
 */
export function registerIncrementalNavigationRoute(
  options: IncrementalNavigationRouteOptions,
) {
  const strategy = resolveNavigationStrategy(options)
  const offlineFallbackPath = options.offlineFallbackPath
  const match = createNavigationRouteMatch(options)

  registerRoute(match, (handlerOptions) =>
    handleIncrementalNavigation(
      strategy,
      offlineFallbackPath,
      handlerOptions,
    ),
  )

  return {
    cacheName: createCacheName(
      options.buildTag,
      options.cacheBucket ?? "pages",
    ),
    strategy,
  }
}

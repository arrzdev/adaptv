import { registerRoute } from "workbox-routing"
import { createStaticAssetMatcher } from "#nativ/sw/sw.matchers"
import { createStaticStaleWhileRevalidateStrategy } from "#nativ/sw/sw.strategies"
import type { StaticAssetsRouteOptions } from "#nativ/sw/sw.types"

/**
 * Runtime cache for hashed build assets. Precache covers install;
 * this handles any same-origin `/assets/*` and resource fetches.
 */
export function registerStaticAssetsRoute(
  options: StaticAssetsRouteOptions,
) {
  const strategy = createStaticStaleWhileRevalidateStrategy(
    options.buildTag,
    {
      cacheBucket: options.cacheBucket,
      expiration: options.expiration,
      matchOptions: options.matchOptions,
    },
  )

  registerRoute(
    ({ url, request }) =>
      createStaticAssetMatcher({
        excludePathPrefixes: options.excludePathPrefixes,
      })(url, request),
    strategy,
  )

  return { strategy }
}

import { registerRoute } from "workbox-routing"
import { createStaticAssetMatcher } from "#adaptv/sw/sw.matchers"
import { createStaticAssetStrategy } from "#adaptv/sw/sw.strategies"
import type { StaticAssetsRouteOptions } from "#adaptv/sw/sw.types"

/**
 * Runtime cache for hashed build assets. Precache covers install; this handles any
 * same-origin `/assets/*` and resource fetch that the manifest missed.
 *
 * Cache-first, not stale-while-revalidate: the filename IS the version, so a
 * cached entry can never be stale and revalidating it is guaranteed-useless
 * traffic. → sw.strategies.ts
 */
export function registerStaticAssetsRoute(
  options: StaticAssetsRouteOptions,
) {
  const strategy = createStaticAssetStrategy(options.buildTag, {
    cacheBucket: options.cacheBucket,
    expiration: options.expiration,
    matchOptions: options.matchOptions,
  })

  registerRoute(
    ({ url, request }) =>
      createStaticAssetMatcher({
        excludePathPrefixes: options.excludePathPrefixes,
      })(url, request),
    strategy,
  )

  return { strategy }
}

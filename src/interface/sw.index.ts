//The service-worker toolkit an app's `src/sw.ts` composes.
//
//Note what is NOT here any more, and why — see docs/RENDERING.md §3.2:
//  • `registerInstallRouteWarmer` — prefetched HTML DOCUMENTS with
//    `credentials: "same-origin"` into a URL-keyed cache. Prefetching every route
//    is still the goal; prefetching the wrong *layer* was the bug. Route chunks
//    come from the precache manifest, which is static, hashed and user-agnostic.
//  • `createPagesNetworkFirstStrategy` / `registerIncrementalNavigationRoute` —
//    cached navigation documents. Under SSR that is per-user HTML in a shared
//    bucket. Navigation is now a pure function of render mode.
export { createCacheName } from "../sw/sw.cache-name.ts"
export { createExpirationPlugins } from "../sw/sw.expiration.ts"
export {
  registerClientsClaimOnActivate,
  registerRuntimeCacheSweep,
  registerServiceWorkerLifecycle,
  registerSkipWaitingOnMessage,
  sweepStaleRuntimeCaches,
} from "../sw/sw.lifecycle.ts"
export { createStaticAssetMatcher } from "../sw/sw.matchers.ts"
export type { NavigationRouteOptions } from "../sw/sw.navigation.ts"
export { registerNavigationRoute } from "../sw/sw.navigation.ts"
export type {
  NavigationMode,
  NavigationPolicy,
} from "../sw/sw.navigation-policy.ts"
export {
  isStaleRuntimeCache,
  resolveNavigationPolicy,
  selectStaleCaches,
} from "../sw/sw.navigation-policy.ts"
export { createCacheOkResponsesPlugin } from "../sw/sw.plugins.ts"
export { setupPrecache } from "../sw/sw.precache.ts"
export { registerStaticAssetsRoute } from "../sw/sw.static-assets.ts"
export {
  createCacheFirstStrategy,
  createHashedAssetStrategy,
  createNetworkFirstStrategy,
  createStaleWhileRevalidateStrategy,
  createStaticAssetStrategy,
} from "../sw/sw.strategies.ts"
export type {
  CacheExpirationOptions,
  CacheMatchOptions,
  NetworkFirstStrategyOptions,
  PrecacheManifestEntry,
  ServiceWorkerLifecycleOptions,
  StaticAssetsRouteOptions,
  StrategyFactoryOptions,
} from "../sw/sw.types.ts"

export { createCacheName } from "../sw/sw.cache-name.ts"
export { createExpirationPlugins } from "../sw/sw.expiration.ts"
export {
  registerClientsClaimOnActivate,
  registerServiceWorkerLifecycle,
  registerSkipWaitingOnMessage,
} from "../sw/sw.lifecycle.ts"
export { createStaticAssetMatcher } from "../sw/sw.matchers.ts"
export { registerIncrementalNavigationRoute } from "../sw/sw.navigation.ts"
export type { NavigationRouteMatchOptions } from "../sw/sw.navigation-match.ts"
export { createNavigationRouteMatch } from "../sw/sw.navigation-match.ts"
export { createCacheOkResponsesPlugin } from "../sw/sw.plugins.ts"
export { setupPrecache } from "../sw/sw.precache.ts"
export { registerStaticAssetsRoute } from "../sw/sw.static-assets.ts"
export {
  createCacheFirstStrategy,
  createNetworkFirstStrategy,
  createPagesNetworkFirstStrategy,
  createStaleWhileRevalidateStrategy,
  createStaticStaleWhileRevalidateStrategy,
} from "../sw/sw.strategies.ts"
export type {
  CacheExpirationOptions,
  CacheMatchOptions,
  IncrementalNavigationRouteOptions,
  NetworkFirstStrategyOptions,
  PrecacheManifestEntry,
  ServiceWorkerLifecycleOptions,
  StaticAssetsRouteOptions,
  StrategyFactoryOptions,
  WarmRoutesOnInstallOptions,
} from "../sw/sw.types.ts"
export {
  createInstallRouteWarmer,
  registerInstallRouteWarmer,
} from "../sw/sw.warm-routes.ts"

//The toolkit for an app's OWN service-worker modules — the files listed in
//`serviceWorkers: []`. → `AdaptvAppConfig.serviceWorkers`, `RENDERING.md §3`
//
//Note what is NOT here, and why: `setupPrecache`, `registerNavigationRoute`,
//`registerStaticAssetsRoute` and `registerServiceWorkerLifecycle` are the worker
//itself, and adaptv calls them. Exporting them made a hand-written worker that
//restates the whole delivery contract possible — which is how chopchop's copy was
//still calling `registerInstallRouteWarmer` long after that became the B25
//privacy bug. Keeping them internal makes "adaptv owns delivery" a property of
//the package rather than a rule in a document.
export type {
  CacheRouteOptions,
  CacheRouteStrategy,
} from "../sw/sw.cache-route.ts"
export { cacheRoute } from "../sw/sw.cache-route.ts"
export type { ServiceWorkerMessage } from "../sw/sw.messaging.ts"
export { onAppMessage, sendToApp } from "../sw/sw.messaging.ts"

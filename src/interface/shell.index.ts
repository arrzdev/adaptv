export type {
  CreateRootRouteConfig,
  RootHeadScript,
} from "../shell/create-root-route"
export { createRootRoute } from "../shell/create-root-route"
export {
  clearPreloadErrorGuard,
  installPreloadErrorRecovery,
} from "../shell/preload-error-recovery"
//The shape of the build-time route→chrome-tint table. Exported for the ambient
//declaration of `virtual:adaptv/route-tints`, which is the only place a consumer
//meets it — the option itself is declared on the route.
export type { RouteTint } from "../shell/route-tints"
//`destroyServiceWorkers` is the remediation path for a broken worker — the
//`sw: "destroy"` kill switch vite-plugin-pwa gave us. RENDERING.md §3.6
export { destroyServiceWorkers } from "../shell/service-worker-shell"
export { standaloneMemoryHistory } from "../shell/standalone-history"

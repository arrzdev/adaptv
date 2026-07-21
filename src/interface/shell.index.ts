export type {
  CreateRootRouteConfig,
  RootHeadScript,
} from "../shell/create-root-route"
export { createRootRoute } from "../shell/create-root-route"
export {
  clearPreloadErrorGuard,
  installPreloadErrorRecovery,
} from "../shell/preload-error-recovery"
//`destroyServiceWorkers` is the remediation path for a broken worker — the
//`sw: "destroy"` kill switch vite-plugin-pwa gave us. RENDERING.md §3.6
export { destroyServiceWorkers } from "../shell/service-worker-shell"
export { standaloneMemoryHistory } from "../shell/standalone-history"

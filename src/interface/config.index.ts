export {
  type AdaptvAppConfig,
  type AdaptvPatches,
  type AdaptvRouterConfig,
  type AdaptvUiConfig,
  defineApp,
  type ScreenThunk,
  type UiPatchScope,
} from "../config/app-config.ts"
//No `defineSwConfig` / `SwConfig`: an app has no service-worker config to define.
//adaptv's worker is not configurable, and the app's own modules are named in
//`serviceWorkers: []`. → `docs/design/rendering.md §3`
export type {
  NotFoundScreenComponent,
  NotFoundScreenProps,
  OrientationGuardProps,
  OrientationLock,
  SplashScreenProps,
} from "../config/types.ts"

declare module "virtual:adaptv/pwa-register" {
  /**
   * Register adaptv's service worker. → `RENDERING.md §3.4`
   *
   * `onWaiting` is only ever called under `serviceWorkerUpdate: "prompt"`; it
   * receives the function that applies the waiting worker. Under the default
   * `"auto"` the module applies it itself, at cold launch, and never calls back.
   */
  export function registerSW(onWaiting?: (apply: () => void) => void): void

  /**
   * Whether `ADAPTV_DEV_SW=1` armed the dev escape hatch at build time. Always
   * `false` in a production build. → `vite/sw-dev.ts`
   */
  export const DEV_SW_ENABLED: boolean
}

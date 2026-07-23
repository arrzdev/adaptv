declare module "virtual:adaptv/router-config" {
  import type { AdaptvRouterOptions } from "#adaptv/shell/create-adaptv-router"
  /** `createRouter` options resolved from `adaptv.config.ts`. */
  export const routerOptions: Omit<AdaptvRouterOptions, "routeTree">
}

declare module "#adaptv-route-tree" {
  //Aliased by adaptv's Vite plugin AND mapped in the app's tsconfig paths, so the
  //route tree's real type flows into the Register augmentation. See router-entry.
  export const routeTree: unknown
}

declare module "virtual:nativ/router-config" {
  import type { NativRouterOptions } from "#nativ/shell/create-nativ-router"
  /** `createRouter` options resolved from `nativ.config.ts`. */
  export const routerOptions: Omit<NativRouterOptions, "routeTree">
}

declare module "#nativ-route-tree" {
  //Aliased by nativ's Vite plugin AND mapped in the app's tsconfig paths, so the
  //route tree's real type flows into the Register augmentation. See router-entry.
  export const routeTree: unknown
}

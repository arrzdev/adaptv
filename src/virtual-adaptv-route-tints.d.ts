declare module "virtual:adaptv/route-tints" {
  import type { RouteTint } from "@arrzdev/adaptv/shell"

  /**
   * Every route that declares a `chromeTint`, most specific first. Computed at
   * build time by scanning the route files — see `src/shell/route-tints.ts` for
   * why it cannot be read off the route object at runtime.
   */
  export const ROUTE_TINTS: RouteTint[]
}

declare module "virtual:adaptv/root-route" {
  import type { createRootRoute } from "adaptv/router"
  /**
   * The app's root route, served by adaptv's Vite plugin from `adaptv.config.ts`.
   *
   * ⚠︎ Typed as what the plugin actually emits — `createRootRoute(<config>)` — and NOT
   * as `unknown`. It was `unknown`, on the reasoning that re-stating TanStack's
   * root-route shape here would mean maintaining a copy of a type the router already
   * owns. True, and `ReturnType` avoids the copy while keeping the type real.
   *
   * `unknown` was not a loose type, it was a load-bearing one. The generated route tree
   * builds every route off this import (`rootRouteImport._addFileChildren(...)`), so an
   * opaque root makes the WHOLE tree opaque, `Register` binds a router over `AnyRoute`,
   * and every `to:` in the app widens to `string` — no autocomplete, no wrong-route
   * error. Nothing reports it, because the generated tree carries `@ts-nocheck` and the
   * suppressed error surfaces as `any` rather than as a diagnostic. Measured on the
   * playground, where typed routing had been dead. → src/routes/route-tree-stub.d.ts
   * (the same failure, reached the other way round)
   */
  export const Route: ReturnType<typeof createRootRoute>
}

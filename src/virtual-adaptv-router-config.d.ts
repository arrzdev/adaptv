declare module "virtual:adaptv/router-config" {
  import type { createAdaptvRouter } from "@arrzdev/adaptv/router"
  /** `createRouter` options resolved from `adaptv.config.ts`. */
  export const routerOptions: Omit<
    Parameters<typeof createAdaptvRouter>[0],
    "routeTree"
  >
}

//⚠︎ `#adaptv-route-tree` is deliberately NOT declared here, and this file is the
//reason the rule needs writing down: it SHIPS, and an app's tsconfig pulls it in
//through the `virtual-adaptv-*.d.ts` include glob adaptv documents.
//
//TypeScript consults ambient `declare module`s BEFORE `compilerOptions.paths`
//(`tryFindAmbientModule` runs first in the checker). So an ambient fallback here —
//however well-intentioned — SHADOWS the `#adaptv-route-tree` → `.adaptv/routeTree.gen.ts`
//mapping that `stamp.ts` writes into the app, and the route tree's real type never
//reaches `getRouter`. `Register` then binds `AnyRoute`, and every `to:` in the app
//silently widens to `string`: no autocomplete, no wrong-route error, no diagnostic
//anywhere. Measured, not theorised — it was live in the playground.
//
//The framework's OWN typecheck needs the specifier to resolve too; it gets there via
//`paths` in the root tsconfig, pointing at `src/routes/route-tree-stub.d.ts`. A path
//mapping is scoped to the project that declares it, so it cannot leak downstream the
//way an ambient declaration does.

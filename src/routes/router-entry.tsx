import { routerOptions } from "virtual:adaptv/router-config"
import { createAdaptvRouter } from "#adaptv/shell/create-adaptv-router"
import { routeTree } from "#adaptv-route-tree"

/**
 * The router entry. **A real module in the framework, not a generated file.**
 *
 * This is what TanStack Start resolves as `router.entry`. It used to be stamped
 * into every app as `.adaptv/router.gen.tsx`, and the justification was "Start
 * needs a module *path* exporting `getRouter`". True, but the path does not have
 * to be in the consumer's tree — it can be this one.
 *
 * Two aliases carry the only app-specific inputs:
 *
 * - **`#adaptv-route-tree`** → `<app>/.adaptv/routeTree.gen.ts`. This is aliased for
 *   the bundler *and* mapped in the app's `tsconfig.paths`, which matters: the
 *   `Register` augmentation binds `ReturnType<typeof getRouter>`, so the route
 *   tree's concrete **type** has to flow through here. A plain virtual module
 *   (typed `unknown`) would silently collapse typed routing to `any` — the exact
 *   failure the 2026-07-05 spike warned about.
 * - **`virtual:adaptv/router-config`** → the `createRouter` options from
 *   `adaptv.config.ts`. Values only, so a virtual module is fine.
 */
/**
 * The router, named in terms of the alias rather than inferred through it.
 *
 * ⚠︎ The annotation on `getRouter` below is not decoration. An INFERRED return type has
 * to be materialised when `dist/*.d.mts` is emitted, and the only route tree reachable
 * at that moment is the framework's own stub — so the published types would hardcode
 * `RouterCore<AnyRoute, …>`, and every consumer of the built package would inherit the
 * exact widening that killed typed routing. Measured: that is what `dist/router.d.mts`
 * emitted before this alias existed.
 *
 * Written as a named type, the emitter keeps `#adaptv-route-tree` as a live import in
 * the declaration file, so the app's stamped `tsconfig.paths` still decides what it
 * means — the same indirection that works from source, preserved into dist.
 * → tsdown.config.ts (`deps.neverBundle`), src/routes/route-tree-stub.d.ts
 */
export type AdaptvRouter = ReturnType<
  typeof createAdaptvRouter<typeof routeTree>
>

export function getRouter(): AdaptvRouter {
  return createAdaptvRouter({ routeTree, ...routerOptions })
}

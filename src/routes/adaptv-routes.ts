import {
  index,
  layout,
  physical,
  route,
  rootRoute as upstreamRootRoute,
} from "@tanstack/virtual-file-routes"

/**
 * Where the generated root route lives, **relative to `routesDirectory`**. adaptv
 * stamps that file (gitignored, like `routeTree.gen.ts`); consumers never write it.
 *
 * The generator resolves virtual route files against `routesDirectory`, so this
 * escapes upward into `.adaptv/`. That keeps the consumer's routes tree free of
 * framework artifacts: they write route files, adaptv writes the root, and the
 * two never sit in the same folder.
 *
 * Set by adaptv's Vite plugin, which is the only place that knows both
 * `routesDirectory` and the app root. Reading it unguarded is deliberate: if it
 * is unset, the route DSL ran outside the plugin and any default would resolve
 * to a file that is not there — a confusing import error instead of this one.
 */
function generatedRootFile(): string {
  const file = process.env.ADAPTV_ROOT_ROUTE_FILE
  if (!file) {
    throw new Error(
      "[adaptv] ADAPTV_ROOT_ROUTE_FILE is unset — the route config was evaluated outside adaptv's Vite plugin",
    )
  }
  return file
}

type RootChildren = Parameters<typeof upstreamRootRoute>[1]
type VirtualRootRoute = ReturnType<typeof upstreamRootRoute>

/**
 * Declare the app's route tree. adaptv owns the root — pass only the children and
 * the generated `__root.gen.tsx` is wired in for you:
 *
 * ```ts
 * export const routes = rootRoute([
 *   index("pages/todos.tsx"),
 *   route("/settings", "pages/settings.tsx"),
 * ])
 * ```
 *
 * To eject and own the root route file, pass it explicitly — same signature as
 * `@tanstack/virtual-file-routes`: `rootRoute("layouts/_root.tsx", [ ... ])`.
 */
export function rootRoute(children?: RootChildren): VirtualRootRoute
export function rootRoute(
  file: string,
  children?: RootChildren,
): VirtualRootRoute
export function rootRoute(
  fileOrChildren?: string | RootChildren,
  maybeChildren?: RootChildren,
): VirtualRootRoute {
  if (typeof fileOrChildren === "string") {
    return upstreamRootRoute(fileOrChildren, maybeChildren)
  }
  return upstreamRootRoute(generatedRootFile(), fileOrChildren)
}

//the rest of the virtual-file-routes DSL passes through unchanged — adaptv has no
//opinion on non-root nodes (wrap-on-opinion).
export { index, layout, physical, route }

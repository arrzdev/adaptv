import {
  index,
  layout,
  physical,
  route,
  rootRoute as upstreamRootRoute,
} from "@tanstack/virtual-file-routes"

/**
 * The generated root route file nativ stamps (gitignored, like
 * `routeTree.gen.ts`). Consumers never write it.
 */
const GENERATED_ROOT_FILE = "layouts/__root.gen.tsx"

type RootChildren = Parameters<typeof upstreamRootRoute>[1]
type VirtualRootRoute = ReturnType<typeof upstreamRootRoute>

/**
 * Declare the app's route tree. nativ owns the root — pass only the children and
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
  return upstreamRootRoute(GENERATED_ROOT_FILE, fileOrChildren)
}

//the rest of the virtual-file-routes DSL passes through unchanged — nativ has no
//opinion on non-root nodes (wrap-on-opinion).
export { index, layout, physical, route }

import {
  index as upstreamIndex,
  layout as upstreamLayout,
  physical as upstreamPhysical,
  rootRoute as upstreamRootRoute,
  route as upstreamRoute,
} from "@tanstack/virtual-file-routes"

//The DSL's node types, under adaptv's names. They are plain data the generator
//reads, so adaptv states their shape rather than handing out
//`@tanstack/virtual-file-routes`' names in every hover and every type error. The
//functions below pass each node straight through upstream's, so a shape that
//drifts from upstream's fails to typecheck here rather than in an app.
//→ docs/decisions/facade-and-opacity.md §1

/** `index("pages/home.tsx")`: the file that renders at its parent's path. */
export interface IndexRouteNode {
  type: "index"
  file: string
}

/** `layout("layouts/app.tsx", [ … ])`: a pathless route that wraps its children. */
export interface LayoutRouteNode {
  type: "layout"
  id?: string
  file: string
  children?: RouteNode[]
}

/** `route("/settings", "pages/settings.tsx")`: a route at a path segment. */
export interface PathRouteNode {
  type: "route"
  file?: string
  path: string
  children?: RouteNode[]
}

/** `physical("/blog", "blog")`: a directory of route files mounted at a prefix. */
export interface PhysicalRouteNode {
  type: "physical"
  directory: string
  pathPrefix: string
}

/** Any node `rootRoute`, `layout` and `route` take as a child. */
export type RouteNode =
  | IndexRouteNode
  | LayoutRouteNode
  | PathRouteNode
  | PhysicalRouteNode

/** What `rootRoute` returns: the whole tree, which `routes.ts` exports. */
export interface RootRouteNode {
  type: "root"
  file: string
  children?: RouteNode[]
}

/**
 * Where adaptv's root route lives, **relative to `routesDirectory`**. It is a
 * module in the installed package (`root-route.tsx`), not a file written into
 * the app; consumers never write it.
 *
 * The generator resolves virtual route files against `routesDirectory`, so this
 * escapes upward out of the app's routes folder and into the package. That
 * keeps the consumer's routes tree free of framework files: they write route
 * files, adaptv ships the root, and the two never sit in the same folder.
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

/**
 * Declare the app's route tree. adaptv owns the root — pass only the children and
 * its root route is wired in for you:
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
export function rootRoute(children?: RouteNode[]): RootRouteNode
export function rootRoute(
  file: string,
  children?: RouteNode[],
): RootRouteNode
export function rootRoute(
  fileOrChildren?: string | RouteNode[],
  maybeChildren?: RouteNode[],
): RootRouteNode {
  if (typeof fileOrChildren === "string") {
    return upstreamRootRoute(fileOrChildren, maybeChildren)
  }
  return upstreamRootRoute(generatedRootFile(), fileOrChildren)
}

//The rest of the DSL behaves exactly as upstream's: adaptv has no opinion on
//non-root nodes (wrap-on-opinion). Each is declared here only so its signature
//names adaptv's node types.

/** The file that renders at its parent's path. */
export function index(file: string): IndexRouteNode {
  return upstreamIndex(file)
}

/** A pathless route that wraps `children`; `id` names it when two share a file. */
export function layout(
  file: string,
  children: RouteNode[],
): LayoutRouteNode
export function layout(
  id: string,
  file: string,
  children: RouteNode[],
): LayoutRouteNode
export function layout(
  idOrFile: string,
  fileOrChildren: string | RouteNode[],
  maybeChildren?: RouteNode[],
): LayoutRouteNode {
  return typeof fileOrChildren === "string"
    ? upstreamLayout(idOrFile, fileOrChildren, maybeChildren ?? [])
    : upstreamLayout(idOrFile, fileOrChildren)
}

/** A route at `path`, with a file, children, or both. */
export function route(path: string, children: RouteNode[]): PathRouteNode
export function route(path: string, file: string): PathRouteNode
export function route(
  path: string,
  file: string,
  children: RouteNode[],
): PathRouteNode
export function route(
  path: string,
  fileOrChildren: string | RouteNode[],
  maybeChildren?: RouteNode[],
): PathRouteNode {
  if (typeof fileOrChildren !== "string") {
    return upstreamRoute(path, fileOrChildren)
  }
  return maybeChildren
    ? upstreamRoute(path, fileOrChildren, maybeChildren)
    : upstreamRoute(path, fileOrChildren)
}

/** A directory of route files, mounted at `pathPrefix` (or at this level). */
export function physical(
  pathPrefix: string,
  directory: string,
): PhysicalRouteNode
export function physical(directory: string): PhysicalRouteNode
export function physical(
  pathPrefixOrDirectory: string,
  maybeDirectory?: string,
): PhysicalRouteNode {
  return maybeDirectory === undefined
    ? upstreamPhysical(pathPrefixOrDirectory)
    : upstreamPhysical(pathPrefixOrDirectory, maybeDirectory)
}

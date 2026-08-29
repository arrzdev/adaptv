/**
 * The route → chrome-tint map: one build-time table, read by three consumers.
 *
 * A route declares the colour it wants the browser's chrome to be
 * (`chromeTint: "#1e0033"`), and adaptv has to honour it **before the first
 * paint** — a cold launch straight onto `/settings` must never show the theme's
 * colour for a frame and then swap. So the value cannot be read off the route
 * object at runtime: by the time the router exists, the frame that mattered is
 * already on screen.
 *
 * Hence a table, computed at BUILD time by scanning the route files
 * (`src/vite/route-tints.ts`) and inlined into the pre-paint script. The
 * declared option is therefore never read as a value — it is read as **source**,
 * which is why the scanner refuses anything but a literal rather than guessing.
 * The option's type augmentation exists so the editor agrees; it is not a
 * runtime input.
 *
 * The same table is what the runtime uses on navigation, keyed by route id. One
 * table, so the colour painted before hydration and the colour maintained after
 * it cannot disagree.
 *
 * NO REACT, and no imports that reach it: the Vite plugin needs this at build
 * time, and a Node-side plugin must not pull in the hooks graph — the same rule
 * `theme-init-script.ts` is here for.
 */

/** One route's declared chrome tint. */
export type RouteTint = {
  /**
   * The route's id, exactly as it appears in `createFileRoute("…")` — pathless
   * layout segments and all. This is what a router match reports, so it is what
   * the runtime looks up by; no pattern matching involved after hydration.
   */
  id: string
  /**
   * The URL path the route renders at, with `$param` segments left in place.
   * Derived from the id (see {@link routeIdToPath}); the pre-paint script is the
   * only thing that has to match against it, because it runs before any router.
   */
  path: string
  /**
   * The colour, as written. **One colour, not a light/dark pair**: a route that
   * pins the chrome wants that chrome, and a route that wants to follow the
   * theme simply does not declare a tint and gets the app's theme colours. There
   * is deliberately no inheritance from a parent route either — the fallback is
   * always the global config colours, never whatever the layout above happened
   * to ask for.
   */
  tint: string
}

/** Segments that exist in the route id but not in the URL. */
const PATHLESS = /^_/
const GROUP = /^\(.*\)$/

/**
 * The URL path a route id renders at.
 *
 * TanStack's own rule, applied here so the table can be built from the route
 * files alone rather than from the generated tree — the generated tree is a text
 * artifact whose shape is not adaptv's to depend on, and it is regenerated on a
 * schedule this scan does not control.
 *
 *     /_providers/lab/chrome-tint  →  /lab/chrome-tint
 *     /_providers/                 →  /            (an index route)
 *     /(marketing)/pricing         →  /pricing
 *     /posts/$postId               →  /posts/$postId
 */
export function routeIdToPath(id: string): string {
  const segments = id
    .split("/")
    .filter(Boolean)
    .filter((s) => !PATHLESS.test(s) && !GROUP.test(s))
  return segments.length === 0 ? "/" : `/${segments.join("/")}`
}

/** Make a static path segment safe to drop into a `RegExp`. */
const escapeSegment = (segment: string) =>
  segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * A `RegExp` source matching the pathnames a route path renders at.
 *
 * `$name` is one segment, a bare `$` is the splat and takes the rest. A trailing
 * slash is optional, because `/settings` and `/settings/` are the same screen and
 * a cold launch can arrive as either.
 */
export function routePathToPattern(path: string): string {
  const segments = path.split("/").filter(Boolean)
  const body = segments
    .map((s) => {
      if (s === "$") return "(?:.*)"
      if (s.startsWith("$")) return "[^/]+"
      return escapeSegment(s)
    })
    .join("/")
  return body === "" ? "^/?$" : `^/${body}/?$`
}

/**
 * How many static segments a path has, and how many are wildcards — the two
 * numbers {@link sortRouteTints} orders by.
 */
function specificity(path: string): [number, number] {
  const segments = path.split("/").filter(Boolean)
  const wild = segments.filter((s) => s.startsWith("$")).length
  return [segments.length - wild, wild]
}

/**
 * Most specific first, so the pre-paint script can take the first pattern that
 * matches and stop. A static `/posts/new` must be tried before `/posts/$postId`
 * or the parameterised route would swallow it.
 */
export function sortRouteTints(tints: RouteTint[]): RouteTint[] {
  return [...tints].sort((a, b) => {
    const [aStatic, aWild] = specificity(a.path)
    const [bStatic, bWild] = specificity(b.path)
    return (
      bStatic - aStatic || aWild - bWild || b.path.length - a.path.length
    )
  })
}

/**
 * The tint a set of route matches asks for, or `null` for the app's theme.
 *
 * Only the LEAF match is consulted. A route that declares nothing falls back to
 * the global theme colours, not to whatever its parent layout declared — see
 * {@link RouteTint.tint}.
 */
export function tintForRouteId(
  tints: readonly RouteTint[],
  routeId: string | undefined,
): string | null {
  if (!routeId) return null
  return tints.find((t) => t.id === routeId)?.tint ?? null
}

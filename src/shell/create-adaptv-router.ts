import type { AnyRoute } from "@tanstack/react-router"
import { createRouter } from "@tanstack/react-router"
import type { RouterCore } from "@tanstack/router-core"
import { installUrlOpen } from "#adaptv/capabilities/url-open"
import { standaloneMemoryHistory } from "#adaptv/shell/standalone-history"

//adaptv's names for the router and the tree it routes. Interfaces over the engine's
//types, not aliases of them: TypeScript prints an alias by the type it aliases, so
//an alias would still show the engine's names in every hover and type error.
//→ docs/decisions/facade-and-opacity.md §1

/** Any generated route tree. */
export interface AdaptvRouteTree extends AnyRoute {}

/** The router `createAdaptvRouter` builds over `TRouteTree`. */
export interface AdaptvRouter<
  TRouteTree extends AdaptvRouteTree = AdaptvRouteTree,
> extends RouterCore<TRouteTree, "never", false> {}

export type AdaptvRouterOptions<
  TRouteTree extends AdaptvRouteTree = AdaptvRouteTree,
> = {
  /**
   * The generated route tree. The one genuinely app-specific input, and the ONLY
   * thing in this signature that is generic — deliberately.
   *
   * ⚠︎ This was `unknown`, which read as "adaptv does not care what shape it is".
   * What it actually did was pin the return type: with nothing to infer from, the
   * router came out as `RouterCore<AnyRoute, …>`, `Register` bound THAT, and every
   * `to:` in the consumer's app widened to `string` — no autocomplete, no
   * wrong-route error, and nothing to report because it is a widening, not a
   * failure. Typed routing is the entire reason a generated route tree exists, so
   * this parameter is load-bearing. → src/virtual-adaptv-root-route.d.ts
   */
  routeTree: TRouteTree
  /** Use in-memory history when installed/standalone. */
  memoryHistoryInStandalone?: boolean
  /** Everything else is forwarded to `createRouter`. */
  options?: Record<string, unknown>
}

/**
 * The element a navigation scrolls back to the top: the first vertical `ScrollView`
 * inside the screen frame, which is the page's own scroller.
 *
 * The document never scrolls in an adaptv app (styles/shell-layout.css): a page
 * scrolls inside a `ScrollView`. The route engine resets only `window` unless told
 * which elements to reset, so without this a link from one page to another left the
 * page scroller where it was, and the next page opened mid-way down. That was always
 * so between two pages of the same route (`/blog/a` → `/blog/b`), where the scroller
 * is the same element.
 *
 * `querySelector` returns the first match in document order, and an ancestor comes
 * before its descendants, so a page that is a `ScrollView` resets that one and leaves
 * a scroller nested in it (a sticky side nav) where the reader left it.
 */
export const PAGE_SCROLLER_SELECTOR =
  '[data-adaptv-screen] [data-scroll-view="y"]'

/**
 * Scroll restoration on in the browser, off on the server.
 *
 * Restoration is what brings back the position on back and forward. It is a function
 * rather than `true` for one reason: with `true`, the server renders the engine's
 * restore `<script>` beside the page's root element, inside the screen frame. The
 * frame stretches its ONLY child (styles/screen.css), so until that script ran, and
 * forever without JavaScript, the page did not fill the screen and its scroller could
 * not scroll. The script only restores a reload a frame earlier; the browser side
 * restores the same position from the same storage once the page has hydrated.
 */
const restoreScrollInBrowser = () => typeof document !== "undefined"

/**
 * Build the app router. **Framework code, not codegen.**
 *
 * The generated `router.gen.tsx` used to inline all of this into every app — the
 * `createRouter` call, the memory-history choice, the `notFoundMode` opinion —
 * even though the only app-specific input is the route tree and a bag of config
 * values. That is codegen used as a substitute for a function.
 *
 * Keeping it here means an opinion can be *changed* in the framework rather than
 * re-emitted into every consumer on their next build, and a consumer reading
 * their own `.adaptv/` sees a call, not a copy of adaptv's decisions.
 */
export function createAdaptvRouter<TRouteTree extends AdaptvRouteTree>({
  routeTree,
  memoryHistoryInStandalone,
  options = {},
}: AdaptvRouterOptions<TRouteTree>): AdaptvRouter<TRouteTree> {
  const router = createRouter({
    routeTree,
    //Memory history in standalone is opt-in: overriding router history is a real
    //behaviour change, so it must be asked for.
    ...(memoryHistoryInStandalone
      ? { history: standaloneMemoryHistory() }
      : {}),
    //adaptv owns not-found — `notFoundScreen` renders at the root — so root mode
    //is the framework's opinion. Still overridable via router config.
    ...(("notFoundMode" in options
      ? {}
      : { notFoundMode: "root" }) as object),
    //A navigation to a new page starts at the top of the page's scroller; back and
    //forward bring back where the reader was; a link with a hash scrolls to its
    //anchor. Both overridable via router config (`scrollRestoration`,
    //`scrollToTopSelectors`), and a single link keeps the position with
    //`resetScroll={false}`. → PAGE_SCROLLER_SELECTOR
    ...("scrollRestoration" in options
      ? {}
      : { scrollRestoration: restoreScrollInBrowser }),
    ...("scrollToTopSelectors" in options
      ? {}
      : { scrollToTopSelectors: [PAGE_SCROLLER_SELECTOR] }),
    ...options,
    //The option bag is config-shaped (a plain record from adaptv.config.ts), so
    //it cannot be statically matched against createRouter's deeply-generic
    //constructor type.
  } as never) as ReturnType<typeof createRouter<TRouteTree>>
  //⚠︎ The `as never` erases the ARGUMENT, so it erases inference along with it —
  //which is why the return type has to be restated rather than left to infer. It
  //used to be left to infer, and the comment above claimed "the route tree carries
  //the real typing, which is what `Register` binds". It did not: `createRouter` had
  //nothing to infer `TRouteTree` from and fell back to `AnyRoute`, so `Register`
  //bound a router over `AnyRoute` and typed routing was silently off. Restating it
  //re-attaches the tree the caller actually passed.

  //A link that opens the native app becomes a route. Here, as the router is built,
  //because the link that LAUNCHED the app is replayed only to the first listener —
  //anything attached later, from a component, would never see it. A no-op on the web
  //and on the server. → src/capabilities/url-open.ts
  installUrlOpen(router)
  return router
}

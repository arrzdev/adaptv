import type { AnyRoute } from "@tanstack/react-router"
import { createRouter } from "@tanstack/react-router"
import { installUrlOpen } from "#adaptv/capabilities/url-open"
import { standaloneMemoryHistory } from "#adaptv/shell/standalone-history"

export type AdaptvRouterOptions<TRouteTree extends AnyRoute = AnyRoute> = {
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
export function createAdaptvRouter<TRouteTree extends AnyRoute>({
  routeTree,
  memoryHistoryInStandalone,
  options = {},
}: AdaptvRouterOptions<TRouteTree>) {
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

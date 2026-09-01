/**
 * The router surface — adaptv's **curated** re-export of TanStack Router.
 * → `docs/design/architecture.md §3.1`, `docs/decisions/facade-and-opacity.md §1`
 *
 * ## Curated, never `export *`
 *
 * Every symbol here is present because someone decided it should be. A star
 * re-export would automatically forward tomorrow's unsafe API — which is exactly
 * the failure mode adaptv exists to prevent. The deleted pass-through barrel from
 * chopchop stays deleted.
 *
 * What is deliberately **absent**:
 * - Anything from `@tanstack/react-start` — server functions, middleware, the
 *   server-only request/response helpers. They need a server, and a Capacitor
 *   build has none (L3). The build also refuses them outright; see
 *   `src/vite/ban-server-apis.ts`.
 * - `createRootRoute` — adaptv owns the root route and generates it from
 *   `adaptv.config.ts`. Importing TanStack's would silently bypass the shell, the
 *   splash policy, the head, and the service-worker registration.
 * - `Link` — adaptv ships its own, which routes external URLs to the system
 *   browser and carries the tap-safe gesture behaviour. Exported from
 *   `@arrzdev/adaptv/components`.
 */

//Routing primitives the consumer writes by hand.
export {
  //the generated route tree augments these ON THIS MODULE (the generator is
  //patched to emit adaptv's specifier), so they must be re-exported here or the
  //augmentation has nothing to attach to
  type CreateFileRoute,
  createFileRoute,
  //`createRouter` is here for the GENERATED router entry, not for app code —
  //adaptv builds the router from adaptv.config.ts. Exported so `.adaptv/router.gen.tsx`
  //has a adaptv-shaped import rather than a @tanstack one.
  createRouter,
  type FileRoutesByPath,
  isRedirect,
  //types the consumer annotates with
  type NavigateOptions,
  //error / not-found signalling
  notFound,
  //navigation + matching
  Outlet,
  type ParsedLocation,
  type Register,
  type RegisteredRouter,
  redirect,
  type ToOptions,
  useCanGoBack,
  useLoaderData,
  useLocation,
  useMatch,
  useMatches,
  useNavigate,
  useParams,
  useRouter,
  useRouterState,
  useSearch,
} from "@tanstack/react-router"
//The extension point every route option that is not TanStack's own is declared
//THROUGH — it is how `component` gets onto a route in the first place. adaptv
//adds `chromeTint` to it (`interface/route-globals.d.ts`), and an app can add its
//own; both augment it ON THIS MODULE, so it has to be re-exported here or the
//augmentation has nothing to attach to. Same mechanism as the generated route
//tree's `FileRoutesByPath` above.
//
//Reached through `router-core` rather than `react-router` because that is the
//package that DECLARES it — react-router only augments it. adaptv depends on
//router-core at the exact version react-router resolves, so there is one
//interface, not two.
export type { UpdatableRouteOptionsExtensions } from "@tanstack/router-core"
//The virtual-route DSL, with adaptv's opinionated `rootRoute` (the app declares
//children only; adaptv wires its generated root in).
export {
  index,
  layout,
  physical,
  rootRoute,
  route,
} from "#adaptv/routes/adaptv-routes"
//The generated route tree's footer binds `Register` to `ReturnType<typeof getRouter>`,
//so it needs a module path exporting `getRouter`. Upstream writes a RELATIVE path to
//whatever file resolved as `router.entry` — which, for adaptv's own entry, is a path
//into the framework's install directory (`../../../node_modules/.pnpm/@arrzdev+adaptv@…`
//under pnpm, since the specifier is computed from a realpath). That is machine-shaped,
//install-layout-shaped, and gone entirely under Yarn PnP or a dist-only publish. So
//adaptv rewrites the footer to point here instead — one stable specifier, the same one
//the `declare module` beside it already uses. → src/vite/route-tree-opacity.ts
//
//TYPE-ONLY, and that is load-bearing: `getRouter` reaches the app's route tree through
//`#adaptv-route-tree`, so a value re-export would put the whole route graph behind every
//`createFileRoute` import in the app — a runtime cycle for a binding nobody calls.
//`export type` erases completely, and `typeof getRouter` still resolves through it.
export type { getRouter } from "#adaptv/routes/router-entry"
//the router factory the generated entry calls — framework code, not codegen
export { createAdaptvRouter } from "#adaptv/shell/create-adaptv-router"
//adaptv's own root route — NOT TanStack's. Generated from adaptv.config.ts.
export { createRootRoute } from "#adaptv/shell/create-root-route"
//used by the generated router entry when `memoryHistoryInStandalone` is on
export { standaloneMemoryHistory } from "#adaptv/shell/standalone-history"

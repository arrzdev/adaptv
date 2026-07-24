/**
 * The router surface — adaptv's **curated** re-export of TanStack Router.
 * → `ARCHITECTURE.md §3.1`, `FACADE.md §1`
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
//The virtual-route DSL, with adaptv's opinionated `rootRoute` (the app declares
//children only; adaptv wires its generated root in).
export {
  index,
  layout,
  physical,
  rootRoute,
  route,
} from "#adaptv/routes/adaptv-routes"
//the router factory the generated entry calls — framework code, not codegen
export { createAdaptvRouter } from "#adaptv/shell/create-adaptv-router"
//adaptv's own root route — NOT TanStack's. Generated from adaptv.config.ts.
export { createRootRoute } from "#adaptv/shell/create-root-route"
//used by the generated router entry when `memoryHistoryInStandalone` is on
export { standaloneMemoryHistory } from "#adaptv/shell/standalone-history"

/**
 * The router surface — nativ's **curated** re-export of TanStack Router.
 * → `ARCHITECTURE.md §3.1`, `FACADE.md §1`
 *
 * ## Curated, never `export *`
 *
 * Every symbol here is present because someone decided it should be. A star
 * re-export would automatically forward tomorrow's unsafe API — which is exactly
 * the failure mode nativ exists to prevent. The deleted pass-through barrel from
 * chopchop stays deleted.
 *
 * What is deliberately **absent**:
 * - Anything from `@tanstack/react-start` — server functions, middleware, the
 *   server-only request/response helpers. They need a server, and a Capacitor
 *   build has none (L3). The build also refuses them outright; see
 *   `src/vite/ban-server-apis.ts`.
 * - `createRootRoute` — nativ owns the root route and generates it from
 *   `nativ.config.ts`. Importing TanStack's would silently bypass the shell, the
 *   splash policy, the head, and the service-worker registration.
 * - `Link` — nativ ships its own, which routes external URLs to the system
 *   browser and carries the tap-safe gesture behaviour. Exported from
 *   `@arrzdev/nativ/components`.
 */

//Routing primitives the consumer writes by hand.
export {
  //the generated route tree augments these ON THIS MODULE (the generator is
  //patched to emit nativ's specifier), so they must be re-exported here or the
  //augmentation has nothing to attach to
  type CreateFileRoute,
  createFileRoute,
  //`createRouter` is here for the GENERATED router entry, not for app code —
  //nativ builds the router from nativ.config.ts. Exported so `.nativ/router.gen.tsx`
  //has a nativ-shaped import rather than a @tanstack one.
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
//The virtual-route DSL, with nativ's opinionated `rootRoute` (the app declares
//children only; nativ wires its generated root in).
export {
  index,
  layout,
  physical,
  rootRoute,
  route,
} from "#nativ/routes/nativ-routes"
//the router factory the generated entry calls — framework code, not codegen
export { createNativRouter } from "#nativ/shell/create-nativ-router"
//nativ's own root route — NOT TanStack's. Generated from nativ.config.ts.
export { createRootRoute } from "#nativ/shell/create-root-route"
//used by the generated router entry when `memoryHistoryInStandalone` is on
export { standaloneMemoryHistory } from "#nativ/shell/standalone-history"

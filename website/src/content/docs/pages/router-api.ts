import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "router-api",
  title: "Router API",
  summary:
    "What @arrzdev/adaptv/router and @arrzdev/adaptv/routes export: route files, loaders, navigation hooks and the route config helpers.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { createFileRoute, notFound, useNavigate } from "@arrzdev/adaptv/router"',
  source: "src/interface/router.index.ts",
  blocks: [
    {
      type: "p",
      text: 'Read [Routing](/docs/routing) first. `@arrzdev/adaptv/routes` holds the route config helpers only: use it in `src/routing/config.ts`, which runs in Node at build time. `@arrzdev/adaptv/router` re-exports them with the rest. `@arrzdev/adaptv/server-entry` is the server entry for `render: "ssr"`.',
    },
    {
      type: "note",
      text: "Not exported: server functions and request helpers (a native app has no server), `Link` (use [Link](/docs/link)), and `createLazyFileRoute` (lazy routes are not supported).",
    },
    { type: "h2", text: "Route config" },
    {
      type: "p",
      text: "Paths are relative to `src/routing`.",
    },
    {
      type: "api",
      name: "rootRoute()",
      signature: `function rootRoute(children?: RouteNode[]): RootRouteNode
function rootRoute(file: string, children?: RouteNode[]): RootRouteNode`,
      description:
        "Declares the route tree. Pass children only: adaptv supplies the root route. With a file first, you own the root route, and that file exports a `Route` made with `createRootRoute`.",
    },
    {
      type: "api",
      name: "index()",
      signature: "function index(file: string): IndexRouteNode",
      description: "The page at the parent's path. At the top level, `/`.",
    },
    {
      type: "api",
      name: "route()",
      signature: `function route(path: string, file: string): PathRouteNode
function route(path: string, file: string, children: RouteNode[]): PathRouteNode
function route(path: string, children: RouteNode[]): PathRouteNode`,
      description:
        "A route at `path`. `$name` makes a param. With a file and children, the file renders `<Outlet />`. With children only, `path` is a prefix and nothing renders for it.",
    },
    {
      type: "api",
      name: "layout()",
      signature: `function layout(file: string, children: RouteNode[]): LayoutRouteNode
function layout(id: string, file: string, children: RouteNode[]): LayoutRouteNode`,
      description:
        'A wrapper that adds nothing to the URL. Its route id is `id` with a leading underscore: `layout("providers", …)` is `/_providers`. Give an `id` when two layouts share a file.',
    },
    {
      type: "api",
      name: "physical()",
      signature: `function physical(directory: string): PhysicalRouteNode
function physical(pathPrefix: string, directory: string): PhysicalRouteNode`,
      description:
        "Mounts a directory of file-named routes at `pathPrefix`, or at the current level.",
    },
    { type: "h2", text: "Route files" },
    {
      type: "api",
      name: "createFileRoute()",
      signature: "function createFileRoute(id)(options)",
      description:
        "Makes the route for one file. `id` is the route id: the path, or `/_layout/path` inside a layout. It types `params`, `search` and the `Route.use*` hooks. The file needs no import: adaptv writes it.",
      params: [
        {
          name: "component",
          type: "ComponentType",
          description: "What the route renders.",
        },
        {
          name: "loader",
          type: "(ctx: { params, … }) => data | Promise<data>",
          description:
            'Loads data before render. Under `render: "ssr"` it runs on the server for the first request, then in the browser. In a native app it runs on the device.',
        },
        {
          name: "beforeLoad",
          type: "(ctx) => context | void",
          description:
            "Runs before the loader, parent first. Throw `redirect()` to guard a route. Its return value reaches the loader as `context`.",
        },
        {
          name: "head",
          type: "(ctx: { loaderData, params }) => { meta?, links?, scripts? }",
          description:
            "Head tags for this route. `meta: [{ title }]` sets the title.",
        },
        {
          name: "validateSearch",
          type: "(search: Record<string, unknown>) => Search",
          description: "Parses the query string. Types `Route.useSearch()`.",
        },
        {
          name: "pendingComponent, errorComponent, notFoundComponent",
          type: "ComponentType",
          description:
            "Per-route states. adaptv adds no error boundary of its own.",
        },
        {
          name: "chromeTint",
          type: "string",
          description:
            "The browser chrome colour. Write a string inline, or a top-level `const` in the same file. Any other value is a build error. See [Theming](/docs/theming).",
        },
      ],
      returns:
        "The route. Export it as `Route`. Its hooks are typed to the route: `Route.useLoaderData()`, `useParams()`, `useSearch()`, `useRouteContext()`, `useNavigate()`.",
    },
    {
      type: "note",
      tone: "warn",
      text: "The build refuses a `server: { handlers }` key. Use your own API, or a `loader`.",
    },
    { type: "h2", text: "Signals" },
    {
      type: "api",
      name: "notFound()",
      signature:
        "function notFound(options?: NotFoundOptions): NotFoundOptions",
      description:
        "Throw it from a `loader` or `beforeLoad` when the URL names nothing. The app shows your `notFoundScreen`. `options.data` reaches it as a prop.",
    },
    {
      type: "api",
      name: "redirect()",
      signature:
        "function redirect(options: { to, params?, search?, replace? })",
      description: "Throw it to send the navigation elsewhere. Checks `to`.",
    },
    {
      type: "api",
      name: "isRedirect()",
      signature: "function isRedirect(value: unknown): value is RouteRedirect",
      description:
        "True for a thrown redirect. Use it in a `catch` to rethrow.",
    },
    {
      type: "api",
      name: "Outlet",
      signature: "function Outlet(): ReactNode",
      description: "Renders the matched child route. Every layout needs one.",
    },
    { type: "h2", text: "Hooks" },
    {
      type: "table",
      head: ["Hook", "Returns"],
      rows: [
        [
          "`useNavigate()`",
          "`navigate({ to, params?, search?, replace? })`. Checks `to`.",
        ],
        [
          "`useRouter()`",
          "The router: `navigate`, `history.back()`, `invalidate()` (re-runs loaders), `preloadRoute()`.",
        ],
        [
          "`useRouterState({ select? })`",
          "`location`, `status` and `matches`. `select` limits re-renders.",
        ],
        ["`useLocation()`", "`pathname`, `search`, `hash`, `href`."],
        ["`useParams({ from })`", "The path params."],
        ["`useSearch({ from })`", "The validated query string."],
        [
          "`useLoaderData({ from })`",
          "One route's loader data. In the route's own file, use `Route.useLoaderData()`.",
        ],
        [
          "`useMatch({ from, shouldThrow? })`",
          "One route's match. With `shouldThrow: false`, `undefined` when inactive.",
        ],
        ["`useMatches()`", "Every active match, root first."],
        [
          "`useCanGoBack()`",
          "`true` when an earlier in-app history entry exists.",
        ],
      ],
    },
    { type: "h2", text: "Router options" },
    {
      type: "p",
      text: "adaptv builds the router from the route tree and the `router` block of [adaptv.config.ts](/docs/config). It passes every key that is not a build path to the router. Only plain values survive. A function or component is dropped without a warning.",
    },
    { type: "h2", text: "Eject" },
    {
      type: "p",
      text: "Most apps never use these. They serve an ejected `src/router.tsx` or root route file.",
    },
    {
      type: "api",
      name: "createAdaptvRouter()",
      signature: `function createAdaptvRouter<TRouteTree extends AdaptvRouteTree>(options: {
  routeTree: TRouteTree
  memoryHistoryInStandalone?: boolean
  options?: Record<string, unknown>
}): AdaptvRouter<TRouteTree>`,
      description:
        'Builds the router as adaptv does. It sets `notFoundMode: "root"` and uses in-memory history when installed and `memoryHistoryInStandalone` is on. `options` overrides both, and `options.history` overrides the history. It also turns native deep links into navigations. A router built another way loses them. Call it from `getRouter()` in `src/router.tsx`.',
    },
    {
      type: "api",
      name: "standaloneMemoryHistory()",
      signature:
        "function standaloneMemoryHistory(): AdaptvHistory | undefined",
      description:
        "In-memory history when the app is installed (PWA or native). It starts at the current path and query. The hash is dropped. In a browser tab it returns `undefined`.",
    },
    {
      type: "api",
      name: "createRootRoute()",
      signature:
        "function createRootRoute(config: CreateRootRouteConfig): AdaptvRootRoute",
      description:
        "The root route for an ejected root file. It does not read `adaptv.config.ts`: you keep the values in step. Required: `title`, `themeColorLight`, `themeColorDark`. Also takes `description`, `lang`, `allowZoom`, `openGraph`, `twitter`, `meta`, `links`, `manifestPath`, `headScripts`, `stylesEntryPoint`, `htmlClassName`, `htmlAttrs`, `shellClassName`, `defaultThemePreference`, `notFoundHomeTo`, `splashScreenInBrowser`, `updateRequiredAfterDays`, `patches`, `ui`, and the screens `splashScreenComponent`, `orientationGuardComponent`, `notFoundComponent`, `offlineComponent`, `updateRequiredComponent` and `RootDocument`.",
    },
    {
      type: "api",
      name: "createRouter",
      signature: "createRouter(options)",
      description:
        "The low-level constructor, exported for generated code. Use `createAdaptvRouter`.",
    },
  ],
}

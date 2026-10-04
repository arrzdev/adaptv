import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "router-api",
  title: "Router API",
  summary:
    "Everything @arrzdev/adaptv/router and @arrzdev/adaptv/routes export: route files, loaders, navigation hooks and the route config helpers.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { createFileRoute, notFound, useNavigate } from "@arrzdev/adaptv/router"',
  source: "src/interface/router.index.ts",
  blocks: [
    {
      type: "p",
      text: "Routing in adaptv is TanStack Router, re-exported through a curated barrel. Every symbol on this page is there because someone decided it should be, and the behaviour of each is the engine's own. This page lists what is exported, the signatures, and the places adaptv differs. For the task-shaped version, read [Routing](/docs/routing).",
    },
    {
      type: "table",
      head: ["Import path", "Holds"],
      rows: [
        [
          "`@arrzdev/adaptv/router`",
          "Route files, hooks, navigation types. Also re-exports the route config helpers.",
        ],
        [
          "`@arrzdev/adaptv/routes`",
          "The route config helpers alone: `rootRoute`, `index`, `route`, `layout`, `physical`. Use this one in `src/routing/config.ts`, which runs in Node at build time and should not pull in the React router.",
        ],
        [
          "`@arrzdev/adaptv/route-globals`",
          "Ambient types: the global `createFileRoute` and the `chromeTint` route option. Added to your tsconfig by the [Vite plugin](/docs/vite-plugin).",
        ],
        [
          "`@arrzdev/adaptv/root-route`",
          "The root route module the route generator resolves. Framework plumbing, not for app code.",
        ],
      ],
    },
    { type: "h2", text: "What is deliberately absent" },
    {
      type: "ul",
      items: [
        "**Server functions, middleware and server-only request helpers.** They need a server and the native build has none. The build refuses them, see the [Vite plugin](/docs/vite-plugin).",
        "**`Link`.** adaptv ships its own, which sends external URLs to the system browser and carries the tap-safe press behaviour. Import it from `@arrzdev/adaptv/components`, see [Link](/docs/link).",
        "**The engine's own `createRootRoute`.** adaptv owns the root route and builds it from `adaptv.config.ts`. The `createRootRoute` this barrel exports is adaptv's, and takes a different argument.",
        "Anything else the engine exports that is not listed below. Import it from the engine directly at your own risk: that import is not covered by adaptv's guarantees about the six targets.",
      ],
    },
    { type: "h2", text: "Route config" },
    {
      type: "p",
      text: "Routes are declared in one file, `src/routing/config.ts` by default (`router.routerConfig` in the [config](/docs/config)). File paths in it are relative to the routes directory, `src/routing` by default. The file names are yours: the playground uses `*.page.tsx` and `*.layout.tsx`.",
    },
    {
      type: "code",
      label: "src/routing/config.ts",
      lang: "ts",
      code: `import { index, layout, rootRoute, route } from "@arrzdev/adaptv/routes"

export const routes = rootRoute([
  layout("providers", "layouts/providers.layout.tsx", [
    index("pages/home.page.tsx"),
    route("/settings", "pages/settings.page.tsx"),
    route("/docs/$slug", "pages/docs/doc.page.tsx"),
  ]),
])

export default routes`,
    },
    {
      type: "api",
      name: "rootRoute()",
      signature: `function rootRoute(children?: VirtualRouteNode[]): VirtualRootRoute
function rootRoute(file: string, children?: VirtualRouteNode[]): VirtualRootRoute`,
      description:
        "Declares the route tree. Pass only the children: adaptv wires in its own root route, which renders the document, the head, the theme script, your splash, the orientation guard, the not-found screen and the service-worker registration. Passing a file as the first argument ejects the root: that file is then yours, and should export a `Route` built with adaptv's `createRootRoute`. It throws when evaluated outside the Vite plugin.",
      params: [
        {
          name: "children",
          type: "VirtualRouteNode[]",
          description: "The top-level routes and layouts.",
        },
        {
          name: "file",
          type: "string",
          description:
            'Eject only. The root route file, relative to the routes directory, for example `"layouts/_root.tsx"`.',
        },
      ],
    },
    {
      type: "api",
      name: "index()",
      signature: "function index(file: string): IndexRoute",
      description:
        "The route shown at its parent's own path: `/` at the top level, or the bare path of the `route` it sits inside.",
    },
    {
      type: "api",
      name: "route()",
      signature: `function route(path: string, file: string): Route
function route(path: string, file: string, children: VirtualRouteNode[]): Route
function route(path: string, children: VirtualRouteNode[]): Route`,
      description:
        "A route at `path`. A `$name` segment is a param. With `children`, the file is a parent that must render `<Outlet />`, and the children's paths nest under it. Without a file it is a path prefix with no component. Declaring `/lab` and `/lab/list` as two flat routes keeps `/lab` a real page with no outlet.",
    },
    {
      type: "api",
      name: "layout()",
      signature: `function layout(file: string, children: VirtualRouteNode[]): LayoutRoute
function layout(id: string, file: string, children: VirtualRouteNode[]): LayoutRoute`,
      description:
        "A pathless wrapper: the file renders around its children through `<Outlet />` and adds nothing to the URL. This is where an app-wide provider tree goes, since there is no `providers` key in the config. Give it an `id` when two layouts would otherwise derive the same one.",
    },
    {
      type: "api",
      name: "physical()",
      signature: `function physical(directory: string): PhysicalSubtree
function physical(pathPrefix: string, directory: string): PhysicalSubtree`,
      description:
        "Mounts a directory of route files that follow the engine's file-based naming convention, at `pathPrefix` or at the current level. Useful for a large section you would sooner not list route by route.",
    },
    { type: "h2", text: "Route files" },
    {
      type: "p",
      text: "A route file exports `Route`. You can write it with no import at all: `createFileRoute` is declared globally for the type checker, and the route generator writes the `@arrzdev/adaptv/router` import into the file on its next pass. Importing it yourself is fine too.",
    },
    {
      type: "code",
      label: "src/routing/pages/docs/doc.page.tsx",
      lang: "tsx",
      code: `import { createFileRoute, notFound } from "@arrzdev/adaptv/router"

export const Route = createFileRoute("/docs/$slug")({
  loader: ({ params }) => {
    const page = findPage(params.slug)
    if (!page) throw notFound()
    return { title: page.title, body: page.body }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.title ?? "Docs" }],
  }),
  component: DocPage,
})

function DocPage() {
  const { title, body } = Route.useLoaderData()
  return <Article title={title} body={body} />
}`,
    },
    {
      type: "api",
      name: "createFileRoute()",
      signature: "function createFileRoute(path)(options): Route",
      description:
        "Creates the route for a file. `path` must match the path the route config gives this file: the generator keeps it in sync, and it is what types `params`, `search` and the `Route.use*` hooks. The options are the engine's. The ones most apps use are below.",
      params: [
        {
          name: "component",
          type: "ComponentType",
          description: "What the route renders.",
        },
        {
          name: "loader",
          type: "(ctx: { params, location, abortController, ... }) => data | Promise<data>",
          description:
            'Loads the route\'s data before it renders. It is isomorphic: under `render: "ssr"` it runs on the server for the first request and on the client for every navigation after it, and in a native app it only ever runs on the device. So fetch over the network and touch nothing that exists on one side only. Throw `notFound()` or `redirect()` from it.',
        },
        {
          name: "beforeLoad",
          type: "(ctx) => context | void",
          description:
            "Runs before the loader, parent first. The place for an auth check that throws `redirect()`.",
        },
        {
          name: "head",
          type: "(ctx: { loaderData, params, ... }) => { meta?, links?, scripts? }",
          description:
            "Per-route head tags, merged over the head adaptv builds from the config. `meta: [{ title }]` sets the document title.",
        },
        {
          name: "validateSearch",
          type: "(search: Record<string, unknown>) => Search",
          description:
            "Parses and types the query string for `Route.useSearch()`.",
        },
        {
          name: "pendingComponent, errorComponent, notFoundComponent",
          type: "ComponentType",
          description:
            "Per-route states. adaptv installs no error boundary of its own, so a route that throws is caught by your `errorComponent`, or by whatever boundary you put around it.",
        },
        {
          name: "chromeTint",
          type: "string",
          description:
            "adaptv's own option: the colour the browser chrome takes on this route (the toolbar above a mobile web page, the bands around an installed app). It must be a literal string, written inline or held by a top-level `const` in the same file, because adaptv reads it from the source at build time to paint it on the first frame of a cold launch. A computed value is a build error. One colour for both themes. A route that declares nothing gets `themeColor`, never a parent's tint. See [Theming](/docs/theming).",
        },
      ],
      returns:
        "The route object. Export it as `Route`. Its bound hooks are typed to this route: `Route.useLoaderData()`, `Route.useParams()`, `Route.useSearch()`, `Route.useRouteContext()`, `Route.useNavigate()`.",
    },
    {
      type: "note",
      tone: "warn",
      text: "A `server: { handlers }` key on these options is refused by the build. A native app has no server to run it on. Move the handler to your API, or use a `loader`.",
    },
    { type: "h2", text: "Signalling from a loader" },
    {
      type: "api",
      name: "notFound()",
      signature:
        "function notFound(options?: { data?: unknown; routeId?: string }): NotFoundError",
      description:
        'Throw it from a `loader` or `beforeLoad` when the thing the URL names does not exist. adaptv sets `notFoundMode: "root"`, so it renders the `notFoundScreen` from your config at the root, full screen, unless you override `notFoundMode` in the `router` block.',
    },
    {
      type: "api",
      name: "redirect()",
      signature:
        "function redirect(options: { to, params?, search?, replace?, ... }): Redirect",
      description:
        "Throw it from a `loader` or `beforeLoad` to send the navigation somewhere else.",
    },
    {
      type: "api",
      name: "isRedirect()",
      signature: "function isRedirect(value: unknown): value is Redirect",
      description:
        "Tells a thrown redirect from a real error inside your own `try`/`catch`, so you can rethrow it.",
    },
    { type: "h2", text: "Rendering children" },
    {
      type: "api",
      name: "Outlet",
      signature: "function Outlet(): ReactNode",
      description:
        "Renders the matched child route. Every `layout` file and every `route` with children needs one.",
    },
    {
      type: "code",
      label: "src/routing/layouts/providers.layout.tsx",
      lang: "tsx",
      code: `import { createFileRoute, Outlet } from "@arrzdev/adaptv/router"

export const Route = createFileRoute("/_providers")({
  component: () => (
    <QueryProvider>
      <Outlet />
    </QueryProvider>
  ),
})`,
    },
    { type: "h2", text: "Hooks" },
    {
      type: "table",
      head: ["Hook", "Returns"],
      rows: [
        [
          "`useNavigate()`",
          "`navigate({ to, params?, search?, replace? })`. `to` is checked against your route tree.",
        ],
        [
          "`useRouter()`",
          "The router: `router.navigate`, `router.history.back()`, `router.invalidate()` to re-run loaders, `router.preloadRoute()`.",
        ],
        [
          "`useRouterState({ select? })`",
          "Router state (`location`, `status`, `matches`), narrowed by `select` so the component re-renders only on what it reads.",
        ],
        [
          "`useLocation()`",
          "The current `ParsedLocation`: `pathname`, `search`, `hash`, `href`.",
        ],
        ["`useParams({ from | strict: false })`", "Path params."],
        [
          "`useSearch({ from | strict: false })`",
          "The validated query string.",
        ],
        [
          "`useLoaderData({ from })`",
          "A route's loader data. Inside the route's own file, prefer `Route.useLoaderData()`.",
        ],
        [
          "`useMatch({ from, shouldThrow? })`",
          "One route's match, or `undefined` with `shouldThrow: false`.",
        ],
        [
          "`useMatches()`",
          "Every active match, root first. Useful for breadcrumbs.",
        ],
        [
          "`useCanGoBack()`",
          "`true` when there is an in-app history entry to go back to. Use it to decide between a back arrow and a home button, which matters in an installed app with no browser back button.",
        ],
      ],
    },
    {
      type: "code",
      label: "back-button.tsx",
      lang: "tsx",
      code: `import { Pressable } from "@arrzdev/adaptv/components"
import { useCanGoBack, useNavigate, useRouter } from "@arrzdev/adaptv/router"

function BackButton() {
  const router = useRouter()
  const navigate = useNavigate()
  const canGoBack = useCanGoBack()
  return (
    <Pressable
      onPress={() => (canGoBack ? router.history.back() : navigate({ to: "/" }))}
    >
      Back
    </Pressable>
  )
}`,
    },
    {
      type: "p",
      text: "For the Android hardware back button and the back chain of overlays, see [Lifecycle hooks](/docs/hooks-lifecycle).",
    },
    { type: "h2", text: "Types" },
    {
      type: "table",
      head: ["Type", "Use"],
      rows: [
        [
          "`NavigateOptions`",
          "The argument of `navigate()`. Annotate a helper that forwards to it.",
        ],
        [
          "`ToOptions`",
          "The `to`, `params`, `search` part alone. Annotate a prop that holds a destination.",
        ],
        ["`ParsedLocation`", "What `useLocation()` returns."],
        [
          "`RegisteredRouter`",
          "The type of your app's router, with its route tree.",
        ],
        [
          "`Register`, `FileRoutesByPath`, `CreateFileRoute`",
          "Interfaces the generated route tree augments on this module. They are exported so that augmentation has something to attach to.",
        ],
        [
          "`UpdatableRouteOptionsExtensions`",
          "The interface to augment, on `@arrzdev/adaptv/router`, when you want to add your own typed route option. adaptv adds `chromeTint` the same way.",
        ],
        [
          "`getRouter`",
          "Type-only. The generated route tree binds `Register` to its return type.",
        ],
      ],
    },
    { type: "h2", text: "Router options" },
    {
      type: "p",
      text: "You do not construct the router. adaptv builds it from the route tree and the `router` block of [adaptv.config.ts](/docs/config): every key there that is not a build path is forwarded to the router.",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `router: {
  memoryHistoryInStandalone: true,
  defaultPreload: "intent",
  defaultPreloadStaleTime: Number.POSITIVE_INFINITY,
}`,
    },
    { type: "h2", text: "Framework plumbing" },
    {
      type: "p",
      text: "These are exported for adaptv's own generated entry and for apps that eject it. App code does not normally call them.",
    },
    {
      type: "api",
      name: "createAdaptvRouter()",
      signature: `function createAdaptvRouter<TRouteTree>(options: {
  routeTree: TRouteTree
  memoryHistoryInStandalone?: boolean
  options?: Record<string, unknown>
}): Router<TRouteTree>`,
      description:
        'Builds the app router the way adaptv does: `notFoundMode: "root"` unless `options` sets it, and in-memory history when installed if `memoryHistoryInStandalone` is on. Call it from an ejected `src/router.tsx`, inside an exported `getRouter()`.',
    },
    {
      type: "api",
      name: "standaloneMemoryHistory()",
      signature:
        "function standaloneMemoryHistory(): RouterHistory | undefined",
      description:
        "In-memory history seeded with the current URL when the app is installed (home-screen PWA or native), and `undefined` in a browser tab, which leaves the default browser history in place. With memory history the OS edge-swipe-back has no entry to navigate, so going back stays under the app's control.",
    },
    {
      type: "api",
      name: "createRootRoute()",
      signature:
        "function createRootRoute(config: CreateRootRouteConfig): RootRoute",
      description:
        "adaptv's root route factory, for an ejected root file. It takes the head config (`title`, `description`, `themeColorLight`, `themeColorDark`, `lang`, `allowZoom`, `openGraph`, `twitter`, `stylesEntryPoint`) and the shell components (`splashScreenComponent`, `orientationGuardComponent`, `notFoundComponent`, `offlineComponent`, `updateRequiredComponent`, `RootDocument`), plus `patches` and `ui`. It does not read `adaptv.config.ts`: once you eject the root, keeping those values in step with the config is on you.",
    },
    {
      type: "api",
      name: "createRouter",
      signature: "createRouter(options)",
      description:
        "The engine's constructor, exported so generated code has an adaptv-shaped import. Prefer `createAdaptvRouter`.",
    },
  ],
}

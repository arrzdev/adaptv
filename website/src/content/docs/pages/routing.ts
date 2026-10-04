import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "routing",
  title: "Routing",
  summary:
    "Declare the route tree in one config file, write one file per page, and let adaptv own the root route, the router and the generated types.",
  blocks: [
    {
      type: "p",
      text: "Routes are declared in code, in `src/routing/config.ts`, with helpers from `@arrzdev/adaptv/routes`. Each entry points at a page file that exports a `Route` built with `createFileRoute` from `@arrzdev/adaptv/router`. adaptv generates the typed route tree into a git-ignored `.adaptv/` directory, builds the router from `adaptv.config.ts`, and owns the root route, which is where the document, the [frame](/docs/the-frame), the splash and the not-found screen live. Your app has no `router.tsx`, no client entry and no root route file.",
    },
    {
      type: "p",
      text: "The engine underneath is TanStack Router. You never import it: everything you need is re-exported from `@arrzdev/adaptv/router`, and the list is curated on purpose. The symbols are in the [router API](/docs/router-api) reference.",
    },
    { type: "h2", text: "Declare the routes" },
    {
      type: "code",
      label: "src/routing/config.ts",
      lang: "ts",
      code: `import { index, rootRoute, route } from "@arrzdev/adaptv/routes"

// adaptv owns the root route. Declare only the children.
export const routes = rootRoute([
  index("pages/home.page.tsx"),
  route("/docs", "pages/docs.page.tsx"),
  route("/docs/$slug", "pages/docs/doc.page.tsx"),
  route("/blog", "pages/blog.page.tsx"),
  route("/blog/$slug", "pages/blog/post.page.tsx"),
])

export default routes`,
    },
    {
      type: "p",
      text: "File paths are relative to the routes directory, which defaults to `src/routing`. The file names are yours. The repository's apps use `*.page.tsx` for pages and `*.layout.tsx` for layouts, and nothing depends on it. Adding a route to this file reaches a running dev server without a restart.",
    },
    {
      type: "props",
      rows: [
        {
          name: "rootRoute(children)",
          type: "(children?: RouteNode[]) => RootRoute",
          description:
            'The route tree. adaptv wires its own generated root in. Passing a file first, `rootRoute("layouts/_root.tsx", [...])`, ejects: you then own the root route file and everything the shell did for you.',
        },
        {
          name: "index(file)",
          type: "(file: string) => RouteNode",
          description:
            "The page at the parent's own path. At the top level, `/`.",
        },
        {
          name: "route(path, file?, children?)",
          type: "(path: string, file: string, children?: RouteNode[]) => RouteNode",
          description:
            "A page at `path`. A `$name` segment is a param. With `children`, the file is a parent route that renders `<Outlet />`. `route(path, children)` with no file groups children under a path prefix.",
        },
        {
          name: "layout(id?, file, children)",
          type: "(id: string, file: string, children: RouteNode[]) => RouteNode",
          description:
            "A pathless layout: it wraps its children and adds nothing to the URL. The optional `id` names it; the route's id is the name with a leading underscore.",
        },
        {
          name: "physical(pathPrefix?, directory)",
          type: "(pathPrefix: string, directory: string) => RouteNode",
          description:
            "Mounts a directory of file-named routes at a prefix. adaptv passes this through unchanged from the engine and none of the repository's apps use it.",
        },
      ],
    },
    { type: "h2", text: "A page file" },
    {
      type: "code",
      label: "src/routing/pages/docs.page.tsx",
      lang: "tsx",
      code: `import { ScrollView } from "@arrzdev/adaptv/components"
import { createFileRoute } from "@arrzdev/adaptv/router"

export const Route = createFileRoute("/docs")({
  component: DocsIndex,
  head: () => ({ meta: [{ title: "Documentation" }] }),
})

function DocsIndex() {
  return <ScrollView className="px-6">…</ScrollView>
}`,
    },
    {
      type: "p",
      text: "The string passed to `createFileRoute` is the route's path as declared in the config. The route generator checks it and rewrites it when you move a route, and it writes the `createFileRoute` import into a new route file for you, pointing at `@arrzdev/adaptv/router`. The factory is also declared as an ambient global type so the file typechecks before that happens.",
    },
    { type: "h2", text: "Params and loaders" },
    {
      type: "p",
      text: "A `$slug` segment becomes `params.slug`, typed from the route tree. A `loader` runs before the route renders and its result is read with `Route.useLoaderData()`. Throw `notFound()` from a loader when the param names nothing.",
    },
    {
      type: "code",
      label: "src/routing/pages/docs/doc.page.tsx",
      lang: "tsx",
      code: `import { createFileRoute, notFound } from "@arrzdev/adaptv/router"
import { DocsLayout } from "@/components/docs-layout"
import { ALL_DOCS } from "@/content/docs"

export const Route = createFileRoute("/docs/$slug")({
  loader: ({ params }) => {
    const page = ALL_DOCS.find((item) => item.slug === params.slug)
    if (!page) throw notFound()
    return { slug: page.slug, title: page.title }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: \`\${loaderData?.title ?? "Docs"} — adaptv docs\` }],
  }),
  component: DocRoute,
})

function DocRoute() {
  const { slug } = Route.useLoaderData()
  const page = ALL_DOCS.find((item) => item.slug === slug)
  return page ? <DocsLayout page={page} /> : null
}`,
    },
    {
      type: "note",
      tone: "warn",
      text: '`loader` and `beforeLoad` are isomorphic. On a server-rendered web build they run on the server for the first request and in the browser for every navigation after it. In a native app and in a `render: "spa"` build they only ever run in the browser. Write them so both are fine: fetch an **absolute** URL or read local storage, and never assume a server, a cookie or a request. [Rendering](/docs/rendering) has the full boundary.',
    },
    {
      type: "p",
      text: '`beforeLoad` is the place for a guard. Throw `redirect({ to: "/sign-in" })` from it when a client-held token is missing. Inside a component, `useParams`, `useSearch`, `useLoaderData`, `useLocation`, `useMatch`, `useNavigate` and `useRouter` are all exported from `@arrzdev/adaptv/router`.',
    },
    { type: "h2", text: "Head" },
    {
      type: "p",
      text: "The shell writes the document head from `adaptv.config.ts`: `title` (or `name`), `description`, `lang`, Open Graph and Twitter meta, the manifest link, the icon links and the viewport. A route's `head` option adds to it or overrides the title for that route, as in the two examples above. It receives `loaderData`, so a page title can come from what the loader found.",
    },
    {
      type: "p",
      text: "adaptv adds one route option of its own, `chromeTint`, which pins the browser chrome to a colour on that route. It has to be a string literal because it is read at build time. See [Theming](/docs/theming).",
    },
    { type: "h2", text: "Layouts and providers" },
    {
      type: "p",
      text: "A layout route wraps its children and renders them through `<Outlet />`. There is no `providers` key in the config: an app-wide provider tree is a pathless layout around every page, which nests and scopes the way the rest of the router does.",
    },
    {
      type: "code",
      label: "src/routing/config.ts",
      lang: "ts",
      code: `import { index, layout, rootRoute, route } from "@arrzdev/adaptv/routes"

export const routes = rootRoute([
  layout("providers", "layouts/providers.layout.tsx", [
    index("pages/todos.page.tsx"),
    route("/settings", "pages/settings.page.tsx"),
  ]),
])`,
    },
    {
      type: "code",
      label: "src/routing/layouts/providers.layout.tsx",
      lang: "tsx",
      code: `import { createFileRoute, Outlet } from "@arrzdev/adaptv/router"
import AppProviders from "@/providers/app-providers"

export const Route = createFileRoute("/_providers")({
  component: ProvidersLayout,
})

function ProvidersLayout() {
  return (
    <AppProviders>
      <Outlet />
    </AppProviders>
  )
}`,
    },
    {
      type: "p",
      text: "A layout that draws something (a tab bar, a sidebar) wraps `<Outlet />` in a `View`. That `View` becomes the element the shell stretches, so the page inside needs `fill`. See [The frame](/docs/the-frame). Declare a sibling page flat when it is a real page and not a wrapper: nesting `/lab/list` under a `/lab` route would force an `<Outlet />` into the `/lab` index page.",
    },
    { type: "h2", text: "Links and navigation" },
    {
      type: "p",
      text: "Use adaptv's [Link](/docs/link) from `@arrzdev/adaptv/components`. It renders a real `<a href>`, so search engines, modifier-clicks and preloading all work, and it adds what a touch screen needs: a press that turns into a scroll or is held past 300ms does not navigate. An external `to` is handed to the system browser (an in-app browser on native, a new tab on the web).",
    },
    {
      type: "code",
      label: "nav.tsx",
      lang: "tsx",
      code: `import { Link } from "@arrzdev/adaptv/components"
import { useNavigate } from "@arrzdev/adaptv/router"

<Link to="/docs/$slug" params={{ slug: "routing" }}>Routing</Link>
<Link to="/search" search={{ q: "drawer" }}>Search</Link>

// A back arrow that pops history when the previous entry is its target,
// so it shares one stack with the OS back gesture.
<Link to="/" smartBack>Back</Link>

// Imperative navigation belongs on a button.
const navigate = useNavigate()
<Button onClick={() => navigate({ to: "/settings" })}>
  <Button.Text>Settings</Button.Text>
</Button>`,
    },
    {
      type: "p",
      text: "`Link` takes `to`, `params`, `search`, `className`, `disabled` and `smartBack`. It has no `onClick` and no `onPress`.",
    },
    { type: "h2", text: "Preloading" },
    {
      type: "p",
      text: "Every key in the `router` block that adaptv does not consume itself is passed to the router when it is created. That is where preloading is set.",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `router: {
  // "intent" preloads a route when a link is hovered or touched.
  // "viewport" preloads every link that scrolls into view.
  defaultPreload: "intent",
  // how long a preloaded loader result stays fresh, in ms
  defaultPreloadStaleTime: 30_000,
},`,
    },
    {
      type: "p",
      text: 'This site uses `"intent"`. The playground uses `"viewport"` with `defaultPreloadStaleTime: Number.POSITIVE_INFINITY`, because its data is local and a preloaded result never goes stale. Preloading warms the route\'s code and runs its loader. On the web the [service worker](/docs/offline) has already precached every route\'s chunks, and in a native app they are on the device, so what preloading buys is the loader.',
    },
    {
      type: "props",
      rows: [
        {
          name: "routesDirectory",
          type: "string",
          default: '"./routing"',
          description: "Where route files live, relative to `src/`.",
        },
        {
          name: "routerConfig",
          type: "string",
          default: '"./src/routing/config.ts"',
          description: "The route config file, relative to the app root.",
        },
        {
          name: "serverEntry",
          type: "string",
          description:
            'A custom server entry for `render: "ssr"`, relative to the app root. Omit it to use the built-in one.',
        },
        {
          name: "memoryHistoryInStandalone",
          type: "boolean",
          default: "false",
          description:
            "Use in-memory history when the app is installed (home-screen PWA or native). The OS edge-swipe then has no browser history entry to navigate, so navigation stays app-controlled. Ignored in a browser tab.",
        },
        {
          name: "…anything else",
          type: "unknown",
          description:
            "Passed to the router: `defaultPreload`, `defaultPreloadStaleTime`, `notFoundMode` and the rest of the engine's options.",
        },
      ],
    },
    { type: "h2", text: "Not found" },
    {
      type: "p",
      text: 'A URL that matches no route, and a `notFound()` thrown from a loader, both render the not-found screen at the root, in place of the whole app tree (adaptv sets `notFoundMode: "root"`; set the key in `router` to change it). The default screen is adaptv\'s `UiNotFound` with a link home. Replace it in the config:',
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `notFoundScreen: () => import("@/components/not-found-screen"),`,
    },
    {
      type: "p",
      text: 'The module\'s default export is the component. The thunk is never executed: adaptv reads the literal specifier and imports the screen statically, so it needs to be a literal `import("…")`. Because a root not-found skips every layout route, providers mounted in a layout are not available inside the not-found screen. See [app shell components](/docs/app-shell-components).',
    },
    { type: "h2", text: "Screen lifecycle" },
    {
      type: "p",
      text: "adaptv does not keep a screen mounted after you navigate away from it, so a React mount is the enter and an unmount is the leave. [useScreenLifecycle](/docs/hooks-lifecycle) is a named place to put that. It adds no machinery over `useEffect`, and its callbacks may be inline without re-running.",
    },
    {
      type: "code",
      label: "player.page.tsx",
      lang: "tsx",
      code: `import { useOnResume, useScreenLifecycle } from "@arrzdev/adaptv/hooks"

useScreenLifecycle({
  onEnter: () => player.resume(),
  onLeave: () => player.pause(),
})

// Backgrounding the app unmounts nothing, so it is a different event.
useOnResume(() => query.refetch())`,
    },
    { type: "h2", text: "What goes wrong" },
    {
      type: "ul",
      items: [
        "**Importing from `@tanstack/react-router` directly.** It works until it bypasses something: the engine's `createRootRoute` skips the shell, and its `Link` has no tap-versus-scroll handling. Import from `@arrzdev/adaptv/router` and `@arrzdev/adaptv/components`.",
        "**`to` autocompletes as plain `string`.** The `#adaptv-route-tree` entry is missing from `tsconfig.json` `paths`. adaptv writes it on first run if the file has a `paths` block to write into.",
        "**A loader that calls a relative URL such as `/api/me`.** It works on the web and fails in the native app, where the origin is the device. Use an absolute API URL.",
        "**A `server: { handlers }` block on a route.** The build refuses it. See [Rendering](/docs/rendering).",
        "**The OS back swipe leaves the installed app's current screen in a way your UI did not expect.** Set `memoryHistoryInStandalone: true`, and handle back yourself with [useBackHandler](/docs/hooks-lifecycle).",
      ],
    },
  ],
}

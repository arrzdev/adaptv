import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "routing",
  title: "Routing",
  summary:
    "List your routes in one config file. Write one file per page. adaptv builds the router and the root route.",
  blocks: [
    {
      type: "p",
      text: "You list routes in `src/routing/config.ts` with helpers from `@arrzdev/adaptv/routes`. Each entry names a page file. The page file exports a `Route`. adaptv builds the router from `adaptv.config.ts` and owns the root route: the document, the [frame](/docs/the-frame), the splash and the not-found screen. See the [router API](/docs/router-api).",
    },
    { type: "h2", text: "Declare the routes" },
    {
      type: "code",
      label: "src/routing/config.ts",
      lang: "ts",
      code: `import { index, layout, rootRoute, route } from "@arrzdev/adaptv/routes"

export default rootRoute([
  layout("providers", "layouts/providers.layout.tsx", [
    index("pages/home.page.tsx"),
    route("/docs/$slug", "pages/docs/doc.page.tsx"),
  ]),
])`,
    },
    {
      type: "p",
      text: "Paths are relative to `src/routing`. A new entry needs no dev-server restart.",
    },
    { type: "h2", text: "A page file" },
    {
      type: "code",
      label: "src/routing/pages/docs/doc.page.tsx",
      lang: "tsx",
      code: `import { createFileRoute, notFound } from "@arrzdev/adaptv/router"

export const Route = createFileRoute("/_providers/docs/$slug")({
  loader: ({ params }) => {
    const page = findPage(params.slug)
    if (!page) throw notFound()
    return { title: page.title }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.title ?? "Docs" }],
  }),
  component: DocRoute,
})

function DocRoute() {
  const { title } = Route.useLoaderData()
  return <h1>{title}</h1>
}`,
    },
    {
      type: "ul",
      items: [
        'The string in `createFileRoute` is the route id. A page under no layout uses its path. A page inside `layout("providers", …)` starts with `/_providers`. The route generator corrects the string when you move a route.',
        "You can leave out the import: adaptv writes it.",
        "A page returns one root element, a `View` or a `ScrollView`. See [The frame](/docs/the-frame).",
        "`$slug` becomes `params.slug`. `loader` runs before the page renders. Throw `notFound()` or `redirect({ to })` from it.",
        "`head` adds to the head from your config. `chromeTint` sets the browser chrome colour: write a string, inline or in a top-level `const` of the same file. See [Theming](/docs/theming).",
      ],
    },
    {
      type: "note",
      tone: "warn",
      text: '`loader` and `beforeLoad` run on the server for the first request of a server-rendered page, and in the browser after that. In a native app they run on the device. Fetch an **absolute** URL. Do not guard a route on a client-held token under `render: "ssr"`: the server cannot read it and redirects every hard load. See [Rendering](/docs/rendering).',
    },
    { type: "h2", text: "Layouts and providers" },
    {
      type: "p",
      text: "A layout renders its children with `<Outlet />`. The config has no `providers` key: put app-wide providers in a layout.",
    },
    {
      type: "code",
      label: "src/routing/layouts/providers.layout.tsx",
      lang: "tsx",
      code: `import { createFileRoute, Outlet } from "@arrzdev/adaptv/router"
import AppProviders from "@/providers/app-providers"

export const Route = createFileRoute("/_providers")({
  component: () => (
    <AppProviders>
      <Outlet />
    </AppProviders>
  ),
})`,
    },
    {
      type: "p",
      text: "A layout that draws something, such as a tab bar, wraps `<Outlet />` in a `View`. The shell stretches that `View`, so the page inside needs `fill`. Declare a real page as a flat sibling, not as a child of a parent route.",
    },
    { type: "h2", text: "Links and navigation" },
    {
      type: "p",
      text: "Use adaptv's [Link](/docs/link). It renders a real `<a href>`. A press that becomes a scroll, or lasts over 300ms, does not navigate. An external `to` opens the system browser. For code, use `useNavigate()`.",
    },
    {
      type: "code",
      label: "nav.tsx",
      lang: "tsx",
      code: `import { Link } from "@arrzdev/adaptv/components"

export const Nav = () => (
  <Link to="/docs/$slug" params={{ slug: "routing" }}>
    Routing
  </Link>
)`,
    },
    {
      type: "note",
      tone: "warn",
      text: "`Link` does not check `to` against your routes: `to` is a `string`. A misspelt path compiles. `navigate` and `redirect` do check it, when `tsconfig.json` has a `paths` block (the [Vite plugin](/docs/vite-plugin) adds the entry). `Link` has no `onClick` and no `onPress`.",
    },
    { type: "h2", text: "The router block" },
    {
      type: "p",
      text: '`router` in `adaptv.config.ts` is required. `router: {}` is the smallest value. It holds build paths, `memoryHistoryInStandalone` and router options such as `defaultPreload: "intent"`. The [config](/docs/config) lists them. With `memoryHistoryInStandalone: true`, an installed app keeps history in memory, so the OS back swipe does nothing and you handle back with [useBackHandler](/docs/hooks-lifecycle).',
    },
    {
      type: "note",
      tone: "warn",
      text: "adaptv copies router options into generated source. Only plain values survive: strings, numbers, booleans, arrays, objects, `Infinity` and `NaN`. A function or component is dropped without a warning. So `defaultErrorComponent`, `defaultPendingComponent` and `context` do nothing here. Set `errorComponent` on a route, or eject the router.",
    },
    { type: "h2", text: "Not found" },
    {
      type: "p",
      text: 'A URL with no route, and a `notFound()` from a loader, both replace the whole app with the not-found screen. Replace the default in the config. The default export is a component that takes `NotFoundScreenProps`. Write a literal `import("…")`: adaptv reads the path from the source. The screen skips every layout, so layout providers are not available in it.',
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `notFoundScreen: () => import("@/components/not-found-screen"),`,
    },
    { type: "h2", text: "Eject the router or the client entry" },
    {
      type: "p",
      text: "Write `src/router.tsx` to replace the router. Export `getRouter`, which returns `createAdaptvRouter({ routeTree })`. Write `src/client.tsx` to replace the client entry. A router built another way does not open native deep links. See the [Vite plugin](/docs/vite-plugin).",
    },
    { type: "h2", text: "Common problems" },
    {
      type: "ul",
      items: [
        "**`createLazyFileRoute` fails to import.** `@arrzdev/adaptv/router` does not export it. Lazy routes are not supported.",
        "**A loader fetches `/api/me`.** It works on the web. In a native app the origin is the device. Use an absolute URL.",
        "**A `server: { handlers }` key on a route.** The build refuses it.",
        "**Screen enter and leave.** A mount is the enter and an unmount is the leave. Use [useScreenLifecycle](/docs/hooks-lifecycle). Backgrounding the app unmounts nothing: use `useOnResume`.",
      ],
    },
  ],
}

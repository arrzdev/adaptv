import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "offline",
  title: "Offline and the service worker",
  summary:
    "Make the web build boot offline, and show a screen when data is missing.",
  blocks: [
    {
      type: "p",
      text: "adaptv registers one service worker for every web build. You write no worker file and no registration code. Native apps have no worker, because the bundle is on the device.",
    },
    { type: "h2", text: "What the worker does" },
    {
      type: "table",
      head: ["Request", "What happens"],
      rows: [
        ["Route JS and CSS", "Precached when the worker installs."],
        [
          'The app shell (`adaptv-shell.html` with `render: "ssr"`, `index.html` with `"spa"`)',
          "Precached. It boots the app with no network.",
        ],
        [
          "Page navigations with SSR",
          "Network first, with a 3 second deadline. Then the shell.",
        ],
        ["Page navigations with SPA", "Always the shell."],
        [
          "Same-origin scripts, styles, fonts, images and `assets/`",
          "Cache first, in a bucket named `static-<buildTag>`.",
        ],
        ["Responses from `/api/`", "Never cached."],
        [
          "Page documents",
          "Never cached. A cached page could reach another user.",
        ],
      ],
    },
    {
      type: "p",
      text: "Navigations to `/api/`, `/assets/` and `/_serverFn/` pass through. So does any URL whose last segment has a dot, such as `/whitepaper.pdf`. A route like `/blog/hello.world` counts as a file.",
    },
    {
      type: "p",
      text: "`adaptv dev` has no worker. Use `adaptv preview web` to test it. The worker needs `localhost` or `https://`. The shell also removes any other service worker in the app's scope, such as one from another PWA plugin.",
    },
    { type: "h2", text: "Show an offline screen" },
    {
      type: "p",
      text: "With no network, the worker serves the shell, React boots and the router resolves the URL. The URL and back stack stay. adaptv does not decide when a route shows offline UI: your route renders the [Offline](/docs/offline-boundary) component when its data is missing, and your data layer refetches when the network returns.",
    },
    {
      type: "code",
      label: "product.tsx",
      lang: "tsx",
      code: `import { Offline } from "@arrzdev/adaptv/components"

// useProduct is your data hook: it returns { data, isPaused, retry }.
function Product({ id }: { id: string }) {
  const { data, isPaused, retry } = useProduct(id)

  // Nothing cached and the request is waiting for the network.
  if (!data && isPaused) return <Offline onRetry={retry} />

  return <ProductView data={data} />
}`,
    },
    {
      type: "p",
      text: "`useIsOffline()` from `@arrzdev/adaptv/hooks` returns `true` while the device has no connection. It is `false` on the server and before hydration. Use it for a banner or a disabled button. Do not use it alone to pick the offline screen.",
    },
    {
      type: "p",
      text: 'To use your own screen, set `offlineComponent: () => import("@/components/offline")` in `adaptv.config.ts`. The module needs a default export. adaptv renders it with no props, so `onRetry` and `error` are optional. adaptv bundles it in the main chunk, so it works offline. `bootErrorScreen` is the matching setting for a bundle that never started.',
    },
    {
      type: "p",
      text: "If a route chunk fails to load, adaptv reloads the page once, then shows the offline screen. A stale chunk more than 30 seconds after that reload triggers a new reload at once.",
    },
    { type: "h2", text: "Update the app" },
    {
      type: "p",
      text: 'A new deploy installs a new worker in the background. adaptv applies it at the next cold launch, with one reload. Set `serviceWorkerUpdate: "prompt"` in `adaptv.config.ts` to choose the moment yourself.',
    },
    {
      type: "code",
      label: "update-banner.tsx",
      lang: "tsx",
      code: `import { Button, Text, View } from "@arrzdev/adaptv/components"
import { useServiceWorkerUpdate } from "@arrzdev/adaptv/hooks"

export function UpdateBanner() {
  const { updateAvailable, applyUpdate } = useServiceWorkerUpdate()
  if (!updateAvailable) return null

  return (
    <View row className="items-center justify-between bg-gray-900 px-4 py-2">
      <Text className="text-white">A new version is ready.</Text>
      <Button onClick={applyUpdate}>
        <Button.Text>Reload</Button.Text>
      </Button>
    </View>
  )
}`,
    },
    {
      type: "p",
      text: '`updateAvailable` is always `false` under `"auto"`, on native and in dev. A tab left open for weeks stays on its build until reloaded. Your host must keep the old build\'s files until then. See [Deploying](/docs/deploying).',
    },
    { type: "h2", text: "Add your own worker code" },
    {
      type: "p",
      text: "List files in `serviceWorkers`. adaptv bundles them into its worker and runs them after its own setup. They can add handlers. They cannot change precaching or navigation.",
    },
    {
      type: "code",
      label: "src/sw/push.ts",
      lang: "ts",
      code: `/// <reference lib="webworker" />
import { cacheRoute, sendToApp } from "@arrzdev/adaptv/sw"

declare const self: ServiceWorkerGlobalScope

self.addEventListener("push", (event) => {
  const payload = event.data?.json() ?? {}
  event.waitUntil(sendToApp({ type: "push", ...payload }))
})

cacheRoute({
  match: (url) => url.pathname.startsWith("/api/catalog/"),
  strategy: "stale-while-revalidate",
  cacheName: "catalog",
  maxEntries: 200,
  maxAgeSeconds: 60 * 60 * 24,
})`,
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `export default defineApp({
  // ...
  serviceWorkers: ["./src/sw/push.ts"],
})`,
    },
    {
      type: "props",
      rows: [
        {
          name: "match",
          type: "(url: URL, request: Request) => boolean",
          required: true,
          description:
            "Which requests the rule takes. It never matches navigations.",
        },
        {
          name: "strategy",
          type: '"network-first" | "cache-first" | "stale-while-revalidate"',
          required: true,
          description:
            "How to answer. Use `cache-first` only for URLs that never change.",
        },
        {
          name: "cacheName",
          type: "string",
          required: true,
          description: "Stored as `app-<cacheName>`.",
        },
        {
          name: "maxEntries",
          type: "number",
          description: "Entry limit. Omit both limits for no limit.",
        },
        { name: "maxAgeSeconds", type: "number", description: "Age limit." },
        {
          name: "networkTimeoutSeconds",
          type: "number",
          description:
            "`network-first` only. Seconds to wait before using the cache.",
        },
      ],
    },
    {
      type: "note",
      tone: "warn",
      text: "Do not cache personal responses. The cache is shared by every user of the browser. `cacheRoute` cannot take same-origin scripts, styles, fonts, images or `assets/`: adaptv's own rule matches them first. Use it for API and cross-origin requests.",
    },
    {
      type: "p",
      text: "In the app, `useServiceWorkerMessage(handler)` receives what `sendToApp` sends. `sendToServiceWorker(message)` sends the other way and does nothing without a worker. Both come from `@arrzdev/adaptv/hooks`. Messages need a string `type`. In the worker, `onAppMessage` receives them.",
    },
    { type: "h2", text: "What goes wrong" },
    {
      type: "ul",
      items: [
        "**No worker in `adaptv dev`.** This is by design. Use `adaptv preview web`.",
        "**No worker on a LAN address.** `http://192.168.x.x` is not a secure context. Use `https://` or `localhost`.",
        "**The first visit offline shows the browser error page.** No worker exists yet. Visit once online.",
        "**The worker does not update.** It applies at cold launch only, or when you call `applyUpdate`.",
        "**Reset a broken worker.** In DevTools, open Application, then Service Workers, then Unregister. There is no API for this.",
        "**A chunk fails to load after a deploy.** Your host removed the old build's files. See [Deploying](/docs/deploying).",
      ],
    },
  ],
}

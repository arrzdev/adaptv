import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "offline",
  title: "Offline and the service worker",
  summary:
    "adaptv registers one service worker for you. It makes the web build boot and navigate without a network, and leaves what to show when data is missing up to your routes.",
  blocks: [
    {
      type: "p",
      text: "A native app has its whole bundle on the device, so it always boots and every screen is instant. The service worker exists to give the web build and the installed PWA the same property. adaptv owns it end to end: you write no worker file and no registration code, and there is no config key that turns it off or replaces it.",
    },
    { type: "h2", text: "What the worker does" },
    {
      type: "table",
      head: ["Request", "What happens", "Why"],
      rows: [
        [
          "Every route's JS and CSS chunk",
          "Precached when the worker installs.",
          "Once the app has booted, navigation is client-side, so every route is available offline without caching a single page.",
        ],
        [
          "The app shell (one generated HTML file)",
          "Precached, always.",
          "It is generated from your config, identical for every visitor, and is what boots React when the network cannot.",
        ],
        [
          'Page navigations, `render: "ssr"`',
          "Network first with a 3 second deadline, then the precached shell.",
          "Every online navigation still gets a fresh server render. A dead or very slow connection gets the shell, and the client router resolves the URL.",
        ],
        [
          'Page navigations, `render: "spa"`',
          "Always the precached shell.",
          "There is no per-request render to preserve.",
        ],
        [
          "Other same-origin scripts, styles, fonts, images and `/assets/*`",
          "Cache first, in a bucket named after the build.",
          "The bucket rotates on every deploy and the old one is deleted when the new worker activates.",
        ],
        ["API responses", "Never cached.", "That is your data layer's job."],
        [
          "Route documents (`/`, `/dashboard`)",
          "Never cached.",
          "Cache Storage is keyed by URL, per origin, with no user dimension. Under SSR a cached page could be served to the next person who signs in on the same browser.",
        ],
      ],
    },
    {
      type: "p",
      text: "Navigations under `/api/`, `/assets/` and `/_serverFn/` are left alone, and so is any URL whose last path segment contains a dot. The shell must never answer a link to `/whitepaper.pdf`. The known cost: a route such as `/blog/hello.world` is read as a file. Dots in earlier segments (`/v1.2/docs`) are fine.",
    },
    {
      type: "note",
      text: "There is no worker in `adaptv dev`. Dev URLs are not cache-stable, so the shell removes any registered worker and its caches while developing. To see the worker, run `adaptv preview web`. `ADAPTV_DEV_SW=1` makes the dev server serve **your own** worker modules (see below) at `/sw.js`, and still none of adaptv's.",
    },
    { type: "h2", text: "What offline looks like" },
    {
      type: "p",
      text: "There is no `offline.html` and no `/offline` route. When the network is gone the worker serves the app shell, React boots, and the router resolves the URL the user asked for. A route whose data cannot load then renders its own offline UI in place. The URL, the route params, the back stack and the surrounding layout all survive, and when the connection returns the route re-runs its query and swaps to real content with no navigation.",
    },
    {
      type: "p",
      text: "adaptv takes on exactly two obligations here: an accurate connectivity signal, and an `Offline` component. It never decides when your data is missing.",
    },
    {
      type: "api",
      name: "useIsOffline()",
      signature: "function useIsOffline(): boolean",
      description:
        "`true` while the device reports no connectivity. Reads the OS network status in a native build, and `navigator.onLine` with the `online` and `offline` events in a browser. Reports `false` (online) during server rendering and before hydration, so an offline screen is never baked into HTML.",
      returns:
        "A boolean. `getOnline()` and `subscribeOnline()` from `@arrzdev/adaptv/capabilities` are the same signal outside React.",
    },
    {
      type: "note",
      tone: "warn",
      text: '`isOffline` alone is a poor test for showing an offline screen, in both directions. Offline with cached data should render normally, and online with a failed request usually wants the same screen as offline. Ask "do I have anything to show?" instead. Use the hook for what it answers: an indicator, a disabled submit button, a banner over live content.',
    },
    {
      type: "code",
      label: "product.page.tsx",
      lang: "tsx",
      code: `import { Offline } from "@arrzdev/adaptv/components"
import { useQuery } from "@tanstack/react-query"

function Product() {
  const { id } = Route.useParams()
  const { data, fetchStatus, refetch } = useQuery({
    queryKey: ["product", id],
    queryFn: () => fetchProduct(id),
  })

  // Nothing cached and the fetch is parked: offline UI, in place, still at /product/$id.
  if (!data && fetchStatus === "paused") return <Offline onRetry={refetch} />

  // A cache hit renders normally, offline or not.
  return <ProductView data={data} />
}`,
    },
    {
      type: "p",
      text: 'The example uses TanStack Query because `fetchStatus === "paused"` is a precise signal and recovery is automatic. adaptv does not depend on it; use whatever your data layer offers.',
    },
    { type: "h3", text: "The Offline component" },
    {
      type: "p",
      text: "`Offline` is rendered from two places. adaptv renders it when the app cannot get far enough for a route to exist: a route chunk failed to load, or the route tree could not resolve. You render the same component from a route whose data is unavailable. Every prop is optional, which is what lets one component serve both. Props are listed on the [Offline](/docs/offline-boundary) page.",
    },
    {
      type: "p",
      text: "To replace it with your own screen, register it in config. It receives `onRetry` and `error`, both optional.",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `export default defineApp({
  // ...
  offlineComponent: () => import("@/components/offline"),
})`,
    },
    {
      type: "p",
      text: "The thunk looks lazy and is not. adaptv reads the import path at build time and emits a static import, so the component is in the main bundle. A lazily loaded offline screen would be unavailable in exactly the situation it exists for. The module must have a `default` export.",
    },
    {
      type: "p",
      text: "A failed chunk load gets one automatic reload per session before the offline screen shows, which covers the common case of a tab that outlived a deploy.",
    },
    { type: "h2", text: "Updates" },
    {
      type: "p",
      text: "A new deploy installs a new worker in the background. The question is when it takes over, because taking over deletes the previous build's precache, and a page still running the old build would fail its next lazy import. adaptv applies a waiting worker at one moment only: a **cold launch**. The worker finished installing in an earlier session, so applying it costs one reload and no downloads, and a document created a moment ago has no typed-in form to lose. A worker that finishes installing during a session is left alone until the next launch.",
    },
    {
      type: "props",
      rows: [
        {
          name: "serviceWorkerUpdate",
          type: '"auto" | "prompt"',
          default: '"auto"',
          description:
            '`"auto"` applies a waiting worker at cold launch with no UI. `"prompt"` never applies one by itself: the app decides, through `useServiceWorkerUpdate()`. Choose it when a session holds state that should not be lost to a reload, such as an editor, a long form or a call.',
        },
      ],
    },
    {
      type: "api",
      name: "useServiceWorkerUpdate()",
      signature:
        "function useServiceWorkerUpdate(): { updateAvailable: boolean; applyUpdate: () => void }",
      description:
        'The app side of `serviceWorkerUpdate: "prompt"`. `updateAvailable` turns `true` when a new version has installed and is waiting. `applyUpdate()` activates it and reloads, and is safe to call when nothing is waiting. adaptv ships no update prompt: the banner is yours, in your design system.',
      returns:
        'Under `"auto"`, on native and in dev, `updateAvailable` is always `false`, so a shared component can call the hook unconditionally.',
    },
    {
      type: "code",
      label: "update-banner.tsx",
      lang: "tsx",
      code: `import { useServiceWorkerUpdate } from "@arrzdev/adaptv/hooks"

export function UpdateBanner() {
  const { updateAvailable, applyUpdate } = useServiceWorkerUpdate()
  if (!updateAvailable) return null

  return (
    <View row className="items-center justify-between bg-gray-900 px-4 py-2 text-white">
      <Text>A new version is ready.</Text>
      <Button onClick={applyUpdate}>
        <Button.Text>Reload</Button.Text>
      </Button>
    </View>
  )
}`,
    },
    {
      type: "note",
      text: "One accepted gap: a desktop tab left open for weeks never cold-launches, so it stays on its build until someone reloads it. It keeps working as long as your host keeps the previous build's files. See [Deploying](/docs/deploying).",
    },
    { type: "h2", text: "Adding your own worker code" },
    {
      type: "p",
      text: "Push handlers, background sync and a runtime cache for your own API are app behaviour, and the framework has no opinion about them. List the files in `serviceWorkers`. Each is bundled into adaptv's worker and evaluated after its setup, so your module can add handlers and cannot take over precaching or navigation. There is one worker and one registration; your modules update together with it.",
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
      type: "code",
      label: "src/sw/push.ts",
      lang: "ts",
      code: `/// <reference lib="webworker" />
import { cacheRoute, onAppMessage, sendToApp } from "@arrzdev/adaptv/sw"

declare const self: ServiceWorkerGlobalScope

// Tell every open window of the app that a push arrived. React decides what to draw.
self.addEventListener("push", (event) => {
  const payload = event.data?.json() ?? {}
  event.waitUntil(sendToApp({ type: "push", ...payload }))
})

// Messages the app sent with sendToServiceWorker().
onAppMessage((message) => {
  if (message.type === "ping") void sendToApp({ type: "pong" })
})

// A runtime cache for public, non-personalised data.
cacheRoute({
  match: (url) => url.pathname.startsWith("/api/catalog/"),
  strategy: "stale-while-revalidate",
  cacheName: "catalog",
  maxEntries: 200,
  maxAgeSeconds: 60 * 60 * 24,
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
            "Which requests this rule claims. Navigations are never matched, whatever this returns.",
        },
        {
          name: "strategy",
          type: '"network-first" | "cache-first" | "stale-while-revalidate"',
          required: true,
          description:
            "`network-first`: fresh when possible, cached when the network is slow or down. `cache-first`: cached for good once seen, so only for immutable URLs. `stale-while-revalidate`: the cached copy now, refreshed in the background for next time.",
        },
        {
          name: "cacheName",
          type: "string",
          required: true,
          description:
            "Bucket name. It is stored as `app-<cacheName>`, so it cannot collide with adaptv's per-build caches or be deleted with them.",
        },
        {
          name: "maxEntries",
          type: "number",
          description:
            "Rolling entry limit. Omit both limits for a permanent cache.",
        },
        {
          name: "maxAgeSeconds",
          type: "number",
          description: "Rolling age limit.",
        },
        {
          name: "networkTimeoutSeconds",
          type: "number",
          description:
            "`network-first` only. Seconds to wait before falling back to the cached copy.",
        },
      ],
    },
    {
      type: "note",
      tone: "warn",
      text: "Do not cache personalised responses with `cacheRoute`. The cache is keyed by URL for the whole origin, so a response cached for one signed-in user is served to the next one who asks for the same URL.",
    },
    {
      type: "p",
      text: "On the app side, `useServiceWorkerMessage(handler)` receives what your modules send with `sendToApp`, and `sendToServiceWorker(message)` sends the other way. Both come from `@arrzdev/adaptv/hooks`. Messages need a string `type`. `sendToServiceWorker` does nothing when no worker controls the page, which is the normal state on native, in dev and before the first activation.",
    },
    {
      type: "code",
      label: "notifications.tsx",
      lang: "tsx",
      code: `import { useServiceWorkerMessage } from "@arrzdev/adaptv/hooks"

useServiceWorkerMessage((message) => {
  if (message.type === "push") showToast(String(message.title))
})`,
    },
    { type: "h2", text: "Native apps have no service worker" },
    {
      type: "p",
      text: "The iOS and Android builds never register a worker, and remove one if they find it. The bundle is already on the device, so a worker cache would be a second copy, and a stale one would keep serving old code after an [over-the-air update](/docs/ota-updates). What that changes for you:",
    },
    {
      type: "ul",
      items: [
        "The app always boots offline, including the first launch. `Offline`, `useIsOffline` and the in-place pattern work exactly the same.",
        "`useServiceWorkerUpdate()` reports `false` and `sendToServiceWorker()` is a no-op. Code in `serviceWorkers` does not run, so anything it does (push, background sync) needs a native plugin there instead.",
        "New JavaScript reaches installed apps through OTA updates, not through the worker.",
      ],
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Needs a secure origin. `localhost` and `https://` qualify; plain `http://` on another host gets no worker, and adaptv logs a console warning saying so.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "Works after the first online visit. The very first load while offline shows the browser's own error page, because no worker exists yet to serve anything.",
        },
        {
          target: "Installed PWA",
          status: "yes",
          note: "Installing implies a successful visit, so the app boots offline from then on. Phones cold-launch often, so updates land quickly.",
        },
        {
          target: "iOS",
          status: "no",
          note: "No worker, by design. The bundle is on the device and updates arrive over the air.",
        },
        {
          target: "Android",
          status: "no",
          note: "No worker, by design.",
        },
      ],
    },
  ],
}

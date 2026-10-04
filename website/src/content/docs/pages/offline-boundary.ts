import { OfflineBoundaryDemo } from "@/components/docs-demos/offline-boundary-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "offline-boundary",
  title: "Offline",
  summary:
    "The offline screen: a title, a line of copy and a retry button, rendered in place by a route or by adaptv when the app cannot load a route at all.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { Offline } from "@arrzdev/adaptv/components"',
  source: "src/components/offline.tsx",
  blocks: [
    {
      type: "demo",
      component: OfflineBoundaryDemo,
      code: `import { Offline } from "@arrzdev/adaptv/components"

<Offline onRetry={() => query.refetch()} />`,
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: "`Offline` is a screen, and it never decides by itself when to appear. It does not watch the network and it does not wrap children. You render it where content would have gone, and it fills that space. The same component is rendered from two places:",
    },
    {
      type: "table",
      head: ["Rendered by", "When", "`onRetry`"],
      rows: [
        [
          "**You**, from a route",
          "The route mounted but has no data to show.",
          "Whatever fetches again: `refetch`, a mutation, `router.invalidate()`.",
        ],
        [
          "**adaptv**",
          "A route's code chunk failed to load, one automatic reload has already been tried, and there is no route left to render anything.",
          "Not passed. The button reloads the page.",
        ],
      ],
    },
    {
      type: "p",
      text: "Every prop is optional, which is what lets one component serve both call sites.",
    },
    { type: "h3", text: "From a route" },
    {
      type: "p",
      text: "Render it in place, in the route that is missing its data. The URL and the route params stay, so a retry can rebuild the request, and the route swaps to real content with no navigation when the data arrives. Do not redirect to an `/offline` route.",
    },
    {
      type: "p",
      text: '"Is the device offline" is a poor test on its own. Offline with a warm cache should render normally, and online with a failed request usually wants this same screen. Ask whether you have anything to show. With TanStack Query, `fetchStatus === "paused"` means the fetch was parked because the device is offline:',
    },
    {
      type: "code",
      label: "product.page.tsx",
      lang: "tsx",
      code: `import { Offline } from "@arrzdev/adaptv/components"

function ProductPage() {
  const { id } = Route.useParams()
  const { data, fetchStatus, refetch } = useQuery({
    queryKey: ["product", id],
    queryFn: () => fetchProduct(id),
  })

  if (!data && fetchStatus === "paused") return <Offline onRetry={refetch} />
  if (!data) return <ProductSkeleton />
  return <Product data={data} />
}`,
    },
    {
      type: "p",
      text: "Without a query library, `useIsOffline()` from `@arrzdev/adaptv/hooks` gives the connectivity signal: the OS's reachability on iOS and Android, and `navigator.onLine` with its events in a browser. The [offline guide](/docs/offline) covers it.",
    },
    { type: "h3", text: "From adaptv" },
    {
      type: "p",
      text: "After a deploy, a tab that was already open can ask for a route chunk that no longer exists. adaptv reloads the page once to pick up the new build. If the chunk is still missing after that reload, the shell replaces the app with the offline screen so the user does not get a blank page. adaptv renders it with no props, so the retry button reloads.",
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "onRetry",
          type: "() => void",
          description:
            "Runs when the button is pressed. When omitted, the button calls `location.reload()`.",
        },
        {
          name: "title",
          type: "string",
          default: '"You\'re offline"',
          description: "The heading.",
        },
        {
          name: "description",
          type: "string",
          default: '"Check your connection and try again."',
          description: "The line under the heading.",
        },
        {
          name: "retryLabel",
          type: "string",
          default: '"Try again"',
          description: "The button's label.",
        },
        {
          name: "error",
          type: "unknown",
          description:
            "The failure, when there was one. It is accepted and never rendered: an error routinely carries a request URL, a token or a stack, and this is the screen users screenshot into support tickets. It is on the props so your own component can log it.",
        },
        {
          name: "className",
          type: "string",
          description: "Classes for the root, merged over the defaults.",
        },
      ],
    },
    { type: "h2", text: "Your own offline screen" },
    {
      type: "p",
      text: "Register a component with `offlineComponent` in `adaptv.config.ts` and adaptv renders yours at its call site. Use the same component in your routes, so the app has one offline screen. Type it with `OfflineProps` and keep every prop optional, because adaptv passes none.",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `export default defineApp({
  offlineComponent: () => import("@/components/offline"),
})`,
    },
    {
      type: "code",
      label: "src/components/offline.tsx",
      lang: "tsx",
      code: `import type { OfflineProps } from "@arrzdev/adaptv/components"
import { Button, Text, View } from "@arrzdev/adaptv/components"

export default function Offline({ onRetry, error }: OfflineProps) {
  if (error) reportError(error)
  return (
    <View safe="all" className="flex-1 items-center justify-center gap-3 px-6 text-center">
      <Text className="text-lg font-semibold">No connection</Text>
      <Text className="text-sm text-gray-500">Your notes are saved on this device.</Text>
      <Button onClick={onRetry ?? (() => location.reload())}>
        <Button.Text>Try again</Button.Text>
      </Button>
    </View>
  )
}`,
    },
    {
      type: "note",
      text: "The thunk is never executed. The Vite plugin reads the import path and emits a static import, so the offline screen ships in the main bundle. That is deliberate: a lazily loaded offline screen would be one more chunk that cannot load in exactly the situation it exists for.",
    },
    { type: "h2", text: "The service worker" },
    {
      type: "p",
      text: "There is no `offline.html`. When a navigation cannot be answered from the network, adaptv's service worker does not serve a static offline page. It serves the precached app shell, the app boots, the router renders the route for the current URL, and that route decides what to show, `Offline` included. The offline screen is a React component so that it has your theme, your fonts and the safe-area padding, and so that the same code runs on iOS and Android, where there is no service worker.",
    },
    {
      type: "p",
      text: "One case is out of reach: the first visit to the site, in a browser, while offline. Nothing is cached yet, no JavaScript runs, and the browser shows its own error page. A service worker has to install online once before it can serve anything. It cannot happen in a native build, where the bundle ships inside the app. See the [offline guide](/docs/offline) for caching and the service worker.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: 'The root is a [View](/docs/view) with `safe="all"`, so its content clears the notch and the home indicator. By default it is `flex-1` and centres its content, which fills a flex parent. `className` lands on the root and nothing else on it is locked. The root carries `data-adaptv="offline"`, `role="alert"` and `aria-live="polite"`, and the button is a [Button](/docs/button) with `haptic` on.',
    },
    {
      type: "note",
      tone: "warn",
      text: "The heading and description colours are fixed (`text-gray-950` and `text-gray-600`) and no prop reaches them, so the default does not follow a dark theme. For a themed app, register your own `offlineComponent`.",
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "`navigator.onLine` only knows whether a network interface exists, so a captive-portal Wi-Fi reads as online. Base the decision on your data, not on the flag.",
        },
        { target: "Mobile web", status: "yes", note: "Same as desktop web." },
        {
          target: "Installed PWA",
          status: "yes",
          note: "With a warm cache the app keeps working offline, so the screen may correctly never appear.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "`useIsOffline()` reads real reachability from the OS. The app bundle is on the device, so the app always boots.",
        },
        { target: "Android", status: "yes", note: "Same as iOS." },
      ],
    },
  ],
}

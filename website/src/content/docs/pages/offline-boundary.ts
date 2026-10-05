import { OfflineBoundaryDemo } from "@/components/docs-demos/offline-boundary-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "offline-boundary",
  title: "Offline",
  summary: "A screen with a title, a line of text and a retry button.",
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
      text: "`Offline` does not watch the network and does not wrap children. Render it in a route that has no data to show. Pass `onRetry` to fetch again. Keep the URL, and do not redirect to an `/offline` route. Test whether you have data to show, not only whether the device is offline. `useIsOffline()` from `@arrzdev/adaptv/hooks` gives the connectivity signal. See the [offline guide](/docs/offline). adaptv also renders `Offline` itself when a route chunk fails to load after one automatic reload. It passes no props, so the button reloads the page.",
    },
    {
      type: "code",
      label: "product.page.tsx",
      lang: "tsx",
      code: `function ProductPage() {
  const { data, error, refetch } = useProduct()
  if (!data && error) return <Offline onRetry={refetch} />
  if (!data) return <ProductSkeleton />
  return <Product data={data} />
}`,
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "onRetry",
          type: "() => void",
          description:
            "Called when the button is pressed. Default: `location.reload()`.",
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
          description: "The button label.",
        },
        {
          name: "error",
          type: "unknown",
          description:
            "The failure. It is never shown, so a URL or token cannot leak. Use it to log.",
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
      text: "Set `offlineComponent` in `adaptv.config.ts` and adaptv renders your component instead. Type it with `OfflineProps`. Keep every prop optional, because adaptv passes none. The screen ships in the main bundle, so it loads when a chunk cannot.",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `export default defineApp({
  offlineComponent: () => import("@/components/offline"),
})`,
    },
    { type: "h2", text: "Service worker" },
    {
      type: "p",
      text: "There is no `offline.html`. When the network fails, the service worker serves the cached app shell and your route decides what to show. A first visit while offline is the one case that cannot work. Nothing is cached yet, so the browser shows its own error.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: 'The root is a [View](/docs/view) with `safe="all"`. It is `flex-1` and centres its content. It has `data-adaptv="offline"`, `role="alert"` and `aria-live="polite"`. Nothing in `className` is locked. The heading and description colours are fixed (`text-gray-950`, `text-gray-600`), so the default does not follow a dark theme. For a themed app, set your own `offlineComponent`.',
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "`navigator.onLine` reads a captive-portal network as online.",
        },
        { target: "Mobile web", status: "yes", note: "Same as desktop web." },
        {
          target: "Installed PWA",
          status: "yes",
          note: "With a warm cache the screen may never appear.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "`useIsOffline()` reads real reachability.",
        },
        { target: "Android", status: "yes", note: "Same as iOS." },
      ],
    },
  ],
}

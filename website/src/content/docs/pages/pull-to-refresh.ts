import { PullToRefreshDemo } from "@/components/docs-demos/pull-to-refresh-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "pull-to-refresh",
  title: "PullToRefresh",
  summary: "Pull down from the top of a scroller to refresh.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { PullToRefresh, usePullToRefresh } from "@arrzdev/adaptv/components"',
  source: "src/components/pull-to-refresh.tsx",
  blocks: [
    {
      type: "demo",
      component: PullToRefreshDemo,
      code: `import { PullToRefresh, ScrollView } from "@arrzdev/adaptv/components"

const scrollRef = useRef<HTMLDivElement>(null)

<PullToRefresh
  onRefresh={() => query.refetch()}
  scrollContainerRef={scrollRef}
  className="overflow-hidden rounded-xl bg-gray-100"
>
  <ScrollView ref={scrollRef} className="h-64 gap-2 bg-white p-3">
    {messages.map((message) => (
      <Row key={message.id} message={message} />
    ))}
  </ScrollView>
</PullToRefresh>`,
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: "Wrap a scroller in `PullToRefresh`. Give it an `onRefresh` that returns a promise. A drag down from the top shows an arc. A release past 80px calls `onRefresh` and holds the indicator until the promise settles. A shorter release springs back. Pass the scroller ref as `scrollContainerRef`, because the pull works only while that element is at the top. Give the root `overflow-hidden`. If the root is the scroller, omit `scrollContainerRef` and set `overflow-y-auto` and a height on `className`.",
    },
    {
      type: "note",
      tone: "warn",
      text: "Always point `scrollContainerRef` at the element that scrolls. If you do not, the pull is active everywhere in the list. Give the scroller `overscroll-behavior: contain`. A [ScrollView](/docs/scroll-view) has it already.",
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "onRefresh",
          type: "() => Promise<unknown>",
          required: true,
          description:
            "Called once when a pull is released past the threshold. If it rejects, the indicator still closes and the error goes to `reportError`, which logs it. It is not rethrown. Catch inside it to show it in the app.",
        },
        {
          name: "children",
          type: "ReactNode",
          required: true,
          description: "The content that moves down with the pull.",
        },
        {
          name: "scrollContainerRef",
          type: "RefObject<HTMLElement | null>",
          description: "The element that scrolls. Default: the root.",
        },
        {
          name: "enabled",
          type: "boolean",
          default: "true",
          description: "`false` removes the gesture and the indicator.",
        },
        {
          name: "stuckMinMs",
          type: "number",
          default: "750",
          description:
            "The shortest time in milliseconds the indicator stays docked.",
        },
        {
          name: "className",
          type: "string",
          description:
            "Classes for the root. In a flex column, add `min-h-0 flex-1`.",
        },
      ],
    },
    { type: "h2", text: "usePullToRefresh" },
    {
      type: "api",
      name: "usePullToRefresh()",
      signature: "function usePullToRefresh(): PullToRefreshContextValue",
      description:
        "Reads the gesture phase from inside a `PullToRefresh`. Throws outside one.",
      returns:
        "`isPulling` (the content follows the finger), `isRefreshing` (from release until `onRefresh` settles and `stuckMinMs` passes), `isClosing` (the content returns to rest) and `isEnabled` (the `enabled` prop), all boolean.",
    },
    { type: "h2", text: "The indicator" },
    {
      type: "p",
      text: "The indicator is a 20px arc built in. It shows behind the content, against the root background. There is no prop for a custom one. The arc uses `text-gray-950`, which is dark on dark backgrounds. Recolour it from the root:",
    },
    {
      type: "code",
      label: "dark-indicator.tsx",
      lang: "tsx",
      code: `<PullToRefresh
  onRefresh={refresh}
  scrollContainerRef={scrollRef}
  className="overflow-hidden [&_svg]:text-gray-950 dark:[&_svg]:text-white"
>`,
    },
    {
      type: "p",
      text: "A mostly sideways drag is ignored. A pull is cancelled if the scroller leaves the top.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: '`className` goes on the root, which has `data-adaptv="pull-to-refresh"` while enabled. `relative` is locked. `shrink-0 grow-0` is a default. The ref is the root `div`.',
    },
    { type: "h2", text: "Accessibility" },
    {
      type: "p",
      text: 'A live region announces "Release to refresh" and "Refreshing". A pull is a pointer gesture, so offer a refresh button too. With reduced motion, the animations are instant.',
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "Works with a mouse drag. Consider `enabled={false}` and a refresh button.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "In Android Chrome, the browser refresh can compete. `overscroll-behavior: contain` avoids it.",
        },
        { target: "Installed PWA", status: "yes" },
        {
          target: "iOS",
          status: "yes",
          note: "The scroller must contain its overscroll.",
        },
        { target: "Android", status: "yes" },
      ],
    },
  ],
}

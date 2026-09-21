import { PullToRefreshDemo } from "@/components/docs-demos/pull-to-refresh-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "pull-to-refresh",
  title: "PullToRefresh",
  summary:
    "Pull down from the top of a scroller to run async work, with an indicator that holds until the work resolves.",
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
      text: "Wrap a scroller in `PullToRefresh` and give it an `onRefresh` that returns a promise. When the scroller is at the top and the user drags down, the content follows the finger and an arc fills in above it. Releasing past 80px calls `onRefresh`, docks the content 68px down with the arc spinning, and holds it there until the promise settles. Releasing short of 80px springs back and calls nothing.",
    },
    {
      type: "p",
      text: "The thing to get right is telling the component **which element scrolls**. The pull is only armed while that element's `scrollTop` is 0 (within 3px). There are two layouts:",
    },
    {
      type: "ul",
      items: [
        "**A scroller inside the root.** Pass the scroller's ref as `scrollContainerRef`. This is the usual layout, and the one the demo uses. Give the root `overflow-hidden` so the docked content is clipped.",
        "**The root is the scroller.** Leave `scrollContainerRef` out and put `overflow-y-auto` and a height on `className`.",
      ],
    },
    {
      type: "note",
      tone: "warn",
      text: "If the element that scrolls is an ancestor of the root and you pass no `scrollContainerRef`, the root's own `scrollTop` is always 0, so the pull is armed everywhere and dragging down in the middle of the list shows the indicator. Always point `scrollContainerRef` at the element that overflows.",
    },
    {
      type: "p",
      text: "Give the scroller `overscroll-behavior: contain` (a [ScrollView](/docs/scroll-view) already has it) so the browser's rubber band and Chrome's own pull-to-refresh stay out of the way.",
    },
    { type: "h3", text: "With a query library" },
    {
      type: "code",
      label: "inbox.page.tsx",
      lang: "tsx",
      code: `function InboxPage() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: fetchInbox })

  return (
    <View className="h-full">
      <Header />
      <PullToRefresh
        // return the promise: the indicator closes when it settles
        onRefresh={() => inbox.refetch()}
        scrollContainerRef={scrollRef}
        className="min-h-0 flex-1 overflow-hidden"
      >
        <ScrollView ref={scrollRef} fill>
          {inbox.data?.map((message) => (
            <MessageRow key={message.id} message={message} />
          ))}
        </ScrollView>
      </PullToRefresh>
    </View>
  )
}`,
    },
    {
      type: "p",
      text: "The root is `shrink-0 grow-0` by default. Inside a flex column, pass `min-h-0 flex-1` as above so it takes the remaining height.",
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
            "Called once when a pull is released past the threshold. The indicator stays docked until the promise resolves or rejects. It is not called again while a refresh is running.",
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
          description:
            "The element that scrolls. When omitted, the root is treated as the scroll container.",
        },
        {
          name: "enabled",
          type: "boolean",
          default: "true",
          description:
            "When `false`, the root renders the children with no gesture listeners and no indicator. `usePullToRefresh()` still works and reports `isEnabled: false`.",
        },
        {
          name: "stuckMinMs",
          type: "number",
          default: "750",
          description:
            "The shortest time, in milliseconds, the indicator stays docked. A refresh that resolves in 50ms still shows the spinner for this long, so a fast response does not read as a glitch.",
        },
        {
          name: "className",
          type: "string",
          description: "Layout classes for the root.",
        },
      ],
    },
    {
      type: "note",
      text: "If `onRefresh` rejects, the indicator closes as usual and the error is rethrown as an unhandled promise rejection. Catch inside `onRefresh` when you want to show a toast and keep the console quiet.",
    },
    { type: "h2", text: "usePullToRefresh" },
    {
      type: "api",
      name: "usePullToRefresh()",
      signature: "function usePullToRefresh(): PullToRefreshContextValue",
      description:
        "Reads the gesture phase from anywhere inside a `PullToRefresh`. Use it to dim a header, pause a poll or show your own label while a refresh runs. It re-renders when the phase changes, not on every frame of the pull. It throws when called outside a `PullToRefresh`.",
      returns: "An object with the fields below.",
    },
    {
      type: "props",
      rows: [
        {
          name: "isPulling",
          type: "boolean",
          description: "`true` while the content is following the finger.",
        },
        {
          name: "isRefreshing",
          type: "boolean",
          description:
            "`true` from the release past the threshold until `onRefresh` has settled and `stuckMinMs` has passed.",
        },
        {
          name: "isClosing",
          type: "boolean",
          description:
            "`true` while the content animates back to rest, after a refresh or after a short pull.",
        },
        {
          name: "isEnabled",
          type: "boolean",
          description: "The root's `enabled` prop.",
        },
      ],
    },
    {
      type: "code",
      label: "refresh-label.tsx",
      lang: "tsx",
      code: `function RefreshLabel() {
  const { isRefreshing } = usePullToRefresh()
  return <Text className="text-xs text-gray-500">{isRefreshing ? "Updating…" : "Up to date"}</Text>
}`,
    },
    { type: "h2", text: "The indicator" },
    {
      type: "p",
      text: "The indicator is built in: a 20px arc that appears after 16px of pull, fills and rotates in proportion to the distance, and spins while the refresh runs. The content follows the finger up to 160px. There is no prop or slot for a custom indicator yet. For your own, read the phase from `usePullToRefresh()` and draw it inside the children.",
    },
    {
      type: "p",
      text: "The arc is drawn in `currentColor` and its colour is fixed at `text-gray-950`, which disappears on a dark background. Until there is a prop for it, recolour it from the root with a descendant selector, which outranks the built-in class:",
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
      text: "The indicator is drawn behind the content. It shows in the gap the content leaves when it moves down, against the root's background, so give the root the background you want behind the spinner and give the scroller its own.",
    },
    { type: "h2", text: "Gestures it yields to" },
    {
      type: "ul",
      items: [
        "A touch that starts on a [Swipeable](/docs/swipeable) row is ignored, so a row swipe never turns into a pull.",
        "A drag is judged after 10px. If it has moved at least as far sideways as down, it is left alone for the rest of the touch.",
        "If the scroller leaves the top during a pull, the pull is cancelled and the content returns to rest.",
        "A new pull cannot start while a refresh is running.",
      ],
    },
    { type: "h2", text: "Ref" },
    {
      type: "p",
      text: "The ref is the root `<div>`.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: '`className` lands on the root. `relative` is locked, because the indicator is positioned against the root. `shrink-0 grow-0` is a default you can override. The root carries `data-adaptv="pull-to-refresh"` while enabled. Your children are wrapped in one extra `<div>`, which is only translated while a pull or refresh is in progress.',
    },
    { type: "h2", text: "Accessibility" },
    {
      type: "p",
      text: 'The root contains a visually hidden `aria-live="polite"` region that announces "Release to refresh" once the pull passes the threshold and "Refreshing" while `onRefresh` runs. Pulling is a pointer gesture, so give keyboard and screen-reader users a refresh button as well. With reduced motion on, the snap and close animations are instant and the arc does not spin.',
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "Works with a mouse drag. Desktop has no pull-to-refresh idiom, so consider `enabled={false}` on wide screens and a refresh button in its place.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "In an Android Chrome tab the browser's own pull-to-refresh can compete at the very top of the page. `overscroll-behavior: contain` on the scroller keeps the two apart.",
        },
        { target: "Installed PWA", status: "yes" },
        {
          target: "iOS",
          status: "yes",
          note: "The scroller must contain its overscroll, or WebKit's rubber band moves the whole page along with the indicator.",
        },
        { target: "Android", status: "yes" },
      ],
    },
  ],
}

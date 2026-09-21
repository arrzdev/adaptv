import { ListDemo } from "@/components/docs-demos/list-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "list",
  title: "List",
  summary:
    "A virtualized, data-driven scroller: thousands of rows in the data, a screenful of elements in the DOM.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { List } from "@arrzdev/adaptv/components"',
  source: "src/components/list.tsx",
  blocks: [
    {
      type: "demo",
      component: ListDemo,
      code: `import { List } from "@arrzdev/adaptv/components"

type Row = { id: string; index: number }

const rows: Row[] = Array.from({ length: 10_000 }, (_, index) => ({
  id: \`row-\${index}\`,
  index,
}))

<div className="h-64 overflow-hidden rounded-xl border border-gray-200">
  <List
    data={rows}
    keyExtractor={(row) => row.id}
    estimateSize={44}
    fade
    className="h-full"
    renderItem={(row) => (
      <div className="flex h-11 items-center border-b border-gray-200 px-4">
        Row {row.index + 1}
      </div>
    )}
  />
</div>`,
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: "`List` takes an array and a function that renders one row. It is virtualized: only the rows in view, plus a few on each side, are mounted, so a 10,000-row list costs about as much as a screenful. It is built on a [ScrollView](/docs/scroll-view), so it inherits the contained overscroll, the touch panning rules and the edge fade.",
    },
    {
      type: "p",
      text: "Use it when the row count is unbounded or large: a feed, search results, a contact list. For a handful of arbitrary children, use `ScrollView` directly; virtualization has a cost in complexity and buys nothing for twenty rows.",
    },
    {
      type: "note",
      tone: "warn",
      text: "A `List` needs a constrained height. With none, it grows to its content, every row counts as visible, and nothing is virtualized. There are two ways to give it one: a height in `className` (`h-full` inside a sized parent, `h-96`), or `fill` inside a flex parent that has a height. When the `List` is the only root element of a page the shell stretches it to the screen and neither is needed.",
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "data",
          type: "readonly T[]",
          required: true,
          description: "The rows. The component is generic over the item type.",
        },
        {
          name: "keyExtractor",
          type: "(item: T, index: number) => string",
          required: true,
          description:
            "A stable key for a row. Use an id from the data. An index-based key makes React reuse the wrong row state when rows are inserted or removed.",
        },
        {
          name: "renderItem",
          type: "(item: T, index: number) => ReactNode",
          required: true,
          description:
            "Renders one row. It runs for mounted rows only, and again whenever the window moves, so keep it cheap and keep row state that must survive scrolling outside the row.",
        },
        {
          name: "estimateSize",
          type: "number",
          default: "56",
          description:
            "Estimated row height in pixels. Each row is measured when it mounts and the real height replaces the estimate, so rows of different heights work. A close estimate keeps the scroll position steady while rows are first measured.",
        },
        {
          name: "overscan",
          type: "number",
          default: "6",
          description:
            "Rows mounted beyond the visible area on each side. Raise it if a hard fling shows blank space before rows paint; lower it if rows are expensive.",
        },
        {
          name: "emptyState",
          type: "ReactNode",
          description:
            "Rendered when `data` is empty, in place of the whole scroller. `className`, `fill` and `fade` do not apply to it, so size it yourself.",
        },
        {
          name: "onEndReached",
          type: "() => void",
          description:
            "Fired when the last row enters the mounted window. Wire infinite scroll here.",
        },
        {
          name: "fade",
          type: 'boolean | "start" | "end"',
          default: "false",
          description:
            "Dissolve the list's edges with a mask. `true` fades both ends. Each end fades only while there is more content that way. Forwarded to the underlying `ScrollView`.",
        },
        {
          name: "fadeSize",
          type: "string",
          default: '"2rem"',
          description:
            'How deep the fade reaches. Any CSS length or percentage: `"3rem"`, `"10%"`.',
        },
        {
          name: "className",
          type: "string",
          description:
            "Classes for the scroll surface: height, background, radius, padding.",
        },
        {
          name: "fill",
          type: "boolean",
          default: "false",
          description:
            "Grow to fill the parent flex line (`flex-1`). Use it when the list is one of several children of a sized flex column and should take the leftover space.",
        },
      ],
    },
    {
      type: "p",
      text: "These are all the props. `List` does not pass other attributes through, takes no `ref` and no `style`, and scrolls vertically only.",
    },
    { type: "h2", text: "Infinite scroll" },
    {
      type: "p",
      text: "`onEndReached` runs from an effect, once per arrival at the end. It does not fire per scroll event. It fires again when `data.length` changes while the end is still in the window, which is what keeps a short page loading until the viewport is full.",
    },
    {
      type: "code",
      label: "feed.tsx",
      lang: "tsx",
      code: `const [posts, setPosts] = useState<Post[]>(firstPage)
const loading = useRef(false)

const loadMore = useCallback(async () => {
  if (loading.current) return
  loading.current = true
  const next = await fetchPosts({ after: posts[posts.length - 1]?.id })
  setPosts((current) => [...current, ...next])
  loading.current = false
}, [posts])

<List
  data={posts}
  keyExtractor={(post) => post.id}
  renderItem={(post) => <PostRow post={post} />}
  onEndReached={loadMore}
  emptyState={<EmptyFeed />}
  fill
/>`,
    },
    {
      type: "ul",
      items: [
        "The effect depends on the identity of `onEndReached`. An inline arrow function is a new function every render, so while the end is in view it fires on every render. Wrap the handler in `useCallback` and guard against a request that is already running, as above.",
        "The mounted window includes the overscan, so the callback fires about `overscan` rows before the user reaches the last row. That is the head start for the next page.",
        "It also fires on mount when all the data fits in the window.",
      ],
    },
    { type: "h2", text: "What is not here" },
    {
      type: "p",
      text: "There are no header, footer or separator slots, no horizontal mode, no sticky section headers, and no imperative scroll-to-index. Draw a separator as a border on the row. Put a header above the list in a flex column and give the list `fill`. [PullToRefresh](/docs/pull-to-refresh) needs a ref to the scroll container, and `List` does not expose one, so the two cannot be combined today.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: 'The scroll surface carries `data-adaptv="list"` and takes your `className`. Its scroll axis, overscroll containment and touch panning are locked, so an `overflow-hidden` in `className` is dropped.',
    },
    {
      type: "p",
      text: "Each row you render sits inside a wrapper `<div data-index>` that is absolutely positioned, full width and moved with `translateY`. Two consequences: a row cannot size itself against its siblings, and vertical margins on your row element count toward its measured height, so `my-1` on a row works as spacing.",
    },
    {
      type: "note",
      tone: "warn",
      text: "Known defect, measured in Chromium: the inner spacer that should give the scroller the full height of the data is a flex child and is shrunk to the viewport height. The scrollable height is therefore the extent of the rows mounted right now, and it grows as more rows mount. Reading `scrollHeight`, or setting `scrollTop` past the mounted rows from your own code, does not reach the rest of the list.",
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Mouse wheel, trackpad and keyboard scrolling.",
        },
        { target: "Mobile web", status: "yes" },
        { target: "Installed PWA", status: "yes" },
        {
          target: "iOS",
          status: "yes",
          note: "Momentum scrolling is long here, so this is the target where a low `overscan` shows as blank bands during a fling.",
        },
        {
          target: "Android",
          status: "yes",
          note: "A low-end WebView is where an expensive `renderItem` shows first.",
        },
      ],
    },
  ],
}

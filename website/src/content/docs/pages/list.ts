import { ListDemo } from "@/components/docs-demos/list-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "list",
  title: "List",
  summary: "A long vertical list that mounts only the visible rows.",
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
      text: "Pass `data`, a `keyExtractor` and a `renderItem`. `List` mounts only the rows in view, plus a few on each side. It is built on [ScrollView](/docs/scroll-view). For a few rows, use `ScrollView` directly.",
    },
    {
      type: "note",
      tone: "warn",
      text: "A `List` needs a set height. Give `className` a height, or use `fill` in a flex parent that has a height. Without one, every row mounts.",
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "data",
          type: "readonly T[]",
          required: true,
          description: "The rows.",
        },
        {
          name: "keyExtractor",
          type: "(item: T, index: number) => string",
          required: true,
          description: "A stable key for a row. Use an id, not the index.",
        },
        {
          name: "renderItem",
          type: "(item: T, index: number) => ReactNode",
          required: true,
          description: "Renders one row. Keep it cheap.",
        },
        {
          name: "estimateSize",
          type: "number",
          default: "56",
          description:
            "Estimated row height in pixels. Each row is measured when it mounts.",
        },
        {
          name: "overscan",
          type: "number",
          default: "6",
          description: "Rows mounted beyond the view on each side.",
        },
        {
          name: "emptyState",
          type: "ReactNode",
          description:
            "Shown in place of the list when `data` is empty. Size it yourself.",
        },
        {
          name: "onEndReached",
          type: "() => void",
          description: "Called when the last row enters the mounted window.",
        },
        {
          name: "fade",
          type: 'boolean | "start" | "end"',
          default: "false",
          description:
            "Fade the edges. `true` fades both. An end fades only while there is more content.",
        },
        {
          name: "fadeSize",
          type: "string",
          default: '"2rem"',
          description: "Depth of the fade. Any CSS length or percentage.",
        },
        {
          name: "className",
          type: "string",
          description: "Classes for the scroll surface.",
        },
        {
          name: "fill",
          type: "boolean",
          default: "false",
          description: "Fill the parent flex line.",
        },
      ],
    },
    {
      type: "p",
      text: "These are all the props. `List` has no `ref` and no `style`. It scrolls vertically only. It has no header, footer or separator slots, and it cannot go inside [PullToRefresh](/docs/pull-to-refresh).",
    },
    { type: "h2", text: "Infinite scroll" },
    {
      type: "p",
      text: "`onEndReached` runs once each time the end comes into the window. It runs again when `data.length` changes while the end is still in view. Wrap the handler in `useCallback`. An inline function runs on every render. Guard against a request that is already running.",
    },
    {
      type: "code",
      label: "feed.tsx",
      lang: "tsx",
      code: `const loadMore = useCallback(async () => {
  if (loading.current) return
  loading.current = true
  const next = await fetchPosts({ after: posts.at(-1)?.id })
  setPosts((current) => [...current, ...next])
  loading.current = false
}, [posts])

<List
  data={posts}
  keyExtractor={(post) => post.id}
  renderItem={(post) => <PostRow post={post} />}
  onEndReached={loadMore}
  fill
/>`,
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: 'The scroll surface has `data-adaptv="list"` and takes your `className`. Its scroll axis, overscroll and touch rules are locked. Each row sits in an absolutely positioned wrapper, so a row cannot size itself against its siblings. Vertical margins on a row count toward its height. The scrollable height is the extent of the rows mounted now, so `scrollHeight` is not the full list height.',
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Wheel, trackpad and keyboard.",
        },
        { target: "Mobile web", status: "yes" },
        { target: "Installed PWA", status: "yes" },
        {
          target: "iOS",
          status: "yes",
          note: "A low `overscan` can show blank bands in a long fling.",
        },
        {
          target: "Android",
          status: "yes",
          note: "A slow `renderItem` shows first on low-end devices.",
        },
      ],
    },
  ],
}

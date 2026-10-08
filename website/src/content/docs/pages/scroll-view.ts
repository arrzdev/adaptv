import { ScrollViewDemo } from "@/components/docs-demos/scroll-view-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "scroll-view",
  title: "ScrollView",
  summary:
    "A scrolling pane with one axis, contained overscroll and an optional edge fade.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { ScrollView } from "adaptv/components"',
  source: "src/components/scroll-view.tsx",
  blocks: [
    {
      type: "demo",
      component: ScrollViewDemo,
      code: `import { ScrollView } from "adaptv/components"

<ScrollView fade fadeSize="2.5rem" className="h-44 gap-2 rounded-xl p-3">
  {rows.map((row) => (
    <Row key={row.id} {...row} />
  ))}
</ScrollView>

<ScrollView horizontal fade="end" className="gap-2">
  {chips.map((chip) => (
    <Chip key={chip} className="shrink-0">{chip}</Chip>
  ))}
</ScrollView>`,
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: "In an adaptv app the document does not scroll. Panes do (see [The frame](/docs/the-frame)). `ScrollView` is a flex `div`: a column, or a row when `horizontal`. It scrolls on one axis only. Something must limit its height. Make it the only root element of a route, add `fill` in a flex parent that has a height, or set a height such as `h-40`. In a horizontal scroller, give children `shrink-0`.",
    },
    {
      type: "code",
      label: "inbox.page.tsx",
      lang: "tsx",
      code: `// a fixed header, and the rest scrolls
<View>
  <Header />
  <ScrollView fill className="px-4">{rows}</ScrollView>
</View>`,
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "horizontal",
          type: "boolean",
          default: "false",
          description: "Scroll on the x axis. Children lay out in a row.",
        },
        {
          name: "fill",
          type: "boolean",
          default: "false",
          description:
            "Take the leftover space of a flex parent. Do not combine with a set height.",
        },
        {
          name: "scrollEnabled",
          type: "boolean",
          default: "true",
          description: "`false` stops scrolling and keeps the scroll position.",
        },
        {
          name: "showsVerticalScrollIndicator",
          type: "boolean",
          default: "false",
          description:
            "Show the scrollbar of a vertical scroller. It overrides `ui.hideScrollbars` for this scroller.",
        },
        {
          name: "showsHorizontalScrollIndicator",
          type: "boolean",
          default: "false",
          description: "The same for a `horizontal` scroller.",
        },
        {
          name: "fade",
          type: 'boolean | "start" | "end"',
          default: "false",
          description:
            "Fade the content at the edges. `true` fades both ends. An end fades only while there is more content that way.",
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
          description:
            "Lands on the scrolling `div`. Overflow, overscroll, touch-action and scrollbar classes are locked.",
        },
        {
          name: "ref",
          type: "Ref<HTMLDivElement>",
          description:
            "The scrolling element. Use DOM methods such as `scrollTo`.",
        },
      ],
    },
    {
      type: "p",
      text: "Other `div` attributes pass through, including `onScroll`, `style` and `data-*`.",
    },
    { type: "h2", text: "Scrollbars" },
    {
      type: "p",
      text: "Scrollbars are hidden on every target. The `ui.hideScrollbars` key in [adaptv.config.ts](/docs/config) hides them app-wide. The indicator props override it for one scroller.",
    },
    { type: "h2", text: "Edge fade" },
    {
      type: "p",
      text: "`fade` is a CSS mask, so no colour is needed. The mask also hides the element's own background and border. Put the background on a wrapper. If the content fits, nothing fades.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: "`className` can change `flex`, `min-h-0`, `min-w-0` and `flex-col`. The overflow, overscroll, touch-action and scrollbar classes win. `overflow-hidden` does not stop scrolling. Use `scrollEnabled={false}`. Touch panning stays open on both axes, so a swipe on a horizontal strip still moves the page.",
    },
    {
      type: "table",
      head: ["Attribute", "Value", "When"],
      rows: [
        ["`data-adaptv`", '`"scroll-view"`', "Always."],
        ["`data-scroll-view`", '`"x"` or `"y"`', "Always."],
        [
          "`data-fade`",
          '`"both"`, `"start"` or `"end"`',
          "When `fade` is set.",
        ],
      ],
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "No scrollbar unless you ask for one.",
        },
        { target: "Mobile web", status: "yes" },
        { target: "Installed PWA", status: "yes" },
        {
          target: "iOS",
          status: "yes",
          note: "The pane rubber-bands. The page behind it does not.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Chromium may draw its overscroll glow.",
        },
      ],
    },
  ],
}

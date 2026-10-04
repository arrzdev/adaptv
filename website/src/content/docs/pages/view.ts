import { ViewDemo } from "@/components/docs-demos/view-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "view",
  title: "View",
  summary:
    "The base box: a `<div>` that is a flex column by default, never scrolls, and knows about safe areas.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { View } from "@arrzdev/adaptv/components"',
  source: "src/components/view.tsx",
  blocks: [
    {
      type: "demo",
      component: ViewDemo,
      code: `import { View } from "@arrzdev/adaptv/components"

<View className="gap-2">
  <Tile>column</Tile>
  <Tile>is the default</Tile>
</View>

<View row className="gap-2">
  <Tile>row</Tile>
  <Tile>side</Tile>
  <Tile>by side</Tile>
</View>

<View center className="h-20 rounded-lg border border-dashed border-gray-300">
  center
</View>`,
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: "`View` renders a `<div>` with `display: flex` and `flex-direction: column`. A column is the default because a screen is a column; pass `row` for the other axis. Layout behaviour is four props (`row`, `center`, `fill`, `safe`) and everything about the look is `className`.",
    },
    {
      type: "p",
      text: "A `View` never scrolls. When content can outgrow its box, use [ScrollView](/docs/scroll-view); for a long list of similar rows use [List](/docs/list), which virtualises.",
    },
    { type: "h3", text: "As the root of a route" },
    {
      type: "p",
      text: "adaptv's document never scrolls: the shell gives each route a fixed screen and the route fills it (see [The frame](/docs/the-frame)). The shell stretches a route's only root element to that screen, so a bare `<View>` at the top of a page is already full height. You do not need `fill`, `h-full` or `h-screen` there.",
    },
    {
      type: "code",
      label: "settings.page.tsx",
      lang: "tsx",
      code: `import { ScrollView, View } from "@arrzdev/adaptv/components"

export default function SettingsPage() {
  return (
    <View safe="top">
      <Header />
      {/* one of several children, and the one that takes the slack */}
      <ScrollView fill className="px-4">
        <Rows />
      </ScrollView>
      <View safe="bottom" className="px-4 pt-3">
        <SaveButton />
      </View>
    </View>
  )
}`,
    },
    {
      type: "note",
      tone: "warn",
      text: "The stretch applies to an **only child**. If a page returns a fragment with two root elements, neither is stretched and the page collapses to its content height. Wrap them in one `View`.",
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "row",
          type: "boolean",
          default: "false",
          description:
            "Lay children out in a row (`flex-row`) instead of a column.",
        },
        {
          name: "center",
          type: "boolean",
          default: "false",
          description:
            "Center children on both axes (`items-center justify-center`).",
        },
        {
          name: "fill",
          type: "boolean",
          default: "false",
          description:
            "Grow to take the leftover space of a flex parent: `flex-1` plus `min-h-0`, so a scroller nested inside can still shrink and scroll. Not needed on a route's root element.",
        },
        {
          name: "safe",
          type: '"top" | "bottom" | "x" | "y" | "all"',
          description:
            "Pad the named edge(s) by the device safe-area inset. The inset is `0` in a browser tab and the real notch or home-indicator size in an installed PWA and on native. See [Safe areas](/docs/safe-areas).",
        },
        {
          name: "className",
          type: "string",
          description:
            'Merged over the flex defaults, so `className="grid"` or `className="flex-row-reverse"` wins. It cannot remove the padding `safe` adds.',
        },
        {
          name: "ref",
          type: "Ref<HTMLDivElement>",
          description: "The underlying `<div>`.",
        },
      ],
    },
    {
      type: "p",
      text: "Every other `<div>` attribute (`style`, `id`, `onScroll`, `aria-*`, `data-*`, event handlers) passes through unchanged.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: "Classes resolve in three tiers: adaptv's defaults, then your `className`, then the classes adaptv locks. Conflicts are resolved per Tailwind group, so your `flex-row` replaces the default `flex-col` instead of fighting it in the stylesheet.",
    },
    {
      type: "table",
      head: ["Tier", "Classes", "Can `className` override it?"],
      rows: [
        [
          "Default",
          "`flex`, `flex-col` or `flex-row`, `items-center justify-center` with `center`, `min-h-0 flex-1` with `fill`",
          "Yes",
        ],
        [
          "Locked",
          "`pt-safe`, `pb-safe`, `px-safe`, `py-safe` or `p-safe`, from `safe`",
          'No. `safe="top"` with `className="pt-0"` still pads the top.',
        ],
      ],
    },
    {
      type: "p",
      text: 'Because the safe-area padding owns that edge, add your own spacing on a different element, or skip the prop and use an offset utility instead: `className="pt-safe-offset-4"` is the inset plus `1rem`, and `pt-safe-or-4` is whichever of the two is larger.',
    },
    {
      type: "p",
      text: 'Every `View` carries `data-adaptv="view"`, so global CSS can target all of them without an import.',
    },
    { type: "h2", text: "Where it works" },
    {
      type: "p",
      text: "`View` is plain CSS and behaves the same on all targets. Only the value `safe` resolves to differs.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "`safe` resolves to `0`.",
        },
        {
          target: "Mobile web",
          status: "yes",
          note: "`safe` resolves to `0` in a browser tab, where the browser's own bars already cover the insets.",
        },
        {
          target: "Installed PWA",
          status: "yes",
          note: "`safe` is the real inset.",
        },
        { target: "iOS", status: "yes", note: "`safe` is the real inset." },
        {
          target: "Android",
          status: "yes",
          note: "`safe` is the real inset. The native shell draws edge to edge and supplies the values.",
        },
      ],
    },
  ],
}

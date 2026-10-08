import { ViewDemo } from "@/components/docs-demos/view-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "view",
  title: "View",
  summary:
    "A `<div>` that is a flex column by default. It never scrolls and can pad for safe areas.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { View } from "adaptv/components"',
  source: "src/components/view.tsx",
  blocks: [
    {
      type: "demo",
      component: ViewDemo,
      code: `import { View } from "adaptv/components"

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
      text: "`View` is a `<div>` with `display: flex`. It is a column by default. A `View` never scrolls. For overflow use [ScrollView](/docs/scroll-view). For long lists use [List](/docs/list).",
    },
    {
      type: "p",
      text: "A bare `View` at the top of a route already fills the screen, so you do not need `fill` or `h-screen` there (see [The frame](/docs/the-frame)). This works only for an **only child**. If a route returns two root elements, wrap them in one `View`.",
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "row",
          type: "boolean",
          default: "false",
          description: "Lay out children in a row.",
        },
        {
          name: "center",
          type: "boolean",
          default: "false",
          description: "Center children on both axes.",
        },
        {
          name: "fill",
          type: "boolean",
          default: "false",
          description:
            "Take the free space of a flex parent (`flex-1 min-h-0`).",
        },
        {
          name: "safe",
          type: '"top" | "bottom" | "x" | "y" | "all"',
          description:
            "Pad the named edges by the device safe-area inset. See [Safe areas](/docs/safe-areas).",
        },
        {
          name: "className",
          type: "string",
          description:
            "Merged over the flex defaults, so `flex-row-reverse` wins. It cannot remove the padding that `safe` adds.",
        },
      ],
    },
    {
      type: "p",
      text: "Every other `<div>` attribute passes through, including `ref`.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: 'Every `View` has `data-adaptv="view"`. Your `className` overrides the defaults. The `safe` padding is locked: `safe="top"` with `className="pt-0"` still pads the top. To add your own space, skip `safe` and use `pt-safe-offset-4` (inset plus 1rem) or `pt-safe-or-4` (the larger of the two).',
    },
    { type: "h2", text: "Where it works" },
    {
      type: "p",
      text: "The same on every target. Only the `safe` value differs. It is `0` in a browser tab and the real inset in an installed PWA, on iOS and on Android.",
    },
  ],
}

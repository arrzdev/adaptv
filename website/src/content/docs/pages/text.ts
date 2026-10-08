import { TextDemo } from "@/components/docs-demos/text-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "text",
  title: "Text",
  summary:
    "A run of text that can clamp to a number of lines, stay selectable and follow the iOS text size.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { Text } from "adaptv/components"',
  source: "src/components/text.tsx",
  blocks: [
    {
      type: "demo",
      component: TextDemo,
      code: `import { Text, View } from "adaptv/components"

<View className="rounded-xl bg-white p-4">
  <Text
    render={<p />}
    selectable
    numberOfLines={clamped ? 2 : undefined}
    className="text-[15px] leading-relaxed text-gray-900"
  >
    {body}
  </Text>
</View>`,
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: "You can show text without `Text`. Use it for `numberOfLines`, `selectable` or `scaleWithSystem`. It has no default look: size and colour come from `className`. It renders a `<span>`. Use `render` for a heading, paragraph or label.",
    },
    {
      type: "code",
      label: "text.tsx",
      lang: "tsx",
      code: `<Text render={<h1 />} className="text-2xl font-semibold">Inbox</Text>

<Text numberOfLines={2}>{email.body}</Text>`,
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "numberOfLines",
          type: "number",
          description:
            "Cut the text after this many lines and add an ellipsis. Omit it for no limit.",
        },
        {
          name: "selectable",
          type: "boolean",
          default: "false",
          description:
            "Let the user select this text when the app has turned selection off (`ui.noSelect` in [adaptv.config.ts](/docs/config)).",
        },
        {
          name: "scaleWithSystem",
          type: "boolean",
          default: "false",
          description:
            "Scale the font size and line height by the iOS text-size setting. The app reads the setting when it loads, so a change shows after a reload. It does nothing on other targets.",
        },
        {
          name: "render",
          type: "ReactElement",
          description:
            "The element to render instead of a `<span>`, for example `render={<p />}`.",
        },
        {
          name: "className",
          type: "string",
          description: "All of the look.",
        },
      ],
    },
    {
      type: "p",
      text: "Every other `<span>` attribute passes through, including `ref`.",
    },
    {
      type: "note",
      tone: "warn",
      text: "Put vertical padding on a wrapper, not on a `Text` with `numberOfLines`. Padding lets a hidden line show.",
    },
    {
      type: "p",
      text: "To clamp an element that is not a `Text`, use `textClampStyle(n)` from `adaptv/components`. It returns the clamp style, or `undefined` when `n` is 0, negative or missing.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: '`Text` sets `data-adaptv="text"`, and `data-scale-with-system` when `scaleWithSystem` is on. `className` lands on the rendered element. The clamp and the `selectable` class are locked.',
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "Clamp works. `scaleWithSystem` does nothing.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "As desktop. `scaleWithSystem` works in iOS Safari.",
        },
        { target: "Installed PWA", status: "yes" },
        { target: "iOS", status: "yes" },
        {
          target: "Android",
          status: "partial",
          note: "`scaleWithSystem` does nothing. Android font scale is not read.",
        },
      ],
    },
  ],
}

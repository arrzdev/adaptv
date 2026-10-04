import { TextDemo } from "@/components/docs-demos/text-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "text",
  title: "Text",
  summary:
    "A run of text that can clamp to N lines, stay selectable inside an installed app, and follow the iOS text-size setting.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { Text } from "@arrzdev/adaptv/components"',
  source: "src/components/text.tsx",
  blocks: [
    {
      type: "demo",
      component: TextDemo,
      code: `import { Text, View } from "@arrzdev/adaptv/components"

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
      text: "You do not need `Text` to put words on the screen. A `<span>`, a `<p>` or a bare string inside a [View](/docs/view) all work. Reach for `Text` when you need one of the three things it owns:",
    },
    {
      type: "ul",
      items: [
        "**`numberOfLines`**: a multi-line ellipsis that works in both native webviews.",
        "**`selectable`**: text the user can copy even where the app has turned selection off.",
        "**`scaleWithSystem`**: text that follows the iOS system text-size setting.",
      ],
    },
    {
      type: "p",
      text: "`Text` has no default look. Size, colour, weight and leading are all `className`; there is no `size` or `variant` prop.",
    },
    {
      type: "p",
      text: "It renders a `<span>`, so one `Text` nests inside another as valid markup (a bold word inside a sentence). When the thing is a paragraph, a heading or a label, say so with `render`.",
    },
    {
      type: "code",
      label: "text.tsx",
      lang: "tsx",
      code: `<Text className="text-gray-500">Draft saved</Text>

<Text render={<h1 />} className="text-2xl font-semibold">Inbox</Text>

<Text>
  Signed in as <Text className="font-semibold">{user.name}</Text>
</Text>`,
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "numberOfLines",
          type: "number",
          description:
            "Truncate to this many lines with an ellipsis. `0` or omitted means no clamp.",
        },
        {
          name: "selectable",
          type: "boolean",
          default: "false",
          description:
            "Let the user select this text where the app-wide `ui.noSelect` reset is live. A `select-none` in the same `className` does not cancel it.",
        },
        {
          name: "scaleWithSystem",
          type: "boolean",
          default: "false",
          description:
            "Multiply the element's font size and line height by the iOS Dynamic Type factor. Does nothing off iOS.",
        },
        {
          name: "render",
          type: "ReactElement",
          description:
            'The element to render instead of a `<span>`: `render={<p />}`, `render={<label htmlFor="email" />}`. It receives `Text`\'s props, merged classes and children. Element only; there is no function form.',
        },
        {
          name: "className",
          type: "string",
          description:
            "All of the look. Merged after any `className` on the `render` element, so `Text`'s own wins a conflict.",
        },
        {
          name: "ref",
          type: "Ref<HTMLSpanElement>",
          description: "The rendered element, whichever one `render` made it.",
        },
      ],
    },
    {
      type: "p",
      text: "Every other `<span>` attribute passes through to the rendered element.",
    },
    { type: "h2", text: "Clamping lines" },
    {
      type: "p",
      text: "The standard `line-clamp` CSS property has not shipped in WKWebView or Android WebView, so `numberOfLines` applies the WebKit form as an inline style: `display: -webkit-box`, `-webkit-box-orient: vertical`, `-webkit-line-clamp: N` and `overflow: hidden`. Being inline, it holds even if your `className` sets `flex` or `overflow-auto`.",
    },
    {
      type: "note",
      tone: "warn",
      text: "Put vertical padding on a wrapper, never on the clamped `Text`. `overflow` clips at the padding box, so with `pb-6` on the clamped element the line that should have disappeared stays visible inside the padding.",
    },
    {
      type: "code",
      label: "preview.tsx",
      lang: "tsx",
      code: `// correct: the padding is on the wrapper
<View className="p-4">
  <Text numberOfLines={2}>{email.body}</Text>
</View>

// wrong: a third line shows inside the bottom padding
<Text numberOfLines={2} className="p-4">{email.body}</Text>`,
    },
    {
      type: "p",
      text: "To clamp an element that is not a `Text`, the same style object is exported as `textClampStyle(numberOfLines)`. It returns `undefined` for `0`, `undefined` or a negative number.",
    },
    {
      type: "code",
      label: "clamp-anything.tsx",
      lang: "tsx",
      code: `import { textClampStyle } from "@arrzdev/adaptv/components"

<blockquote style={textClampStyle(3)}>{quote}</blockquote>`,
    },
    { type: "h2", text: "Selection" },
    {
      type: "p",
      text: "adaptv can turn text selection off across the app, because in an installed app a selection is usually a mis-tap. That is the `ui.noSelect` key in [adaptv.config.ts](/docs/config), and by default it applies in an installed PWA and on native but not in a browser tab. Inputs, textareas and `contenteditable` elements always stay selectable.",
    },
    {
      type: "p",
      text: '`selectable` opts one run of text back in: an error message, an order number, an address. It applies the `selectable` utility class, which you can also write yourself on any element (`className="selectable"`) to open up a whole region.',
    },
    { type: "h2", text: "System text size" },
    {
      type: "p",
      text: "iOS exposes the user's text-size setting to web content only through a system font keyword. adaptv measures it once per page load and turns it into a factor: `1` at the default size, larger at the bigger accessibility sizes. With `scaleWithSystem`, `Text` reads the font size your classes produced and multiplies it, and does the same for the line height. `text-4xl` stays `text-4xl × factor`, so your type scale keeps its proportions.",
    },
    {
      type: "ul",
      items: [
        "The factor is read at page load. A change to the setting takes effect after the app reloads.",
        "The scaled size is written as inline `font-size` and `line-height` in pixels, before first paint, and is recomputed when `className` changes.",
        "A `line-height` of `normal` is left alone.",
        "Android's font-scale setting is not read. On Android and on desktop the factor is `1` and no inline size is written.",
      ],
    },
    { type: "h2", text: "Styling" },
    {
      type: "table",
      head: ["Attribute", "When"],
      rows: [
        [
          '`data-adaptv="text"`',
          "Always. Target every `Text` from global CSS with no import.",
        ],
        [
          "`data-scale-with-system`",
          "`scaleWithSystem` is on. A marker only; the sizing is done in JavaScript.",
        ],
      ],
    },
    {
      type: "p",
      text: "`className` and `style` land on the rendered element. Two things are locked over them: the `selectable` class when the prop is set, and the four clamp declarations when `numberOfLines` is set.",
    },
    { type: "h2", text: "Accessibility" },
    {
      type: "p",
      text: 'A `<span>` has no role. Headings, paragraphs and labels should be real ones: `render={<h2 />}`, `render={<p />}`, `render={<label htmlFor="…" />}`. Clamped text is still read in full by a screen reader, because the clamp is visual only.',
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: 'Clamp works. All text is selectable by default, so `selectable` changes nothing unless `ui.noSelect` is `"all"`. `scaleWithSystem` does nothing.',
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "As desktop. In iOS Safari `scaleWithSystem` does scale, because it is the same engine as the native app.",
        },
        {
          target: "Installed PWA",
          status: "yes",
          note: "`ui.noSelect` is live by default, so only `selectable` text selects. `scaleWithSystem` scales on iOS.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "All three. A text-size change shows after the app is relaunched.",
        },
        {
          target: "Android",
          status: "partial",
          note: "Clamp and selection work. `scaleWithSystem` does nothing; the Android font-scale setting is not read.",
        },
      ],
    },
  ],
}

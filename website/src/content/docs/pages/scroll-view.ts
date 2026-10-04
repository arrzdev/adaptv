import { ScrollViewDemo } from "@/components/docs-demos/scroll-view-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "scroll-view",
  title: "ScrollView",
  summary:
    "A scroll surface that owns one axis, keeps its overscroll to itself, hides its scrollbar and can dissolve its edges.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { ScrollView } from "@arrzdev/adaptv/components"',
  source: "src/components/scroll-view.tsx",
  blocks: [
    {
      type: "demo",
      component: ScrollViewDemo,
      code: `import { ScrollView } from "@arrzdev/adaptv/components"

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
      text: "In an adaptv app the document never scrolls; panes do (see [The frame](/docs/the-frame)). `ScrollView` is that pane. It is a plain `<div>` you can style freely, with the parts of a scroller that are easy to get wrong already decided: one scroll axis, the other pinned, overscroll contained, and touch gestures passed through correctly.",
    },
    {
      type: "p",
      text: "Like [View](/docs/view), it is a flex container: a column when vertical, a row when `horizontal`. `gap-*` works directly on it. In a horizontal scroller give the children `shrink-0`, or flexbox squeezes them to fit and nothing overflows.",
    },
    { type: "h3", text: "Something has to bound its height" },
    {
      type: "p",
      text: "A scroller scrolls only when its box is smaller than its content. There are three ways to get that box:",
    },
    {
      type: "ul",
      items: [
        "**It is the route's root element.** The shell stretches a page's only root element to the screen, so `<ScrollView>` alone is a full-screen scrolling page.",
        "**`fill`**, when it is one of several children of a flex parent that has a height. It takes the leftover space.",
        '**An explicit size**: `className="h-40"` or `max-h-64`.',
      ],
    },
    {
      type: "code",
      label: "inbox.page.tsx",
      lang: "tsx",
      code: `// the whole page scrolls
export default function InboxPage() {
  return <ScrollView className="px-4">{rows}</ScrollView>
}

// a fixed header, and the rest scrolls
export default function InboxPage() {
  return (
    <View>
      <Header />
      <ScrollView fill className="px-4">{rows}</ScrollView>
    </View>
  )
}`,
    },
    {
      type: "note",
      tone: "warn",
      text: "If a `ScrollView` renders at its full content height and does not scroll, nothing is bounding it. Add `fill` (and check the parent has a height) or give it a height. `fill` and an explicit height are alternatives; do not combine them.",
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "horizontal",
          type: "boolean",
          default: "false",
          description:
            "Scroll on the x axis and lay children out in a row. The y axis is clipped.",
        },
        {
          name: "fill",
          type: "boolean",
          default: "false",
          description:
            "Grow to take the leftover space of a flex parent (`flex-1`). Not needed on a route's root element.",
        },
        {
          name: "scrollEnabled",
          type: "boolean",
          default: "true",
          description:
            "`false` stops scrolling and clips the content (`overflow: hidden`) without unmounting anything. The scroll position is kept.",
        },
        {
          name: "showsVerticalScrollIndicator",
          type: "boolean",
          default: "false",
          description:
            "Show the scrollbar of a vertical scroller. `true` also overrides the app-wide `ui.hideScrollbars` setting for this scroller.",
        },
        {
          name: "showsHorizontalScrollIndicator",
          type: "boolean",
          default: "false",
          description:
            "The same, for a `horizontal` scroller. Only the prop that matches the scroll axis is read.",
        },
        {
          name: "fade",
          type: 'boolean | "start" | "end"',
          default: "false",
          description:
            "Dissolve the content at the scroller's edges. `true` fades both ends. `start` is the top of a vertical scroller and the inline start of a horizontal one; `end` is the opposite edge.",
        },
        {
          name: "fadeSize",
          type: "string",
          default: '"2rem"',
          description:
            'How deep the fade reaches. Any CSS length or percentage: `"3rem"`, `"48px"`, `"10%"`.',
        },
        {
          name: "className",
          type: "string",
          description:
            "Lands on the scrolling `<div>`. Padding, gap, background and size are yours; the overflow, overscroll, touch-action and scrollbar classes are locked.",
        },
        {
          name: "ref",
          type: "Ref<HTMLDivElement>",
          description: "The scrolling element itself. See Ref below.",
        },
      ],
    },
    {
      type: "p",
      text: "Every other `<div>` attribute passes through, including `onScroll`, `style` and `data-*`.",
    },
    { type: "h2", text: "Scroll indicators" },
    {
      type: "p",
      text: "Scrollbars are hidden by default on every target, so the same screen looks the same in a desktop browser and on a phone. Opt a scroller back in with `showsVerticalScrollIndicator` when the indicator carries information, such as a long settings pane on desktop.",
    },
    {
      type: "p",
      text: 'Separately, the `ui.hideScrollbars` key in [adaptv.config.ts](/docs/config) hides every scrollbar in the app, including ones on elements that are not a `ScrollView`. Its default is `"all"`: every target, browser tabs included. The prop wins over that setting for its own scroller, so `showsVerticalScrollIndicator` is how you get one scrollbar back without changing the app-wide setting.',
    },
    { type: "h2", text: "Edge fade" },
    {
      type: "p",
      text: "`fade` masks the content to transparent at the edge, so whatever is behind the scroller shows through. There is no colour to pass and nothing to keep in step with your theme. It works over an image or a gradient and in dark mode without changes.",
    },
    {
      type: "p",
      text: "Each end fades only while there is content in that direction. Parked at the top, the top fade is off and the first row is fully crisp; it ramps to full strength over the first `24px` of scroll. The same happens at the bottom. If the content fits without scrolling, nothing fades.",
    },
    {
      type: "code",
      label: "fade.tsx",
      lang: "tsx",
      code: `<ScrollView fade>{content}</ScrollView>
<ScrollView fade fadeSize="3rem">{content}</ScrollView>
<ScrollView horizontal fade="end">{chips}</ScrollView>`,
    },
    {
      type: "note",
      text: "The fade is a CSS mask on the scrolling element, so it also masks that element's own background and border. To keep a card's background solid while its content fades, put the background on a wrapper and the `ScrollView` inside it. If you need a coloured gradient over the content (fading into an opaque toolbar), draw it yourself with a positioned `<div>`.",
    },
    { type: "h2", text: "What it sets, and why" },
    {
      type: "table",
      head: ["Behaviour", "How", "Why"],
      rows: [
        [
          "One scroll axis",
          "`overflow-y-auto` + `overflow-x-hidden` (swapped when `horizontal`)",
          "Setting overflow on one axis turns the other from `visible` into `auto`. Without the pin, a child that overflows sideways makes a vertical list wobble.",
        ],
        [
          "Overscroll containment",
          "`overscroll-behavior: contain` on the scroll axis",
          "Reaching the end of an inner scroller does not start scrolling, or rubber-banding, whatever is behind it.",
        ],
        [
          "Axis lock",
          "`touch-action: pan-x pan-y pinch-zoom`",
          "Both pan axes are allowed on purpose. `touch-action` restricts the whole gesture that starts on the element, so a horizontal strip limited to `pan-x` would swallow a vertical swipe and the page behind it would not move. The browser locks a drag to its dominant direction itself: a mostly horizontal drag moves the strip and not the page.",
        ],
        [
          "No layer hints",
          "No `will-change`, no `translate3d`",
          "Both engines already composite scrollers. A transform hint would also make the scroller the containing block for `position: fixed` children, which breaks them.",
        ],
      ],
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: '`className` lands on the scrolling element. The defaults `flex`, `min-h-0`, `min-w-0` and `flex-col` can be overridden (`className="block"` is fine). The overflow, overscroll, touch-action and scrollbar classes are applied last and win: `className="overflow-hidden"` does not stop a `ScrollView` from scrolling. Use `scrollEnabled={false}` for that.',
    },
    {
      type: "table",
      head: ["Attribute", "Value", "When"],
      rows: [
        ["`data-adaptv`", '`"scroll-view"`', "Always."],
        ["`data-scroll-view`", '`"x"` or `"y"`', "Always. The scroll axis."],
        [
          "`data-fade`",
          '`"both"`, `"start"` or `"end"`',
          "When `fade` is set.",
        ],
      ],
    },
    {
      type: "p",
      text: "While `fade` is on, the component writes `--fade-start` and `--fade-end` (each `0` to `1`) on the element as it scrolls. They are internal to the mask; set the depth with `fadeSize`.",
    },
    { type: "h2", text: "Ref" },
    {
      type: "p",
      text: "`ref` gives you the scrolling `<div>`. There is no imperative handle of adaptv's own: scroll with the DOM methods.",
    },
    {
      type: "code",
      label: "scroll-to-top.tsx",
      lang: "tsx",
      code: `const scroller = useRef<HTMLDivElement>(null)

<ScrollView ref={scroller} fill>{rows}</ScrollView>

<Button onClick={() => scroller.current?.scrollTo({ top: 0, behavior: "smooth" })}>
  <Button.Text>Back to top</Button.Text>
</Button>`,
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "No scrollbar unless you ask for one. Wheel, trackpad and keyboard scrolling are the browser's own.",
        },
        { target: "Mobile web", status: "yes" },
        {
          target: "Installed PWA",
          status: "yes",
          note: "`showsVerticalScrollIndicator` wins over the app-wide `ui.hideScrollbars` reset here too.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "The scroller rubber-bands at its ends; the page behind it does not. Fade strengths are clamped, so an overscrolled edge does not flicker.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Chromium may draw its overscroll glow at the end of the scroller. That is the platform's affordance; the scroll still does not chain to the page.",
        },
      ],
    },
    { type: "h2", text: "Related" },
    {
      type: "ul",
      items: [
        "[List](/docs/list) for long, virtualised lists. It is built on `ScrollView`.",
        "[PullToRefresh](/docs/pull-to-refresh) adds a pull gesture at the top of a scroller.",
        "[AvoidKeyboard](/docs/avoid-keyboard) is its own scroller for forms: it makes room for the on-screen keyboard and keeps the focused field visible. Do not nest it around a `ScrollView`.",
      ],
    },
  ],
}

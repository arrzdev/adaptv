import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "the-frame",
  title: "The frame",
  summary: "Write a page that fills the screen and scrolls inside it.",
  blocks: [
    {
      type: "p",
      text: "The shell gives every page a fixed frame the size of the screen. The document itself never scrolls. Your page fills the frame and scrolls inside it, in a [ScrollView](/docs/scroll-view) or a [List](/docs/list).",
    },
    { type: "h2", text: "Write a page" },
    {
      type: "ol",
      items: [
        "Return one root element: a `ScrollView` for a page that scrolls, or a `View` for a fixed layout.",
        "Do not write `h-screen`, `100vh` or `100dvh`. The shell stretches your root to fill the frame.",
        "Use `fill` on inner boxes that must take the remaining space.",
        "Pad the edges with `safe` (see [Safe areas](/docs/safe-areas)).",
      ],
    },
    {
      type: "code",
      label: "inbox.tsx",
      lang: "tsx",
      code: `import { ScrollView, View } from "adaptv/components"

// Header and tab bar stay. The middle scrolls.
// Header, Messages and TabBar are your own components.
function Inbox() {
  return (
    <View>
      <View safe="top" className="px-4 pb-2">
        <Header />
      </View>
      <ScrollView fill>
        <Messages />
      </ScrollView>
      <View safe="bottom">
        <TabBar />
      </View>
    </View>
  )
}`,
    },
    {
      type: "p",
      text: 'The shell stretches the frame\'s only child. If a route returns two root elements, neither stretches. Wrap them in one `View`. To stop a root from filling, add `className="flex-none"`.',
    },
    { type: "h2", text: "Things that work differently" },
    {
      type: "ul",
      items: [
        "`window.scrollTo`, `window.scrollY` and `window` scroll listeners do nothing. Put a `ref` and `onScroll` on the `ScrollView`.",
        "A `#hash` link does not scroll. Call `document.getElementById(id)?.scrollIntoView()` instead. It scrolls the nearest scroller.",
        'A plain `<div className="overflow-auto">` is not tuned for touch. Use `ScrollView` or `List`.',
        "For a sticky header, put it inside the `ScrollView` as the first child with `sticky top-0`. A header that never moves goes above the scroller, as in the example.",
        "`position: fixed` works. [Drawer](/docs/drawer) renders into `document.body`, so the frame does not clip it. Do the same for your own overlays. Anything absolutely positioned inside the frame is clipped at its edge.",
        "A mobile browser tab keeps its address bar, because the document never scrolls. Installed apps have no bar to hide.",
        'Scrollbars are hidden on every target. Pass `showsVerticalScrollIndicator` to a `ScrollView` to show one, or set `ui: { hideScrollbars: "app" }` to hide them in installed apps only. See [Styling](/docs/styling).',
      ],
    },
    {
      type: "p",
      text: "The shell also locks the layout against the address bar and the keyboard. Turn this off with `patches: { viewportFreeze: false }` in `adaptv.config.ts`. Then you must wrap inputs outside an overlay in `AvoidKeyboard`. See [Keyboard](/docs/keyboard).",
    },
    { type: "h2", text: "What goes wrong" },
    {
      type: "table",
      head: ["Symptom", "Cause", "Fix"],
      rows: [
        [
          "The page does not stretch.",
          "The route returns several roots.",
          "Return one root.",
        ],
        [
          "A `ScrollView` does not scroll.",
          "It has no height.",
          "Add `fill` inside a `View` that fills, or give it a height such as `h-40`.",
        ],
        [
          "Content is cut off at the bottom.",
          "The root is a `View`. A `View` does not scroll.",
          "Make the root, or the tall part, a `ScrollView`.",
        ],
        [
          "`overflow-hidden` on a `ScrollView` does nothing.",
          "The `horizontal` and `scrollEnabled` props own the scroll axis.",
          "Use `scrollEnabled={false}`.",
        ],
        [
          "Content sits under the status bar or home indicator.",
          "Apps draw edge to edge.",
          'Use `safe="top"` or `safe="bottom"`.',
        ],
      ],
    },
  ],
}

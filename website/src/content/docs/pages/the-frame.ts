import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "the-frame",
  title: "The frame",
  summary:
    "The shell owns a full-viewport frame, the document never scrolls, and a page's root is a View or a ScrollView that the shell stretches to fit.",
  blocks: [
    {
      type: "p",
      text: "Every adaptv page renders inside a frame it did not create. The shell sizes the frame to the viewport, locks the document so it cannot scroll, and stretches your page's root element to fill it. Scrolling happens inside the page, in a [ScrollView](/docs/scroll-view) or a [List](/docs/list). This is the model a native navigator uses: the screen container is full size and the screen fills it. It differs from an ordinary web page in a few ways you need to know before writing one.",
    },
    { type: "h2", text: "Three layers" },
    {
      type: "table",
      head: ["Layer", "Owner", "What it does"],
      rows: [
        [
          "OS and native shell",
          "adaptv",
          "Draws edge to edge under the system bars and reports the real insets (status bar, navigation bar, cutout, keyboard) to the page.",
        ],
        [
          "Shell",
          "adaptv",
          "Wraps every route. Owns `<html>`, `<head>`, the viewport meta, critical CSS, the pre-paint theme and platform stamp, the splash, and the full-viewport flex frame.",
        ],
        [
          "Page",
          "You",
          "A [View](/docs/view) or [ScrollView](/docs/scroll-view) at the root of the route component. It fills the frame and never asks whether it is the root.",
        ],
      ],
    },
    {
      type: "p",
      text: "In the DOM the shell is three elements. `<html>` and `<body>` are `h-dvh`, `touch-none` and `overscroll-none`. Inside them `[data-app-shell]` is a flex column with `overflow-hidden`, `h-dvh` in a browser tab and `h-screen` in an installed app. Inside that, `[data-adaptv-screen]` is the frame: `flex-1 min-h-0 overflow-hidden`, and your page is its child.",
    },
    { type: "h2", text: "Writing a page" },
    {
      type: "p",
      text: "Return one root element. A page that scrolls returns a `ScrollView`; a page that is a fixed layout (a header, a list that scrolls, a tab bar) returns a `View`. You do not write `h-screen`, `min-h-screen`, `100vh` or `100dvh`, and you do not need `fill` on the root.",
    },
    {
      type: "code",
      label: "settings.page.tsx",
      lang: "tsx",
      code: `import { ScrollView, View } from "@arrzdev/adaptv/components"

// A page that scrolls as a whole.
function Settings() {
  return (
    <ScrollView className="px-4">
      <Profile />
      <Preferences />
    </ScrollView>
  )
}

// A fixed layout: the header and tab bar stay, the middle scrolls.
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
      text: "`View` is a flex column with no scrolling. `fill` on an inner `View` or `ScrollView` means `flex-1` plus `min-h-0`, which is what lets a scroller three levels down get a height and scroll. `safe` pads the named edges by the safe-area inset and resolves to zero in a browser tab. See [Safe areas](/docs/safe-areas).",
    },
    { type: "h3", text: "The stretch rule" },
    {
      type: "p",
      text: "The shell stretches a route's root with one CSS rule, in adaptv's component layer:",
    },
    {
      type: "code",
      label: "adaptv's stylesheet",
      lang: "text",
      code: `@layer adaptv.components {
  [data-adaptv-screen] > :only-child {
    flex: 1 1 0%;
    min-height: 0;
  }
}`,
    },
    {
      type: "p",
      text: "It applies to an **only child**. A route that renders two sibling roots (a fragment holding a header and a body) gets no stretch on either, because stretching both would make them fight for the space. Wrap siblings in one `View`.",
    },
    {
      type: "p",
      text: "A root that must not fill writes `className=\"flex-none\"`. Tailwind's utilities layer is ordered after adaptv's, so the utility wins without `!important`. A layout route changes who the only child is: when a layout wraps `<Outlet />` in an element of its own, that element is the one the frame stretches, and the page inside it is an ordinary flex child that needs `fill` to take the remaining space. A layout that renders only providers around `<Outlet />` adds no element and changes nothing.",
    },
    { type: "h2", text: "Why the document does not scroll" },
    {
      type: "p",
      text: "Locking the document is what makes the rest of the framework tractable across six targets. With one frame of known size, edge-to-edge drawing and safe-area insets behave the same everywhere, the software keyboard cannot resize the layout behind your back (you opt content into avoiding it, see [Keyboard](/docs/keyboard)), overscroll cannot chain from a list into a page bounce, and no page writes a viewport unit, so there is no `vh` versus `dvh` disagreement to cause [layout shift](/docs/layout-shift). The shell also holds an app-wide scroll lock so the URL bar and keyboard cannot shift the layout; it is the `viewportFreeze` patch in the [config](/docs/config) and defaults to on.",
    },
    { type: "h2", text: "Consequences" },
    { type: "h3", text: "`#hash` links do not scroll" },
    {
      type: "p",
      text: "A fragment link scrolls the document, and the document has nothing to scroll. Find the element and call `scrollIntoView`, which walks up to the nearest scroller, your `ScrollView`. This site's table of contents does exactly that:",
    },
    {
      type: "code",
      label: "table-of-contents.tsx",
      lang: "tsx",
      code: `<button
  type="button"
  onClick={() =>
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" })
  }
>
  {label}
</button>`,
    },
    {
      type: "p",
      text: "Scroll restoration between routes is yours to build for the same reason: the position lives on your scroller. `ScrollView` forwards its `ref` and `onScroll`, so you can record `scrollTop` when a screen leaves and set it when it returns.",
    },
    { type: "h3", text: "Sticky headers live inside the scroller" },
    {
      type: "p",
      text: "`position: sticky` sticks to the nearest scrolling ancestor. Put the header inside the `ScrollView` as its first child and it sticks to the top of the screen while content passes beneath it, which is also what lets a translucent header blur the content under it. This site's header is built that way:",
    },
    {
      type: "code",
      label: "site-page.tsx",
      lang: "tsx",
      code: `<ScrollView showsVerticalScrollIndicator className="bg-white">
  <header className="sticky top-0 z-40 w-full px-3 pt-safe-offset-3">
    <Nav />
  </header>
  <View className="w-full">{children}</View>
  <Footer />
</ScrollView>`,
    },
    {
      type: "p",
      text: "A header that should never move does not need `sticky`: make it a sibling above the scroller, as in the `Inbox` example earlier.",
    },
    { type: "h3", text: "Modals and overlays" },
    {
      type: "p",
      text: "`position: fixed` works and is relative to the viewport, because adaptv puts no transform, `will-change` or `perspective` on a `ScrollView` (any of those would turn the scroller into the containing block and a fixed child would scroll away with the content). [Drawer](/docs/drawer) portals its backdrop and panel to `document.body` as fixed elements, so it sits above the frame and is not clipped by the frame's `overflow-hidden`. An overlay of your own should do the same. Anything absolutely positioned inside the frame is clipped at the frame's edge.",
    },
    { type: "h3", text: "The mobile browser toolbar does not retract" },
    {
      type: "p",
      text: "In a mobile browser tab, the URL bar hides when the **document** scrolls. adaptv gave up document scroll, so the toolbar stays. Two workarounds were built and measured, and both are rejected:",
    },
    {
      type: "ul",
      items: [
        "**Mirroring the inner scroller onto the document.** The browser retracts its toolbar in response to a touch gesture on the root scroller. A programmatic scroll is not a gesture, so the toolbar never moves, and the page gains a second scroll position to keep in sync.",
        "**Making one viewport-filling scroller act as the root scroller.** Chrome does not promote it.",
      ],
    },
    {
      type: "p",
      text: "The cost lands on two of the six targets, the mobile browser tabs. An installed PWA and a native app have no toolbar to hide. Only an engine feature (a reliable way to nominate a root scroller) would reopen this. Tinting the toolbar is a separate question with the opposite answer: colour is controllable, see [Theming](/docs/theming).",
    },
    { type: "h3", text: "Desktop scrollbars are hidden unless you ask" },
    {
      type: "p",
      text: '`ui.hideScrollbars` defaults to `"all"`, so scrollbars are hidden on every target, the browser tab included. A long reading page on desktop wants one: pass `showsVerticalScrollIndicator` to that `ScrollView`, or set `ui: { hideScrollbars: "app" }` to hide them only in installed apps. See [Styling](/docs/styling).',
    },
    { type: "h2", text: "What goes wrong" },
    {
      type: "table",
      head: ["Symptom", "Cause", "Fix"],
      rows: [
        [
          "The page is as tall as its content and will not scroll.",
          "The route returns several root elements, or a plain `<div>` sits between the frame and the scroller without passing height down.",
          "One root. Use `View` (with `fill` on inner boxes) between the frame and the `ScrollView`.",
        ],
        [
          "A `ScrollView` inside the page does not scroll.",
          "Nothing constrains its height. A scroller needs either a sized flex parent and `fill`, or an explicit height.",
          '`<ScrollView fill>` inside a `View` that itself fills, or `className="h-40"`.',
        ],
        [
          "Content is cut off at the bottom of the screen.",
          "The root is a `View` and the content is taller than the frame. `View` does not scroll and the frame clips.",
          "Make the root, or the tall region, a `ScrollView`.",
        ],
        [
          "`overflow-hidden` on a `ScrollView` has no effect.",
          "The scroll axis is owned by the `horizontal` and `scrollEnabled` props and is locked against `className`.",
          "`scrollEnabled={false}`.",
        ],
        [
          "`window.scrollTo`, `window.scrollY` and scroll listeners on `window` do nothing.",
          "The document does not scroll.",
          "Use a `ref` and `onScroll` on the `ScrollView`.",
        ],
        [
          "Content sits under the status bar or the home indicator in an installed app.",
          "Edge to edge is always on. The frame covers the whole screen and padding is yours to place.",
          '`safe="top"` and `safe="bottom"` on the `View`s at the edges, or the `pt-safe` and `pb-safe` utilities.',
        ],
      ],
    },
  ],
}

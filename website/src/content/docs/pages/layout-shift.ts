import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "layout-shift",
  title: "Layout shift",
  summary: "Stop buttons moving under a thumb.",
  blocks: [
    {
      type: "p",
      text: "A button that moves is a mis-tap. adaptv removes the usual causes. You must do three things.",
    },
    {
      type: "ul",
      items: [
        "Do not write `vh`, `dvh` or `h-screen` in pages. The shell frame fills the screen. Use `fill` and `flex-1` on [View](/docs/view). See [The frame](/docs/the-frame). Nothing checks this for you.",
        "Give every [Image](/docs/image) a size: `width` and `height`, `aspectRatio` or `fill`. Types require it. An `?adaptv-image` import gets its size at build time, and the build fails if it cannot.",
        "Pad edges with [safe areas](/docs/safe-areas) utilities, not `env()`. The inset values exist before the first paint.",
      ],
    },
    {
      type: "p",
      text: "adaptv sets the theme and platform on `<html>` before the first paint, so `dark:` and `app:` styles do not jump. On iOS and in the browser, the keyboard opens over the page. On Android native the window shrinks. See [Keyboard](/docs/keyboard). `patches.viewportFreeze: false` turns the freeze off.",
    },
  ],
}

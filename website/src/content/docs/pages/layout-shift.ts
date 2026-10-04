import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "layout-shift",
  title: "Layout shift is a bug",
  summary:
    "Why adaptv treats a moving button as a correctness problem, not polish.",
  blocks: [
    {
      type: "p",
      text: "A button that moves out from under a thumb is not a cosmetic issue. On a touch screen it is a mis-tap: the user pressed the thing that was there a frame ago. adaptv names layout shift as an enemy and designs against it everywhere.",
    },
    { type: "h2", text: "What that means in practice" },
    {
      type: "ul",
      items: [
        "Safe-area insets, the theme and the platform are stamped before first paint, so nothing resolves a frame late and jumps.",
        "The shell owns a single full-viewport frame. Pages do not write viewport units, so there is no vh/dvh disagreement to shift on.",
        "Images must resolve their dimensions at build time. A build that cannot work them out fails, rather than shipping a layout that jumps when the image loads.",
        "The software keyboard never resizes your layout behind your back. You opt content into avoiding it.",
      ],
    },
  ],
}

import type { Block } from "./blocks"

export type Post = {
  slug: string
  title: string
  date: string
  kind: "Field note" | "Release"
  summary: string
  blocks: Block[]
}

export const POSTS: Post[] = [
  {
    slug: "the-loupe",
    title: "The loupe: a bug CSS cannot reach",
    date: "2026-09-20",
    kind: "Field note",
    summary:
      "Double-tap a button in an iOS web view and a text magnifier appears over it. No CSS property turns it off. Here is what does — and why the obvious version of the fix breaks scrolling.",
    blocks: [
      {
        type: "p",
        text: "Tap, then tap-and-hold, almost anywhere in an iOS web view. A magnifier bubble — the text-selection loupe — pops up under your finger. It appears over buttons, over links, over text you marked as non-selectable, over empty space. It is the single fastest way to tell that an app is a web page.",
      },
      { type: "h2", text: "Nothing in CSS governs it" },
      {
        type: "p",
        text: "The instinct is to reach for user-select: none, or -webkit-touch-callout, or touch-action. Those control selection, the long-press callout menu, and panning — three different things. The loupe is none of them. This is WebKit bug 231161: fixed once in iOS 15.2, and regressed again since.",
      },
      { type: "h2", text: "What actually arms it" },
      {
        type: "p",
        text: "The loupe is armed by the second touchstart of a double-tap. So the only thing that stops it is a non-passive touchstart listener that calls preventDefault() on exactly that second tap.",
      },
      {
        type: "p",
        text: "“Exactly” is the whole problem. preventDefault() on a touchstart cancels the entire gesture that touch would have started — including a scroll. A suppressor that fires on any quick second touch also kills fast scroll flicks, and chains across rapid tapping until the page feels frozen. The naive fix trades one visible bug for a worse invisible one.",
      },
      { type: "h2", text: "The shape that works" },
      {
        type: "p",
        text: "adaptv only treats a touch as the second tap of a double-tap when all of these hold:",
      },
      {
        type: "ul",
        items: [
          "It follows a completed, stationary, single-finger tap. A scroll flick moves, so it never records as a first tap — scrolling is safe by construction, not by threshold tuning.",
          "It arrives inside the OS's own double-tap window, about 350ms. Past that, iOS arms no loupe, so there is nothing to suppress.",
          "It lands within a few pixels of the first tap.",
          "It is one finger. A second finger is a pinch.",
          "Its target is not editable text. Inputs keep their native loupe and double-tap-to-select-word, because there it is a feature.",
        ],
      },
      {
        type: "p",
        text: "After a suppression the anchor is cleared, so a third rapid tap starts a fresh pair instead of chaining. And the listener never stops propagation — pointer events, gesture handling and drag-and-drop libraries still see every touch. Only the browser's default is cut.",
      },
      { type: "h2", text: "Why buttons are not exempt" },
      {
        type: "p",
        text: "An earlier version skipped interactive controls, on the theory that you should not interfere with a button's touch events. That is precisely where the loupe kept appearing. It turns out to be safe to suppress there: adaptv's controls activate from pointer events, which a preventDefault() on touchstart does not touch.",
      },
      { type: "h2", text: "In your app" },
      {
        type: "code",
        label: "adaptv.config.ts",
        lang: "ts",
        code: `export default defineApp({
  // On by default. This is the whole API.
  patches: { textMagnifier: true },
})`,
      },
      {
        type: "note",
        text: "This is a workaround for a platform bug, and it carries its own removal instructions in the source: re-test on each major iOS release, on a real device — the Simulator does not reliably reproduce the loupe — and delete it the day WebKit fixes it for good.",
      },
    ],
  },
]

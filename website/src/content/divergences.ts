/*
 * The price of "just wrap the web app", itemised. Every entry is a real, shipped fix —
 * the long version of each lives in the framework repo (docs/VISION.md §3,
 * docs/design/behaviors.md, docs/research/) and becomes a Platform note in the docs.
 */
export type Divergence = {
  id: string
  title: string
  /** The docs page that covers it: slug and page title. */
  docs: [slug: string, title: string]
  /** What a plain web view does. One or two sentences, in the second person. */
  problem: string
  /** What adaptv does about it. */
  fix: string
  /** A live side-by-side exists for this one (components/demos). */
  demo?: "overscroll" | "press"
}

export const DIVERGENCES: Divergence[] = [
  {
    id: "overscroll",
    docs: ["scroll-view", "ScrollView"],
    title: "Scroll that leaks",
    problem:
      "Scroll a list to its end and keep going: the gesture chains to whatever is behind it, and the whole page drags away under a sheet that was supposed to be modal.",
    fix: "Every adaptv scroller contains its own overscroll and locks to one axis. The document itself never scrolls, so there is nothing behind the app to drag.",
    demo: "overscroll",
  },
  {
    id: "press",
    docs: ["pressable", "Pressable"],
    title: "Buttons that light up when you only meant to scroll",
    problem:
      "CSS :active fires the instant a finger lands, so every row flashes as you scroll past it — and JavaScript cannot clear it, so a cancelled press stays lit.",
    fix: "A press engine owns the pressed state: it waits out the scroll-intent window, cancels on movement, and re-lights when the finger slides back. You keep writing active: — it just means what you meant.",
    demo: "press",
  },
  {
    id: "loupe",
    docs: ["keyboard", "The software keyboard"],
    title: "The magnifier loupe",
    problem:
      "Double-tap almost anywhere in an iOS web view and a text-selection loupe appears over your button. It is a WebKit bug, and there is no CSS property that turns it off.",
    fix: "adaptv recognises the second tap of a double-tap — same spot, inside the OS timing window, one finger — and suppresses exactly that. Editable text keeps its native loupe.",
  },
  {
    id: "viewport",
    docs: ["the-frame", "The frame"],
    title: "100vh is four different numbers",
    problem:
      "vh, svh, lvh and dvh disagree with each other, with the toolbar, and with the first frame of a home-screen launch — so a full-height layout jumps a moment after it paints.",
    fix: "The shell owns one full-viewport frame and stretches your route into it. Your page root is just a View; nobody writes a viewport unit.",
  },
  {
    id: "keyboard",
    docs: ["keyboard", "The software keyboard"],
    title: "Three keyboards, one signal",
    problem:
      "The software keyboard is reported three unrelated ways — a resized visual viewport, a virtual-keyboard API, a native event with a real height — and each platform uses a different one. Inputs end up under the keys.",
    fix: "One keyboard signal, normalised across all of them. Drawer and AvoidKeyboard lift content above the keys, and keep the caret where you can see it.",
  },
  {
    id: "safe-area",
    docs: ["safe-areas", "Safe areas"],
    title: "Safe areas that land after first paint",
    problem:
      "env(safe-area-inset-*) is zero in a browser tab, real on the home screen, and different again in a native shell — and it often resolves a frame late, so the header jumps under the notch and back.",
    fix: 'Insets are stamped before first paint and exposed as a prop — <View safe="top"> — that wins over any class name. Layout shift is treated as a correctness bug, not polish.',
  },
  {
    id: "splash",
    docs: ["icons-and-splash", "Icons and splash"],
    title: "Two splash screens, colliding",
    problem:
      "The OS shows its launch screen, then the web view shows white, then your app shows its own loader. On Android's home-screen install you get two splashes back to back.",
    fix: "One launch sequence, driven by your theme colours, held until the app says it is ready. No white flash, no double splash, right in dark mode.",
  },
  {
    id: "cookies",
    docs: ["rendering", "Rendering"],
    title: "Server code that dies on device",
    problem:
      "Code that needs a server at request time works in dev, works on your web deploy, and is simply dead inside a shipped mobile bundle — which is a folder of files. So are cookies.",
    fix: "adaptv refuses to build an artifact that has no server but reaches for one, and tells you what reached it. You find out at build time, not from a one-star review.",
  },
]

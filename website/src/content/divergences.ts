/*
 * The price of "just wrap the web app", itemised. Every entry is a real, shipped fix —
 * the long version of each lives in the framework repo (docs/VISION.md §3,
 * docs/design/behaviors.md, docs/research/) and becomes a Platform note in the docs.
 */
export type Divergence = {
  id: string
  title: string
  /** The fix as a card: a three-word name and one line. */
  card: [name: string, line: string]
  /** What a plain web view does. One or two sentences, in the second person. */
  problem: string
  /** What adaptv does about it. */
  fix: string
  /** Where you hit it. */
  where: string
  /** A live side-by-side exists for this one (components/demos). */
  demo?: "overscroll" | "press"
}

export const DIVERGENCES: Divergence[] = [
  {
    id: "overscroll",
    card: [
      "Scroll that stays put",
      "Lists end where they end. Nothing behind them drags.",
    ],
    title: "Scroll that leaks",
    problem:
      "Scroll a list to its end and keep going: the gesture chains to whatever is behind it, and the whole page drags away under a sheet that was supposed to be modal.",
    fix: "Every adaptv scroller contains its own overscroll and locks to one axis. The document itself never scrolls, so there is nothing behind the app to drag.",
    where: "every engine",
    demo: "overscroll",
  },
  {
    id: "press",
    card: [
      "Presses that mean it",
      "A row lights when you press it, not when you scroll past it.",
    ],
    title: "Buttons that light up when you only meant to scroll",
    problem:
      "CSS :active fires the instant a finger lands, so every row flashes as you scroll past it — and JavaScript cannot clear it, so a cancelled press stays lit.",
    fix: "A press engine owns the pressed state: it waits out the scroll-intent window, cancels on movement, and re-lights when the finger slides back. You keep writing active: — it just means what you meant.",
    where: "iOS and Android",
    demo: "press",
  },
  {
    id: "loupe",
    card: [
      "No magnifier loupe",
      "A double-tap on a button never summons the iOS text loupe.",
    ],
    title: "The magnifier loupe",
    problem:
      "Double-tap almost anywhere in an iOS web view and a text-selection loupe appears over your button. It is a WebKit bug, and there is no CSS property that turns it off.",
    fix: "adaptv recognises the second tap of a double-tap — same spot, inside the OS timing window, one finger — and suppresses exactly that. Editable text keeps its native loupe.",
    where: "iOS",
  },
  {
    id: "viewport",
    card: [
      "One viewport height",
      "Full-height layouts that don't jump when the toolbar moves.",
    ],
    title: "100vh is four different numbers",
    problem:
      "vh, svh, lvh and dvh disagree with each other, with the toolbar, and with the first frame of a home-screen launch — so a full-height layout jumps a moment after it paints.",
    fix: "The shell owns one full-viewport frame and stretches your route into it. Your page root is just a View; nobody writes a viewport unit.",
    where: "iOS Safari, home-screen apps",
  },
  {
    id: "keyboard",
    card: [
      "One keyboard signal",
      "Inputs rise above the keys on every platform, caret in view.",
    ],
    title: "Three keyboards, one signal",
    problem:
      "The software keyboard is reported three unrelated ways — a resized visual viewport, a virtual-keyboard API, a native event with a real height — and each platform uses a different one. Inputs end up under the keys.",
    fix: "One keyboard signal, normalised across all of them. Drawer and AvoidKeyboard lift content above the keys, and keep the caret where you can see it.",
    where: "every mobile target",
  },
  {
    id: "safe-area",
    card: [
      "Safe areas on frame one",
      "Notch and home-bar insets are there before first paint.",
    ],
    title: "Safe areas that land after first paint",
    problem:
      "env(safe-area-inset-*) is zero in a browser tab, real on the home screen, and different again in a native shell — and it often resolves a frame late, so the header jumps under the notch and back.",
    fix: 'Insets are stamped before first paint and exposed as a prop — <View safe="top"> — that wins over any class name. Layout shift is treated as a correctness bug, not polish.',
    where: "home-screen and native apps",
  },
  {
    id: "splash",
    card: [
      "One clean launch",
      "No white flash, no double splash, correct in dark mode.",
    ],
    title: "Two splash screens, colliding",
    problem:
      "The OS shows its launch screen, then the web view shows white, then your app shows its own loader. On Android's home-screen install you get two splashes back to back.",
    fix: "One launch sequence, driven by your theme colours, held until the app says it is ready. No white flash, no double splash, right in dark mode.",
    where: "installed apps",
  },
  {
    id: "cookies",
    card: [
      "Builds that refuse to lie",
      "Server-only code in a mobile bundle is a build error, with the line number.",
    ],
    title: "Server code that dies on device",
    problem:
      "Code that needs a server at request time works in dev, works on your web deploy, and is simply dead inside a shipped mobile bundle — which is a folder of files. So are cookies.",
    fix: "adaptv refuses to build an artifact that has no server but reaches for one, and tells you what reached it. You find out at build time, not from a one-star review.",
    where: "native builds",
  },
]

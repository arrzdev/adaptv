import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "six-targets",
  title: "The six targets",
  summary:
    "One codebase ships to six runtimes. The hard bugs live where they diverge.",
  blocks: [
    {
      type: "p",
      text: "When adaptv says “every screen” it means six concrete runtimes, and every behaviour in the framework is verified against all of them.",
    },
    {
      type: "ul",
      items: [
        "Desktop browser — Chrome, Safari, Firefox on a computer.",
        "Mobile browser, iOS — Safari, with its collapsing toolbar.",
        "Mobile browser, Android — Chrome.",
        "Home-screen app, iOS — Add to Home Screen. No browser chrome, different viewport rules.",
        "Home-screen app, Android — Install app. A different splash, a different back button.",
        "Native, iOS and Android — a store app. Real haptics, a real keychain, no server behind it.",
      ],
    },
    { type: "h2", text: "Styling for where you are" },
    {
      type: "p",
      text: "Two variants cover the split that matters most. app: applies when the app is installed — on the home screen or from a store. web: applies in a browser tab. A media query alone cannot tell you this, because a native shell reports itself as a browser.",
    },
    {
      type: "code",
      label: "header.tsx",
      lang: "tsx",
      code: `// A back arrow only where there is no browser back button,
// and safe-area padding only where there is a notch to clear.
<View row className="web:py-4 app:py-safe-offset-2">
  <BackButton className="web:hidden app:flex" />
  <Title />
</View>`,
    },
  ],
}

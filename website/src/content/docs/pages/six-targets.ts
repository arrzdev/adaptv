import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "six-targets",
  title: "The six targets",
  summary: "Style and branch for a tab, an installed app or a native build.",
  blocks: [
    {
      type: "ul",
      items: [
        "Desktop browser.",
        "iOS browser tab (Safari).",
        "Android browser tab (Chrome).",
        "iOS installed PWA.",
        "Android installed PWA.",
        "Native app (iOS and Android count as one).",
      ],
    },
    { type: "h2", text: "Style per target" },
    {
      type: "p",
      text: "`app:` applies in an installed PWA and in a native app. `web:` applies in a browser tab only. A native app reports `display-mode: browser`, so a media query cannot tell them apart.",
    },
    {
      type: "code",
      label: "header.tsx",
      lang: "tsx",
      code: `import { View } from "adaptv/components"

<View row className="web:py-4 app:pt-safe-offset-2 app:pb-2">
  <BackButton className="web:hidden app:flex" />
  <Title />
</View>`,
    },
    {
      type: "p",
      text: 'To style per OS, select the stamp on `<html>`: `[data-adaptv-os="ios"] &`. There is no `ios:` variant.',
    },
    { type: "h2", text: "Branch in JavaScript" },
    {
      type: "code",
      label: "platform.ts",
      lang: "ts",
      code: `import { getOS, isInstalledApp, isNativePlatform } from "adaptv/utils"

isInstalledApp() // PWA or native
isNativePlatform() // native only
getOS() // "ios" | "android" | other`,
    },
    {
      type: "note",
      text: 'Do not use `matchMedia("(display-mode: standalone)")` for this. It is false in a native app.',
      tone: "warn",
    },
  ],
}

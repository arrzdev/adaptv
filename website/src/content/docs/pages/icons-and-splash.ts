import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "icons-and-splash",
  title: "Icons and splash",
  summary:
    "Generate every icon from one image and set the colours the app launches in.",
  blocks: [
    { type: "h2", text: "Generate the icon set" },
    {
      type: "ol",
      items: [
        "Set `icons` in `adaptv.config.ts` to a directory inside `public/`. A directory outside `public/` stops the build.",
        "Draw the source full-bleed on a flat or transparent background.",
        "Run `adaptv icons --input ./mark.png`. The source should be 1024px or larger.",
        "Open `.adaptv/icons-preview.html`. It shows each icon under its platform's mask.",
      ],
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `import { defineApp } from "@arrzdev/adaptv/config"

export default defineApp({
  // ...
  icons: "./public/favicons",
})`,
    },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv icons --input ./mark.png

# iOS 18 dark appearance, no confirmation prompt
adaptv icons --input ./mark.svg --dark ./mark-dark.png --yes`,
    },
    {
      type: "p",
      text: "The command replaces the files in the `icons` directory, and asks first unless you pass `--yes`. With no `icons` key it stops with `nowhere to write`. Pass `--output <dir>`. The source can be PNG, SVG, WebP, JPEG, AVIF, TIFF or GIF.",
    },
    {
      type: "props",
      rows: [
        {
          name: "--input <image>",
          type: "path",
          required: true,
          description: "The source image.",
        },
        {
          name: "-o, --output <dir>",
          type: "path",
          description: "Write here instead of the `icons` directory.",
        },
        {
          name: "--yes",
          type: "flag",
          description: "Replace the existing set without asking.",
        },
        {
          name: "--dark <image>",
          type: "path",
          description: "Inverted version for the iOS 18 dark icon.",
        },
        {
          name: "--tinted <image>",
          type: "path",
          description: "Greyscale version for the iOS tinted home screen.",
        },
        {
          name: "--monochrome <image>",
          type: "path",
          description: "Single-colour version for Android themed icons.",
        },
        {
          name: "--margin <pct>",
          type: "0-50",
          default: "10",
          description: "Space around the mark. `0` fills edge to edge.",
        },
        {
          name: "--padding <pct>",
          type: "0-40",
          description: "Extra space on top of the margin.",
        },
        {
          name: "--background <hex>",
          type: "colour",
          description:
            "Fill for icons that cannot be transparent. It overrides the colour adaptv read from the image.",
        },
      ],
    },
    {
      type: "p",
      text: "The command warns, and still writes, for a source that is not square, is under 1024px, has no flat background, or is a dark mark with no `--dark`. It refuses only a file it cannot decode.",
    },
    { type: "h3", text: "What it writes" },
    {
      type: "table",
      head: ["File", "Used for"],
      rows: [
        ["`icon.png` (1024)", "iOS launcher icon and Android legacy icon."],
        ["`icon-maskable.png` (1024)", "Android adaptive foreground."],
        ["`icon-monochrome.png` (1024)", "Android themed icons."],
        ["`icon-dark.png`, `icon-tinted.png` (1024)", "iOS 18 appearances."],
        ["`android-chrome-192/512.png`", "Manifest icons."],
        [
          "`android-maskable-192/512.png`",
          'Manifest icons with `purpose: "maskable"`.',
        ],
        ["`apple-touch-icon-180.png`", "Installed iOS PWA."],
        [
          "`favicon-16x16`, `-32x32`, `-96x96`, `-512x512` (`.png`)",
          "Browser tabs.",
        ],
        [
          "`favicon.ico`, `icon.svg`",
          "Legacy browsers. The SVG is copied when it is the source.",
        ],
      ],
    },
    {
      type: "p",
      text: "You can fill the folder by hand. adaptv reads `.png`, `.webp`, `.jpg`, `.jpeg` files and lists the square ones from 48px to 512px in the manifest. Only `.png`, `.ico` and `.svg` icons are precached. A folder with only `icon.png` is valid. With no icons, the app ships adaptv's default mark, served from `/adaptv-icons`.",
    },
    { type: "h2", text: "Set the launch colours" },
    {
      type: "p",
      text: "`themeColor` is required. It paints everything the user sees before your CSS loads: the page background, the `theme-color` meta, the manifest and the native launch screen. adaptv applies the stored theme in the first frame, so a dark app does not flash white.",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `export default defineApp({
  name: "Chop Chop",
  themeColor: { light: "#ffffff", dark: "#0a0a0a" },
})`,
    },
    {
      type: "props",
      rows: [
        {
          name: "themeColor",
          type: "{ light?: string; dark?: string }",
          required: true,
          description:
            "Background colour per scheme. A missing side uses the other.",
        },
        {
          name: "backgroundColor",
          type: "string",
          default: "light themeColor",
          description:
            "The manifest `background_color`. Android Chrome uses it for the launch screen of an installed PWA.",
        },
      ],
    },
    { type: "h2", text: "Write a splash screen" },
    {
      type: "p",
      text: "`splashScreen` is a component that covers the app while it boots. It shows only in an installed app. Set `splashScreenInBrowser: true` to show it in a browser tab too. Use a literal `import()` and a default export. adaptv reads the path and never calls the function.",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `export default defineApp({
  // ...
  splashScreen: () => import("@/components/splash-screen"),
})`,
    },
    {
      type: "code",
      label: "src/components/splash-screen.tsx",
      lang: "tsx",
      code: `import { PwaSplashOverlay } from "@arrzdev/adaptv/components"
import type { SplashScreenProps } from "@arrzdev/adaptv/config"
import { useEffect, useState } from "react"

const MIN_VISIBLE_MS = 1000

// Logo and useAppReady are your own.
export default function SplashScreen({ revealedAt }: SplashScreenProps) {
  const ready = useAppReady()
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // null while the OS launch screen still covers this component.
    if (!ready || revealedAt === null) return
    const delay = Math.max(MIN_VISIBLE_MS - (Date.now() - revealedAt), 0)
    const timeout = setTimeout(() => setDismissed(true), delay)
    return () => clearTimeout(timeout)
  }, [ready, revealedAt])

  if (dismissed) return null

  return (
    <PwaSplashOverlay className="bg-white dark:bg-neutral-950">
      <Logo className="size-24" />
    </PwaSplashOverlay>
  )
}`,
    },
    {
      type: "ul",
      items: [
        "The component removes itself by returning `null`. adaptv never times it. Make `ready` become true offline too, for example with a timeout. Otherwise the app waits on the splash with no network.",
        "It mounts under the OS launch screen. `revealedAt` is `null` until that screen is gone. Then it is the time of the reveal. Time your minimum from `revealedAt`, not from mount.",
      ],
    },
    {
      type: "p",
      text: '`PwaSplashOverlay` is a fixed full-screen layer. `className` and `style` style it. `centerClassName` and `centerStyle` style the region that centres `children`. On an iOS home-screen launch the viewport grows after the first frame. To keep the logo still, pin the centring region to the CSS variable `--pwa-launch-height`, with `centerClassName="app:bottom-auto! app:h-[var(--pwa-launch-height,100lvh)]"`.',
    },
    {
      type: "props",
      rows: [
        {
          name: "splashMaskMode",
          type: '"preferences" | "system" | "light" | "dark"',
          default: '"preferences"',
          description:
            "Colour of the native launch screen. `preferences` follows the theme chosen in the app. `system` follows the device.",
        },
        {
          name: "splashMaskLightColor",
          type: "string",
          default: "backgroundColor, then light themeColor",
          description: "Native launch colour in light mode.",
        },
        {
          name: "splashMaskDarkColor",
          type: "string",
          default: "dark themeColor",
          description: "Native launch colour in dark mode.",
        },
      ],
    },
    {
      type: "p",
      text: "The native launch screen is a flat colour. Your component draws the logo. `hideNativeSplash()` from `@arrzdev/adaptv/capabilities` hides the OS screen. The shell calls it for you. You need it only for your own launch sequence.",
    },
    { type: "h2", text: "What goes wrong" },
    {
      type: "ul",
      items: [
        "**The icon did not change on a device.** Native icons, the app name and launch colours change only with a new build and a store release. Add `--force` if a build looks stale.",
        "**The Android icon is a square in a circle.** The source has an opaque background. Use a full-bleed source and check the preview file.",
        "**The splash never goes away.** `ready` never becomes true offline. Add a timeout.",
      ],
    },
  ],
}

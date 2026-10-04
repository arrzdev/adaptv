import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "icons-and-splash",
  title: "Icons and splash",
  summary:
    "Generate every icon from one image, set the colours the app launches in, and write a splash screen that hands over from the OS without a white flash.",
  blocks: [
    {
      type: "p",
      text: "An app that ships to six targets needs a favicon, web manifest icons, an Apple touch icon, an iOS launcher icon in three appearances, and an Android adaptive icon. It also needs a launch that does not flash white in dark mode. adaptv derives all of it from one folder of images and a handful of config keys.",
    },
    { type: "h2", text: "Generate the icon set" },
    {
      type: "p",
      text: "First tell adaptv where icons live. `icons` names one directory inside `public/`. There is no default; `./public/favicons` is only a convention.",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `export default defineConfig({
  // ...
  icons: "./public/favicons",
})`,
    },
    {
      type: "p",
      text: "Then generate the set from one source image, a PNG or an SVG of 1024px or more:",
    },
    {
      type: "code",
      label: "Terminal",
      lang: "bash",
      code: `adaptv icons --input ./mark.png

# with the iOS 18 dark appearance, no confirmation prompt
adaptv icons --input ./mark.svg --dark ./mark-dark.png --yes`,
    },
    {
      type: "p",
      text: "The command writes into the `icons` directory, or into `--output`. With neither it stops and asks you to choose one. It replaces what is in the directory and asks first, unless you pass `--yes`. Every run also writes `.adaptv/icons-preview.html`, which shows each icon under the mask its platform applies. Open it before you commit the files.",
    },
    {
      type: "note",
      text: "Draw the source full-bleed on a flat or transparent background. Each platform rounds the icon with its own mask, so a rounded square drawn into the art ends up as a shape inside a shape.",
    },
    { type: "h3", text: "Flags" },
    {
      type: "props",
      rows: [
        {
          name: "--input <image>",
          type: "path",
          required: true,
          description: "The source image. PNG or SVG, 1024px or larger.",
        },
        {
          name: "-o, --output <dir>",
          type: "path",
          description: "Write here in place of the config's `icons` directory.",
        },
        {
          name: "--yes",
          type: "flag",
          description: "Replace the existing set without asking.",
        },
        {
          name: "--dark <image>",
          type: "path",
          description:
            "An inverted version, used for the iOS 18 dark-mode icon.",
        },
        {
          name: "--tinted <image>",
          type: "path",
          description:
            "A greyscale version that iOS colours on a tinted home screen.",
        },
        {
          name: "--monochrome <image>",
          type: "path",
          description: "A single-colour version for Android themed icons.",
        },
        {
          name: "--margin <pct>",
          type: "0-50",
          default: "10",
          description:
            "Space around the mark, as a percentage. `0` fills edge to edge.",
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
            "The fill for icons that cannot be transparent. Overrules the colour adaptv read from the image.",
        },
        {
          name: "--verbose",
          type: "flag",
          description: "Stream the raw output.",
        },
      ],
    },
    { type: "h3", text: "What it writes" },
    {
      type: "table",
      head: ["File", "Size", "Used for"],
      rows: [
        [
          "`icon.png`",
          "1024",
          "The full-bleed master. iOS launcher icon and Android legacy icon.",
        ],
        [
          "`icon-maskable.png`",
          "1024",
          "The master with a safe zone. Android adaptive-icon foreground.",
        ],
        ["`icon-monochrome.png`", "1024", "Android themed icons."],
        [
          "`icon-dark.png`, `icon-tinted.png`",
          "1024",
          "The iOS 18 dark and tinted appearances.",
        ],
        [
          "`android-chrome-192.png`, `android-chrome-512.png`",
          "192, 512",
          "Web manifest icons.",
        ],
        [
          "`android-maskable-192.png`, `android-maskable-512.png`",
          "192, 512",
          'Web manifest icons with `purpose: "maskable"`.',
        ],
        [
          "`apple-touch-icon-180.png`",
          "180",
          "The iOS home-screen icon for an installed PWA.",
        ],
        [
          "`favicon-16x16.png`, `favicon-32x32.png`, `favicon-96x96.png`, `favicon-512x512.png`",
          "16 to 512",
          "Browser tabs and bookmarks.",
        ],
        [
          "`favicon.ico`",
          "multi-size",
          "Legacy browsers and Windows shortcuts.",
        ],
        ["`icon.svg`", "vector", "Copied as-is when the source is an SVG."],
      ],
    },
    {
      type: "p",
      text: "The command warns, and still writes, when the source is smaller than a platform wants (1024px for iOS, 432px for Android), or when it is opaque where the Android adaptive foreground wants transparency. Only a file it cannot decode is refused.",
    },
    { type: "h2", text: "How the icons reach each target" },
    {
      type: "p",
      text: "You never list icons in a manifest or a head tag. adaptv measures every image in the directory at build time and derives the rest, so you can also fill the folder by hand or from a design tool. The file names above are what it recognises.",
    },
    {
      type: "ul",
      items: [
        '**Web manifest.** Every square image of 48px or more, deduplicated by size. Names containing `maskable` get `purpose: "maskable"`. `apple-*`, `ms-*` and the 1024px masters are left out.',
        "**Head links.** Favicon and Apple touch icon links, only for files that exist.",
        "**Native launcher icons.** The full-bleed master for iOS and the Android legacy square, the maskable master for the Android adaptive foreground. A folder holding only `icon.png` is a valid set.",
        "**iOS 18 appearances.** `icon-dark.png` and `icon-tinted.png` when present.",
      ],
    },
    {
      type: "p",
      text: "Native builds generate the launcher icons into the native project and leave the icon files out of the app's web bundle, where nothing reads them.",
    },
    {
      type: "note",
      text: "With no `icons` key, or a directory with no usable image, the app ships adaptv's own default mark on every surface and says so once per run. `adaptv doctor` reports which of the two you have.",
    },
    { type: "h2", text: "Launch colours" },
    {
      type: "p",
      text: "`themeColor` is the one required colour. It paints every surface a user can see before your CSS loads.",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `export default defineConfig({
  name: "Chop Chop",
  themeColor: { light: "#ffffff", dark: "#0a0a0a" },
})`,
    },
    {
      type: "props",
      rows: [
        {
          name: "themeColor",
          type: "{ light: string; dark?: string } | { light?: string; dark: string }",
          required: true,
          description:
            "The app's background colour per scheme. A missing side falls back to the other. Used for the pre-paint background, the `theme-color` meta, the manifest and the native launch screen.",
        },
        {
          name: "backgroundColor",
          type: "string",
          default: "light themeColor",
          description:
            "The manifest's `background_color`, which Android Chrome uses for the launch screen of an installed PWA.",
        },
        {
          name: "defaultThemePreference",
          type: '"system" | "light" | "dark"',
          default: '"system"',
          description:
            "The theme a first-time visitor gets. See [Theming](/docs/theming).",
        },
      ],
    },
    { type: "h3", text: "Why there is no white flash" },
    {
      type: "p",
      text: "A dark app that flashes white on launch has painted a frame before it knew its theme. adaptv closes every gap where that can happen:",
    },
    {
      type: "ul",
      items: [
        "The generated HTML carries inline critical CSS ahead of the stylesheet. It sets the `html` and `body` background to `themeColor`, light or dark, from a media query.",
        "A script that runs before the first paint reads the stored theme preference and stamps `light` or `dark` on `<html>`, together with `color-scheme`, the background and the `theme-color` meta. A user who chose dark on a light device gets dark in the first frame.",
        "In an installed app the background bleeds past the viewport edges, so an overscroll or a late-resizing window shows the theme colour.",
        "The native launch screen is a flat colour taken from the same config, so the OS frame and the first web frame match.",
      ],
    },
    { type: "h2", text: "A splash screen" },
    {
      type: "p",
      text: "`splashScreen` is a React component that covers the app while it boots. It renders only when the app is installed, as a home-screen PWA or a native build. A browser tab goes straight to the page.",
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `export default defineConfig({
  // ...
  splashScreen: () => import("@/components/splash-screen"),
})`,
    },
    {
      type: "p",
      text: "Write it as a function returning a literal `import()`, and give the file a default export. adaptv reads the path and never runs the function.",
    },
    {
      type: "code",
      label: "src/components/splash-screen.tsx",
      lang: "tsx",
      code: `import { PwaSplashOverlay } from "@arrzdev/adaptv/components"
import type { SplashScreenProps } from "@arrzdev/adaptv/config"
import { useEffect, useState } from "react"
import { Logo } from "@/components/logo"
import { useAppReady } from "@/data/app-ready"

const MIN_VISIBLE_MS = 1000

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
    { type: "h3", text: "The contract" },
    {
      type: "ul",
      items: [
        "**The component dismisses itself** by returning `null`. adaptv does not time it or unmount it. Decide what ready means for your app, and make sure it becomes true offline too, or the app hangs on the splash with no network.",
        "**It mounts underneath the OS launch screen.** adaptv waits for the splash to paint, then fades the OS screen out over it, which is why the handover has no gap. Mount time is therefore earlier than the moment anyone sees it.",
        "**`revealedAt` is the clock.** It is `null` until the OS screen is gone, then `Date.now()` at that moment. Measure a minimum visible time from it. Timed from mount, the minimum is spent behind the OS screen and the brand flashes for whatever is left.",
        "**CSS animations wait too.** Animations inside `PwaSplashOverlay` are held on their first frame until the reveal, so an intro plays for the viewer.",
        "When the first route is a not-found, the shell retires the splash for you.",
      ],
    },
    { type: "h3", text: "PwaSplashOverlay" },
    {
      type: "p",
      text: "The overlay is a fixed, full-viewport layer above the app with a centred region for your content. Its position and stacking are locked; colours and the rest are yours.",
    },
    {
      type: "props",
      rows: [
        {
          name: "className",
          type: "string",
          description:
            "Classes for the covering layer. Set the background here.",
        },
        {
          name: "style",
          type: "CSSProperties",
          description: "Inline style for the covering layer.",
        },
        {
          name: "centerClassName",
          type: "string",
          description:
            "Classes for the inner region that centres `children`. It fills the layer and is a centred flex column by default.",
        },
        {
          name: "centerStyle",
          type: "CSSProperties",
          description: "Inline style for the centring region.",
        },
        {
          name: "children",
          type: "ReactNode",
          description: "What the splash shows.",
        },
      ],
    },
    {
      type: "p",
      text: "On an iOS home-screen launch the viewport is reported short for the first frame and grows afterwards, which moves anything centred in it. adaptv records the launch height before paint as `--pwa-launch-height`. Pin the centring region to it and the logo does not move:",
    },
    {
      type: "code",
      label: "splash-screen.tsx",
      lang: "tsx",
      code: `<PwaSplashOverlay centerClassName="app:bottom-auto! app:h-[var(--pwa-launch-height,100lvh)]">
  <Logo className="size-24" />
</PwaSplashOverlay>`,
    },
    {
      type: "p",
      text: "Reserve space for images and SVGs inside the splash as you would anywhere else. See [Avoiding layout shift](/docs/layout-shift).",
    },
    { type: "h3", text: "Splash config" },
    {
      type: "props",
      rows: [
        {
          name: "splashScreen",
          type: '() => import("...")',
          description:
            "The splash component. Rendered only when the app is installed.",
        },
        {
          name: "splashScreenInBrowser",
          type: "boolean",
          default: "false",
          description: "Also show the splash in a browser tab.",
        },
        {
          name: "splashMaskMode",
          type: '"preferences" | "system" | "light" | "dark"',
          default: '"preferences"',
          description:
            "Which colour the native launch screen uses. `preferences` follows the theme the user chose in the app, `system` follows the device, `light` and `dark` are fixed.",
        },
        {
          name: "splashMaskLightColor",
          type: "string",
          default: "backgroundColor, then light themeColor",
          description: "The native launch colour in light mode.",
        },
        {
          name: "splashMaskDarkColor",
          type: "string",
          default: "dark themeColor",
          description: "The native launch colour in dark mode.",
        },
      ],
    },
    { type: "h2", text: "The native launch screen" },
    {
      type: "p",
      text: "On iOS and Android the launch screen is a colour, never an image. adaptv writes it into the native project on every build: the Android launch theme with light and night colours, and an iOS colour asset behind a solid launch storyboard. Android 12's system splash is given a transparent icon so it shows the same flat colour. Your `splashScreen` component supplies the logo, drawn by the same code on every target.",
    },
    {
      type: "p",
      text: 'With `splashMaskMode: "preferences"`, a change of theme inside the app applies to the launch screen from the next launch. On iOS the very first frame of an adaptive launch screen follows the device setting, because the OS draws that frame before any app code runs. A fixed `light` or `dark` mask has no such frame.',
    },
    {
      type: "api",
      name: "hideNativeSplash()",
      signature: "function hideNativeSplash(): Promise<void>",
      description:
        "Hides the OS launch screen and resolves when its 200ms fade has finished. The shell calls it for you once the first frame has painted, so you need it only if you build your own launch sequence. Imported from `@arrzdev/adaptv/capabilities`.",
      returns:
        "A promise. Resolves immediately on the web and in an installed PWA.",
    },
    { type: "h2", text: "What changes need a store release" },
    {
      type: "p",
      text: "The launcher icon, the app name and the native launch colours live in the native shell. A new value reaches installed iOS and Android apps through a store release, never [over the air](/docs/ota-updates). The web targets pick up new icon files on the next deploy.",
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "Favicons and the pre-paint theme colour. No splash unless `splashScreenInBrowser` is set.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "The same as desktop. On iOS 26 the browser bars take their colour from the page's painted edges, and the `theme-color` meta has no effect there.",
        },
        {
          target: "Installed PWA",
          status: "yes",
          note: "Manifest and Apple touch icons, and the splash component. Android Chrome draws its own launch screen from the manifest first; iOS has none, so the theme colour fills the gap.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "Launcher icon with dark and tinted appearances, colour launch screen, then the splash component.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Adaptive and themed icons, colour launch screen in light and night, then the splash component.",
        },
      ],
    },
  ],
}

import { HooksDeviceDemo } from "@/components/docs-demos/hooks-device-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "hooks-device",
  title: "Device and display hooks",
  summary:
    "Read the device, the safe area, media queries, orientation, motion preference and theme. Set the browser toolbar and the native status bar.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { useDevice, useInsets, useMediaQuery, useOrientation, useReducedMotion, useTheme, useChromeTint, useStatusBar } from "adaptv/hooks"',
  source: "src/hooks",
  blocks: [
    {
      type: "demo",
      component: HooksDeviceDemo,
      code: `import {
  useInsets,
  useMediaQuery,
  useOrientation,
  useReducedMotion,
} from "adaptv/hooks"

function DeviceReadout() {
  const isWide = useMediaQuery("(min-width: 768px)")
  const hasHover = useMediaQuery("(hover: hover)")
  const reducedMotion = useReducedMotion()
  const { orientation } = useOrientation()
  const insets = useInsets()
  // ...
}`,
    },
    {
      type: "p",
      text: "These hooks are safe during server rendering. Each returns a fixed value on the server and during hydration. Outside a component, use the matching function from [capabilities](/docs/capabilities).",
    },

    { type: "h2", text: "useDevice" },
    {
      type: "api",
      name: "useDevice()",
      signature: "function useDevice(): UseDeviceResult",
      description:
        "Hardware and OS facts. A field that a target cannot answer is `null`.",
      returns: "`{ info, id, loading }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "info",
          type: "DeviceInfo | null",
          description: "The record. `null` while loading.",
        },
        {
          name: "id",
          type: "string | null",
          description:
            "A stable id for each install on native. `null` on web. Make your own and keep it in [storage](/docs/storage).",
        },
        {
          name: "loading",
          type: "boolean",
          description: "`true` until `info` is available.",
        },
      ],
    },
    { type: "h3", text: "DeviceInfo" },
    {
      type: "props",
      rows: [
        {
          name: "platform",
          type: '"web" | "standalone" | "native"',
          description:
            "Browser tab, installed PWA or native app. Same as `resolvePlatformTag()` in [utils](/docs/utils).",
        },
        {
          name: "os",
          type: '"ios" | "android" | "web"',
          description: '`"web"` means desktop or other.',
        },
        {
          name: "osVersion",
          type: "string | null",
          description: '`"18.4"` or `"14"`. `null` on desktop.',
        },
        {
          name: "model",
          type: "string | null",
          description:
            '`"iPhone15,2"` or `"Pixel 8"`. On web, only Android Chromium has it.',
        },
        {
          name: "manufacturer",
          type: "string | null",
          description: '`"Apple"` or `"Google"`. `null` on web.',
        },
        {
          name: "isVirtual",
          type: "boolean | null",
          description: "`true` on a simulator or emulator. `null` on web.",
        },
        {
          name: "webViewVersion",
          type: "string | null",
          description: "The WebView build, or the browser engine version.",
        },
      ],
    },
    {
      type: "code",
      label: "about-screen.tsx",
      lang: "tsx",
      code: `const { info } = useDevice()

if (!info) return null
return (
  <Text>
    {info.model ?? "Unknown model"} · {info.os} {info.osVersion ?? ""}
  </Text>
)`,
    },
    {
      type: "p",
      text: "For the language, use [`useLocale`](/docs/hooks-system).",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "`platform`, `os` and `webViewVersion`. Chromium also fills `osVersion` from its user-agent hints.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "Adds `osVersion`. Android Chromium adds `model`.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Same as the browser.",
        },
        { target: "iOS", status: "yes", note: "All fields and `id`." },
        { target: "Android", status: "yes", note: "All fields and `id`." },
      ],
    },

    { type: "h2", text: "useInsets" },
    {
      type: "api",
      name: "useInsets()",
      signature: "function useInsets(): Insets",
      description:
        "Safe-area insets in px. Use it for maths, such as a snap point. For padding and margin, use the CSS utilities in [safe areas](/docs/safe-areas). They cost no re-render.",
      returns:
        "`{ top, right, bottom, left }`. All zeros on the server and on the first client render.",
    },
    {
      type: "api",
      name: "readSafeAreaInsets()",
      signature: "function readSafeAreaInsets(): Insets",
      description: "Measure once. Use it outside React.",
    },
    {
      type: "code",
      label: "sheet.tsx",
      lang: "tsx",
      code: `const insets = useInsets()
const snapPoint = window.innerHeight - insets.bottom - HANDLE_HEIGHT`,
    },
    {
      type: "targets",
      rows: [
        { target: "Desktop web", status: "yes", note: "All zeros." },
        { target: "Mobile web", status: "yes" },
        { target: "Installed PWA", status: "yes" },
        { target: "iOS", status: "yes" },
        {
          target: "Android",
          status: "yes",
          note: "The native shell supplies the values.",
        },
      ],
    },

    { type: "h2", text: "useMediaQuery" },
    {
      type: "api",
      name: "useMediaQuery()",
      signature: "function useMediaQuery(query: string | null): boolean",
      description: "A reactive `matchMedia` result.",
      params: [
        {
          name: "query",
          type: "string | null",
          required: true,
          description:
            'A media query, such as `"(min-width: 768px)"`. `null` turns the hook off.',
        },
      ],
      returns:
        "`true` while the query matches. `false` on the server and during hydration.",
    },
    {
      type: "code",
      label: "layout.tsx",
      lang: "tsx",
      code: `const isWide = useMediaQuery("(min-width: 768px)")
return isWide ? <Sidebar /> : <TabBar />`,
    },
    {
      type: "note",
      tone: "info",
      text: "The `false` branch paints first. If only the style differs, use a Tailwind breakpoint. See [layout shift](/docs/layout-shift).",
    },

    { type: "h2", text: "useOrientation" },
    {
      type: "api",
      name: "useOrientation()",
      signature: "function useOrientation(): UseOrientationResult",
      description:
        "Read, follow and lock the screen orientation. Reading works everywhere. iOS browsers cannot lock. Chromium locks only in fullscreen or an installed app. `lock` and `unlock` never reject.",
      returns:
        "`{ orientation, isPortrait, lockSupported, lock, unlock, lastOutcome }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "orientation",
          type: '"portrait-primary" | "portrait-secondary" | "landscape-primary" | "landscape-secondary"',
          description: 'The live value. `"portrait-primary"` on the server.',
        },
        {
          name: "isPortrait",
          type: "boolean",
          description: "`true` for either portrait value.",
        },
        {
          name: "lockSupported",
          type: "boolean",
          description:
            "`true` if a lock can be tried. `false` on the server and in iOS browsers. Then show a rotate prompt.",
        },
        {
          name: "lock",
          type: "(lock: ScreenOrientationLock) => Promise<OrientationLockOutcome>",
          description:
            'Hold one orientation: `"any"`, `"natural"`, `"portrait"`, `"landscape"` or an exact value.',
        },
        {
          name: "unlock",
          type: "() => Promise<OrientationLockOutcome>",
          description: "Release the lock.",
        },
        {
          name: "lastOutcome",
          type: "OrientationLockOutcome | null",
          description: "Result of the last `lock` or `unlock`.",
        },
      ],
    },
    {
      type: "table",
      head: ["Outcome", "Meaning"],
      rows: [
        ['`"ok"`', "Accepted."],
        ['`"unsupported"`', "No lock API. Do not retry."],
        ['`"rejected"`', "Refused, for example outside fullscreen."],
      ],
    },
    {
      type: "code",
      label: "video-player.tsx",
      lang: "tsx",
      code: `const { lockSupported, lock } = useOrientation()

async function enterFullscreen() {
  if (!lockSupported) return showRotatePrompt()
  const outcome = await lock("landscape")
  if (outcome !== "ok") showRotatePrompt()
}`,
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: 'Chromium gives `"rejected"` outside fullscreen.',
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "iOS: no lock. Android Chrome: fullscreen only.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Android: works. iOS: no lock.",
        },
        { target: "iOS", status: "yes" },
        {
          target: "Android",
          status: "partial",
          note: 'On Android 16+ with `targetSdk` 36, the OS ignores locks on large screens but still gives `"ok"`.',
        },
      ],
    },

    { type: "h2", text: "useReducedMotion" },
    {
      type: "api",
      name: "useReducedMotion()",
      signature: "function useReducedMotion(): boolean",
      description: "Reactive `prefers-reduced-motion: reduce`.",
      returns: "`true` when the user wants less motion. `false` on the server.",
    },
    {
      type: "code",
      label: "hero.tsx",
      lang: "tsx",
      code: `const reduced = useReducedMotion()
<motion.div animate={{ y: 0 }} transition={{ duration: reduced ? 0 : 0.4 }} />`,
    },

    { type: "h2", text: "useTheme" },
    {
      type: "api",
      name: "useTheme()",
      signature:
        'function useTheme(): { preference: "light" | "dark" | "system"; resolved: "light" | "dark"; setPreference: (preference: "light" | "dark" | "system") => void }',
      description:
        'The theme preference, the look it gives now, and the way to change it. `preference` is the choice. `resolved` is what shows. With `"system"`, it follows the OS. The app shell already calls it.',
      returns:
        "`{ preference, resolved, setPreference }`. `setPreference(p)` updates `<html>` and saves the choice.",
    },
    {
      type: "code",
      label: "theme-toggle.tsx",
      lang: "tsx",
      code: `const { resolved, setPreference } = useTheme()
const toggleTheme = () => setPreference(resolved === "dark" ? "light" : "dark")

<Button onClick={toggleTheme} aria-label="Toggle theme">
  <Sun className="hidden dark:block" />
  <Moon className="block dark:hidden" />
</Button>`,
    },
    {
      type: "note",
      tone: "warn",
      text: 'The server renders `"light"`. If markup branches on `resolved`, a dark-mode visitor gets a hydration mismatch. Render both and use the `dark:` variant, as above.',
    },
    {
      type: "p",
      text: "The preference is saved in `localStorage` as `ui-theme-preference`. Defaults come from [config](/docs/config). See [theming](/docs/theming).",
    },
    {
      type: "api",
      name: "applyUiThemePreference()",
      signature:
        'function applyUiThemePreference(preference: "light" | "dark" | "system"): void',
      description: "Set a preference outside a component. Client only.",
    },
    {
      type: "api",
      name: "readPreference()",
      signature: 'function readPreference(): "light" | "dark" | "system"',
      description:
        'The saved preference: `localStorage`, then `data-ui-theme`, then `"system"`.',
    },
    {
      type: "api",
      name: "getResolvedUiAppearance()",
      signature:
        'function getResolvedUiAppearance(preference: UiThemePreference): "light" | "dark"',
      description:
        'What a preference gives now. `"system"` reads `prefers-color-scheme`. `"light"` on the server.',
    },
    {
      type: "code",
      label: "appearance-setting.tsx",
      lang: "tsx",
      code: `import { applyUiThemePreference, readPreference } from "adaptv/hooks"

const [preference, setPreference] = useState(readPreference)

function choose(next: "light" | "dark" | "system") {
  applyUiThemePreference(next)
  setPreference(next)
}`,
    },

    { type: "h2", text: "useChromeTint" },
    {
      type: "api",
      name: "useChromeTint()",
      signature: "function useChromeTint(): UseChromeTint",
      description:
        'Animate the colour of the mobile browser toolbar (`<meta name="theme-color">`). Where there is no toolbar, the calls do nothing. On unmount, a held tint returns to the theme.',
      returns: "`{ supported, base, read, transitionTo, set, restore }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "supported",
          type: "boolean",
          description:
            "`true` if a `theme-color` tag exists. `false` on the server.",
        },
        {
          name: "base",
          type: "string | null",
          description: "The colour that `restore()` goes back to.",
        },
        {
          name: "read",
          type: "() => string | null",
          description: "The colour on the tag now.",
        },
        {
          name: "transitionTo",
          type: "(color: string, options?: ChromeTintOptions) => ChromeTintTransition",
          description: "Move the tint to `color`.",
        },
        {
          name: "set",
          type: "(color: string) => void",
          description: "Set the tint now. Use it to follow a finger.",
        },
        {
          name: "restore",
          type: '(options?: Omit<ChromeTintOptions, "from">) => ChromeTintTransition',
          description: "Give the toolbar back to the theme.",
        },
      ],
    },
    { type: "h3", text: "ChromeTintOptions" },
    {
      type: "props",
      rows: [
        {
          name: "duration",
          type: "number",
          default: "0.3",
          description: "Seconds.",
        },
        {
          name: "easing",
          type: "[number, number, number, number]",
          default: "[0.25, 0.1, 0.25, 1]",
          description:
            "`[x1, y1, x2, y2]`, as CSS `cubic-bezier()`. Default: CSS `ease`. See `EasingBezier` in [utils](/docs/utils).",
        },
        {
          name: "from",
          type: "string",
          description: "Start colour. Default: the colour on the tag now.",
        },
      ],
    },
    {
      type: "p",
      text: "`transitionTo` and `restore` return `{ finished, stop }`. `finished` resolves when the tint lands or a later call takes over. `stop()` keeps the current tint. The change is immediate for reduced motion, a `duration` of `0`, or a colour that cannot be parsed.",
    },
    {
      type: "code",
      label: "sheet.tsx",
      lang: "tsx",
      code: `const chrome = useChromeTint()

function onOpen() {
  chrome.transitionTo("#8f8f8e", { duration: 0.38, easing: [0.32, 0.72, 0, 1] })
}
function onClose() {
  chrome.restore({ duration: 0.22 })
}`,
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "Most browsers ignore it. Firefox never supports it.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "Only the top bar changes. The Android navigation bar follows the device theme.",
        },
        { target: "Installed PWA", status: "no", note: "No toolbar." },
        { target: "iOS", status: "no", note: "No toolbar." },
        { target: "Android", status: "no", note: "No toolbar." },
      ],
    },

    { type: "h2", text: "useStatusBar" },
    {
      type: "api",
      name: "useStatusBar()",
      signature: 'function useStatusBar(appearance: "light" | "dark"): void',
      description:
        "Native only. Sets the icon style of the system bars and draws the app edge to edge. The app shell already calls it with the theme. Call it only on a screen with a different background, such as a dark photo viewer.",
      params: [
        {
          name: "appearance",
          type: '"light" | "dark"',
          required: true,
          description:
            'The content behind the bars. `"dark"` gives light icons.',
        },
      ],
    },
    {
      type: "p",
      text: "The bar background is the page colour under the inset. On Android, the style also applies to the navigation bar.",
    },
    {
      type: "code",
      label: "photo-viewer.tsx",
      lang: "tsx",
      code: `function PhotoViewer() {
  useStatusBar("dark") // light icons over the black viewer
  return <View className="flex-1 bg-black pt-safe">...</View>
}`,
    },
    {
      type: "note",
      tone: "info",
      text: "The hook does not restore the old style on unmount. In cleanup, call `applyStatusBar(theme)` from [capabilities](/docs/capabilities).",
    },
    {
      type: "targets",
      rows: [
        { target: "Desktop web", status: "no", note: "Does nothing." },
        { target: "Mobile web", status: "no", note: "Does nothing." },
        { target: "Installed PWA", status: "no", note: "Does nothing." },
        { target: "iOS", status: "yes" },
        { target: "Android", status: "yes" },
      ],
    },
  ],
}

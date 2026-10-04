import { HooksDeviceDemo } from "@/components/docs-demos/hooks-device-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "hooks-device",
  title: "Device and display hooks",
  summary:
    "Read the device, the safe area, media queries, orientation, motion preference and theme, and drive the browser toolbar and native status bar.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { useDevice, useInsets, useMediaQuery, useOrientation, useReducedMotion, useTheme, useChromeTint, useStatusBar } from "@arrzdev/adaptv/hooks"',
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
} from "@arrzdev/adaptv/hooks"

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
      text: "Every hook on this page is safe to call during server rendering. Each returns a fixed, documented value on the server and during hydration, then settles to the live value on the client. Where that first value matters it is listed under the hook.",
    },
    {
      type: "p",
      text: "Each hook wraps a plain function from [capabilities](/docs/capabilities). Use the hook inside a component; import the capability when the caller is not a component.",
    },

    { type: "h2", text: "useDevice" },
    {
      type: "api",
      name: "useDevice()",
      signature: "function useDevice(): UseDeviceResult",
      description:
        'Hardware and OS facts as one record. The read is memoised for the life of the process, so mounting the hook in ten places costs one native bridge call. Fields a target cannot answer are `null`, never an empty string, so a device sheet can print "not reported here".',
      returns:
        "`{ info, id, languageTag, loading }`. `info` is `null` until the first read settles.",
    },
    {
      type: "props",
      rows: [
        {
          name: "info",
          type: "DeviceInfo | null",
          description:
            "The device record. `null` while loading: one tick on web, one bridge call on native.",
        },
        {
          name: "id",
          type: "string | null",
          description:
            "A stable per-install identifier on native (`identifierForVendor` on iOS, a UUID in app storage on Android). Always `null` on web: a browser has no equivalent and adaptv does not fingerprint. Generate your own and keep it in [storage](/docs/storage) if you need one.",
        },
        {
          name: "languageTag",
          type: "string",
          description:
            'BCP-47 tag from `navigator.language`, for example `"en-GB"`. Empty string until mount.',
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
            "What hosts the page: a browser tab, an installed PWA, or the native shell. Same value as `resolvePlatformTag()` in [utils](/docs/utils).",
        },
        {
          name: "os",
          type: '"ios" | "android" | "web"',
          description:
            '`"web"` means desktop or an OS adaptv does not special-case.',
        },
        {
          name: "osVersion",
          type: "string | null",
          description:
            '`"18.4"`, `"14"`. `null` on desktop and wherever the user agent carries no version.',
        },
        {
          name: "model",
          type: "string | null",
          description:
            '`"iPhone15,2"`, `"Pixel 8"`. On web only Android Chromium reports it.',
        },
        {
          name: "manufacturer",
          type: "string | null",
          description: '`"Apple"`, `"Google"`. `null` on web.',
        },
        {
          name: "isVirtual",
          type: "boolean | null",
          description:
            "`true` in a simulator or emulator, `false` on hardware, `null` on web.",
        },
        {
          name: "webViewVersion",
          type: "string | null",
          description:
            "Native: the WebView build. Web: the browser engine version parsed from the user agent.",
        },
      ],
    },
    {
      type: "code",
      label: "about-screen.tsx",
      lang: "tsx",
      code: `const { info, id, loading } = useDevice()

if (loading) return null
return (
  <Text>
    {info.model ?? "Unknown model"} · {info.os} {info.osVersion ?? ""}
  </Text>
)`,
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "`platform`, `os`, `webViewVersion` and the language tag resolve. `osVersion`, `model`, `manufacturer`, `isVirtual` and `id` are `null`.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "Adds `osVersion`. Android Chromium also reports `model`. `id` stays `null`.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: 'Same as the browser it was installed from, with `platform: "standalone"`.',
        },
        {
          target: "iOS",
          status: "yes",
          note: "Every field, plus a stable `id`. `isVirtual` is `true` on the simulator.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Every field, including a real `webViewVersion`, which decides what CSS and JS the device supports.",
        },
      ],
    },

    { type: "h2", text: "useInsets" },
    {
      type: "api",
      name: "useInsets()",
      signature: "function useInsets(): Insets",
      description:
        "Safe-area insets as numbers in px. Use it when the inset feeds a calculation: a scroll offset, a gesture threshold, available-height maths, a number handed to a native call. For padding, margin and positioning use the CSS utilities from [safe areas](/docs/safe-areas) (`pb-safe`, `pt-safe-offset-2`, `pb-safe-or-4`): they apply before first paint, follow a rotation with no JavaScript and cost no re-render. This hook is one state update behind them.",
      returns:
        "`{ top, right, bottom, left }`, each a number of px, `0` where there is no inset. All zeros on the server and on the first client render; measured in an effect after mount.",
    },
    {
      type: "p",
      text: "The hook re-measures on `orientationchange`, on visual-viewport resize (a collapsing URL bar, a window resize) and when the native shell rewrites the inset variables on `<html>`, which Android does without firing an event. It reads the same `--adaptv-inset-*` variables the CSS utilities read, so the two always agree.",
    },
    {
      type: "api",
      name: "readSafeAreaInsets()",
      signature: "function readSafeAreaInsets(): Insets",
      description:
        "The same measurement, once, with no subscription. For imperative code that wants the current value outside React. Returns zeros on the server.",
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
        {
          target: "Mobile web",
          status: "yes",
          note: "Non-zero in landscape on notched phones, and at the bottom when the page extends under the home indicator.",
        },
        { target: "Installed PWA", status: "yes" },
        { target: "iOS", status: "yes" },
        {
          target: "Android",
          status: "yes",
          note: "The values come from the native shell, which injects them for WebViews older than 140 where a bare `env()` reads 0.",
        },
      ],
    },

    { type: "h2", text: "useMediaQuery" },
    {
      type: "api",
      name: "useMediaQuery()",
      signature: "function useMediaQuery(query: string | null): boolean",
      description:
        "A reactive `matchMedia` result. The app holds one live `MediaQueryList` per distinct query string, shared by every component that asks, so calling it in every row of a list is cheap.",
      params: [
        {
          name: "query",
          type: "string | null",
          required: true,
          description:
            'A media query, for example `"(min-width: 768px)"`. Pass `null` to switch the hook off without breaking hook order; it then returns `false`.',
        },
      ],
      returns:
        "`true` while the query matches. Always `false` on the server and during hydration, then the live match.",
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
      text: "Because the first client render is `false`, a layout that branches on this hook paints the `false` branch first. When the difference is only styling, use a Tailwind breakpoint instead. See [layout shift](/docs/layout-shift).",
    },

    { type: "h2", text: "useOrientation" },
    {
      type: "api",
      name: "useOrientation()",
      signature: "function useOrientation(): UseOrientationResult",
      description:
        "Read the screen orientation, follow it, and lock it where the platform allows. Reading works everywhere. Locking does not: no iOS browser has ever shipped `screen.orientation.lock()`, and Chromium refuses it outside fullscreen or an installed app. `lock` and `unlock` resolve to an outcome and never reject, so you can render every case.",
      returns:
        "`{ orientation, isPortrait, lockSupported, lock, unlock, lastOutcome }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "orientation",
          type: '"portrait-primary" | "portrait-secondary" | "landscape-primary" | "landscape-secondary"',
          description:
            'Live orientation. `"portrait-primary"` on the server. On WebKit older than 16.4 it falls back to a media query and only reports the two `-primary` values.',
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
            "Whether a lock can be attempted at all. `false` on the server and on iOS web. When it is `false`, show a rotate prompt instead of a lock button. `true` does not promise the lock will take.",
        },
        {
          name: "lock",
          type: "(lock: ScreenOrientationLock) => Promise<OrientationLockOutcome>",
          description:
            'Hold the screen in an orientation. Accepts `"any"`, `"natural"`, `"portrait"`, `"landscape"` or one of the four concrete values.',
        },
        {
          name: "unlock",
          type: "() => Promise<OrientationLockOutcome>",
          description: "Release the lock.",
        },
        {
          name: "lastOutcome",
          type: "OrientationLockOutcome | null",
          description:
            "Result of the most recent `lock` or `unlock`, `null` before the first.",
        },
      ],
    },
    {
      type: "table",
      head: ["Outcome", "Meaning"],
      rows: [
        ['`"ok"`', "The platform accepted the call."],
        [
          '`"unsupported"`',
          "There is no lock API here. Asking again cannot help.",
        ],
        [
          '`"rejected"`',
          "The API exists and refused this call: Chromium outside fullscreen or standalone, or a value the OS will not take. A retry from the right context can succeed.",
        ],
      ],
    },
    {
      type: "code",
      label: "video-player.tsx",
      lang: "tsx",
      code: `const { lockSupported, lock, unlock } = useOrientation()

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
          note: 'Reading works. Chromium has the lock API and answers `"rejected"` outside fullscreen.',
        },
        {
          target: "Mobile web",
          status: "partial",
          note: 'Reading works. iOS browsers: `lockSupported` is `false`. Android Chrome: `"rejected"` unless fullscreen.',
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Android: standalone display is the context Chromium wants, so the lock works. iOS: still unsupported.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "Locks through the native plugin.",
        },
        {
          target: "Android",
          status: "partial",
          note: 'Locks on phones. On Android 16+ targeting SDK 36 the OS ignores locks on large screens while still answering `"ok"`, so verify with `orientation` if the lock must hold.',
        },
      ],
    },

    { type: "h2", text: "useReducedMotion" },
    {
      type: "api",
      name: "useReducedMotion()",
      signature: "function useReducedMotion(): boolean",
      description:
        "Reactive `prefers-reduced-motion: reduce`. It is `useMediaQuery` with the query filled in, so it shares the one list per app.",
      returns:
        "`true` when the user asked for less motion. `false` on the server and during hydration.",
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
        'The theme preference, the appearance it resolves to, and the one way to change it. The user\'s preference is `"light"`, `"dark"` or `"system"`; `resolved` is what that paints right now. Every `useTheme` reads the same store, so a settings screen and the shell stay in step. It follows OS appearance changes while the preference is `"system"`, re-applies the theme when the app returns to the foreground, and keeps `<html class="light|dark">`, `color-scheme` and the `data-ui-theme` attribute in step. The app shell already calls it once, so the theme is applied whether or not you call it.',
      returns:
        '`{ preference, resolved, setPreference }`. `setPreference(p)` stamps `<html>`, persists the choice and mirrors it to native. A light/dark toggle sets the opposite of `resolved`, which leaves `"system"` behind.',
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
      text: 'On the first client render the hook reads the class the pre-paint script already put on `<html>`. The server has no DOM and renders `"light"`. If your markup branches on the returned value (`resolved === "dark" ? <Moon /> : <Sun />`), a dark-mode visitor gets a hydration mismatch. Render both and let the `dark:` variant choose, as above. Use the returned value for things that are not markup: a chart palette, a map style, a value passed to a native call.',
    },
    {
      type: "p",
      text: "The preference is stored in `localStorage` under `ui-theme-preference`, and on native it is mirrored to native storage so the OS launch splash follows the app theme on the next launch. The default preference and the two theme colours come from [config](/docs/config). See [theming](/docs/theming) for the whole model.",
    },
    { type: "h3", text: "Setting a specific preference" },
    {
      type: "p",
      text: "For a three-way control (light, dark, system) pass the choice to `setPreference` and mark the selected option with `preference`. Outside a component, call `applyUiThemePreference`, exported from the same module; it is the same function. Every mounted `useTheme` picks the change up.",
    },
    {
      type: "api",
      name: "applyUiThemePreference()",
      signature:
        'function applyUiThemePreference(preference: "light" | "dark" | "system"): void',
      description:
        "Apply a preference: updates `<html>`, writes `localStorage`, and mirrors it to native storage. Client only.",
    },
    {
      type: "api",
      name: "readPreference()",
      signature: 'function readPreference(): "light" | "dark" | "system"',
      description:
        'The stored preference: `localStorage` first, then the `data-ui-theme` attribute, then `"system"`.',
    },
    {
      type: "api",
      name: "getResolvedUiAppearance()",
      signature:
        'function getResolvedUiAppearance(preference: UiThemePreference): "light" | "dark"',
      description:
        'What a preference resolves to now. `"system"` reads `prefers-color-scheme`; on the server it resolves to `"light"`.',
    },
    {
      type: "code",
      label: "appearance-setting.tsx",
      lang: "tsx",
      code: `import { applyUiThemePreference, readPreference } from "@arrzdev/adaptv/hooks"

const [preference, setPreference] = useState(readPreference)

function choose(next: "light" | "dark" | "system") {
  applyUiThemePreference(next)
  setPreference(next)
}`,
    },
    {
      type: "p",
      text: "The module also exports `syncUiThemeAppearance(preference)` (update `<html>` without persisting), `initUiTheme(preference?)` (re-apply the stored preference) and `getUiThemeInitScript(options)` (the blocking `<head>` script as a string). The shell and the [Vite plugin](/docs/vite-plugin) use them; an app rarely needs to.",
    },

    { type: "h2", text: "useChromeTint" },
    {
      type: "api",
      name: "useChromeTint()",
      signature: "function useChromeTint(): UseChromeTint",
      description:
        "Animate the mobile browser's toolbar colour (`<meta name=\"theme-color\">`) from the app's theme colour to another and back, on a `cubic-bezier` you choose. The typical use is dimming the toolbar on the same curve as a sheet's scrim, so the toolbar reads as part of the app. If the component unmounts while it still holds a tint, the tint is restored at once.",
      returns: "`{ supported, base, read, transitionTo, set, restore }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "supported",
          type: "boolean",
          description:
            "Whether there is a `theme-color` tag to write. `false` on the server and the hydration pass. It does not say anyone will see the change; nothing needs it to call the methods safely.",
        },
        {
          name: "base",
          type: "string | null",
          description:
            "The colour `restore()` returns to: whatever the theme (or the route's own `chromeTint`) currently resolves to. Reactive; it changes when the theme flips.",
        },
        {
          name: "read",
          type: "() => string | null",
          description:
            "The colour on the tag right now, mid-transition included. A function on purpose: the value changes every frame during a transition, and making it state would re-render the tree for the whole animation.",
        },
        {
          name: "transitionTo",
          type: "(color: string, options?: ChromeTintOptions) => ChromeTintTransition",
          description:
            "Move the tint to `color` along a curve. A call during another transition takes over from the colour on screen.",
        },
        {
          name: "set",
          type: "(color: string) => void",
          description:
            "Put the tint at `color` now, cancelling any transition. For following a finger, where progress has no clock.",
        },
        {
          name: "restore",
          type: '(options?: Omit<ChromeTintOptions, "from">) => ChromeTintTransition',
          description:
            "Hand the toolbar back to the theme. Does nothing if nothing took it.",
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
            "`[x1, y1, x2, y2]`, exactly as CSS `cubic-bezier()` takes it. The default is CSS `ease`. The type is exported as `EasingBezier` from [utils](/docs/utils).",
        },
        {
          name: "from",
          type: "string",
          description:
            "Start colour. Defaults to whatever the tag reads now, which is what lets an interrupted transition continue from the colour on screen.",
        },
      ],
    },
    {
      type: "p",
      text: "`transitionTo` and `restore` return `{ finished, stop }`. `finished` resolves when the tint lands or a later call takes over; `stop()` leaves the tint where it is. The transition becomes an immediate set when the user prefers reduced motion, when `duration` is `0`, or when either colour is in a format the parser cannot read (for example `color(display-p3 ...)`).",
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
      type: "p",
      text: "Call it unconditionally. Where there is no toolbar to tint the calls run and change nothing visible, so there is no platform check to write.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "The tag is written. Most desktop browsers ignore `theme-color`; Firefox has never supported it.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "Chrome on Android and Safari on iOS 15 to 18 follow the tag. iOS 26.0 to 26.5 ignores it and tints the top bar from the page's own background instead. Only the top bar is ever affected; Android's navigation bar follows the device theme.",
        },
        {
          target: "Installed PWA",
          status: "no",
          note: "No toolbar. The calls run and nothing reads the tag.",
        },
        {
          target: "iOS",
          status: "no",
          note: "No browser chrome in a native build.",
        },
        {
          target: "Android",
          status: "no",
          note: "No browser chrome in a native build.",
        },
      ],
    },

    { type: "h2", text: "useStatusBar" },
    {
      type: "api",
      name: "useStatusBar()",
      signature: 'function useStatusBar(appearance: "light" | "dark"): void',
      description:
        "Native only. Keeps the system bars' icon style readable against the app's theme and puts the app edge to edge, so content draws under the bars and the safe-area utilities pad it back. The app shell already mounts it with the resolved theme; call it yourself only on a screen whose background differs from the theme, such as a full-bleed dark photo viewer in a light app.",
      params: [
        {
          name: "appearance",
          type: '"light" | "dark"',
          required: true,
          description:
            'The appearance of the content behind the bars. `"dark"` gives light icons, `"light"` gives dark icons.',
        },
      ],
    },
    {
      type: "p",
      text: "It takes no colour. The bar background is whatever the page paints under the inset, because setting a bar colour natively no longer works on Android 15+ and never did on iOS. On Android the style applies to both the status bar and the navigation bar.",
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
      text: "The hook does not restore the previous style on unmount. The shell's own `useStatusBar` re-applies only when the theme changes, so after leaving a screen that overrode the style, call `applyStatusBar(theme)` from [capabilities](/docs/capabilities) in that screen's cleanup.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "no",
          note: "No-op. The browser owns its chrome.",
        },
        { target: "Mobile web", status: "no", note: "No-op." },
        {
          target: "Installed PWA",
          status: "no",
          note: "No-op. An installed PWA has no icon-style control.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "Icon style, and the WebView is laid out under the status bar.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Icon style for both bars. Edge to edge is set by the generated activity at launch; the hook re-checks during the first two seconds of boot that the safe-area values arrived.",
        },
      ],
    },
  ],
}

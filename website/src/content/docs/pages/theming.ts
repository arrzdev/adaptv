import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "theming",
  title: "Theming",
  summary:
    "Light and dark: the class on `<html>`, how it is resolved before first paint, `themeColor`, `useTheme`, and what the system bars and browser chrome do on each target.",
  blocks: [
    {
      type: "p",
      text: "adaptv's theme is one class on `<html>`, `light` or `dark`, set by a blocking script in the head before anything paints. Your colours are yours: define them as CSS variables and let Tailwind's `dark:` variant or a `.dark` block switch them. adaptv owns the resolution, the persistence, the launch background and the colour of the chrome around your app.",
    },
    { type: "h2", text: "Set the theme colours" },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `export default defineApp({
  // The app's background in each theme.
  themeColor: { light: "#fbfbfd", dark: "#0b0c14" },
  // Optional. "system" is the default.
  defaultThemePreference: "system",
})`,
    },
    {
      type: "p",
      text: "`themeColor` is required. Give `light`, `dark` or both; a missing side falls back to the other, so a single-colour app sets one. Exactly these two values are used for:",
    },
    {
      type: "ul",
      items: [
        "the inline critical CSS that paints `html` and `body` before your stylesheet loads, so a launch never flashes white;",
        'the `<meta name="theme-color">` tag, which adaptv creates and keeps in sync (do not add your own);',
        "the `html` and `body` background at runtime, which is what current iOS reads to colour the bars;",
        "the native launch screen's mask colour and the manifest's `background_color` (override with `splashMaskLightColor`, `splashMaskDarkColor`, `backgroundColor`). See [Icons and splash](/docs/icons-and-splash).",
      ],
    },
    {
      type: "note",
      text: "Make `themeColor` match the background your pages paint. adaptv sets `background-color` on `html` and `body` with an inline important style so the bars and the overscan area take it. A page whose own background differs will show `themeColor` in the safe-area bands around it.",
    },
    { type: "h2", text: "Write the two palettes" },
    {
      type: "p",
      text: "adaptv's stylesheet defines `dark:` as `&:where(.dark, .dark *)` and `light:` the same way, so both follow the class and ignore the OS media query. Use them directly, or define tokens once and switch their values. This site does the second: a dark theme is a second set of values and never a second set of class names.",
    },
    {
      type: "code",
      label: "src/styles/main.css",
      lang: "text",
      code: `@import "tailwindcss";
@import "@arrzdev/adaptv/styles.css";

:root {
  color-scheme: light;
  --background: #ffffff;
  --foreground: #0a0a0c;
  --border: #ececee;
}

.dark {
  color-scheme: dark;
  --background: #08080a;
  --foreground: #f5f5f7;
  --border: #1c1c21;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-border: var(--border);
}`,
    },
    {
      type: "code",
      label: "card.tsx",
      lang: "tsx",
      code: `// tokens: one class, both themes
<View className="border border-border bg-background text-foreground" />

// or the variant
<View className="bg-white dark:bg-black" />`,
    },
    { type: "h2", text: "How the theme is resolved before paint" },
    {
      type: "p",
      text: "adaptv inlines a small script at the top of `<head>`. It is generated at build time from your config and runs before the first frame on every target, server-rendered or not. In order, it:",
    },
    {
      type: "ol",
      items: [
        "reads the stored preference from `localStorage` (`ui-theme-preference`: `light`, `dark` or `system`), then the `data-ui-theme` attribute on `<html>`, then `defaultThemePreference`;",
        "resolves `system` with `prefers-color-scheme`;",
        "sets the `light` or `dark` class, `color-scheme`, and `data-ui-theme` on `<html>`;",
        "paints the `html` background and seeds the `theme-color` meta with the matching `themeColor`, or with the route's `chromeTint` when the launch URL has one;",
        "sets the `color-scheme` meta to `light dark` in system mode and to the single resolved value otherwise, so an app forced to one theme is not recoloured by the device's.",
      ],
    },
    {
      type: "p",
      text: "A second stamp in the same script sets `data-adaptv-platform` and `data-adaptv-os`, which is what `app:` and `web:` read. Because all of it lands before first paint there is no flash of the wrong theme, and CSS that keys off these never mismatches on hydration. After hydration the shell keeps the class, the meta and the background in sync when the user toggles, when the OS appearance changes in system mode, and when the app comes back from the background.",
    },
    { type: "h2", text: "Read and change the theme" },
    {
      type: "code",
      label: "theme-toggle.tsx",
      lang: "tsx",
      code: `import { useTheme } from "@arrzdev/adaptv/hooks"
import { Moon, Sun } from "lucide-react"

function ThemeToggle() {
  const [, toggleTheme] = useTheme()
  return (
    <button type="button" onClick={toggleTheme} aria-label="Toggle light and dark">
      <Sun className="hidden size-5 dark:block" />
      <Moon className="size-5 dark:hidden" />
    </button>
  )
}`,
    },
    {
      type: "p",
      text: '[useTheme](/docs/hooks-device) returns `[resolved, toggle]`: the resolved appearance, `"light"` or `"dark"`, and a function that flips to the other one and persists it. The toggle never returns to `system`. For a three-way picker, call `applyUiThemePreference("light" | "dark" | "system")` and read the stored choice with `readPreference()` after mount, both exported from `@arrzdev/adaptv/hooks`. Every mounted `useTheme` follows the change, because the hook observes the class on `<html>`.',
    },
    {
      type: "code",
      label: "appearance-setting.tsx",
      lang: "tsx",
      code: `import {
  applyUiThemePreference,
  readPreference,
  type UiThemePreference,
} from "@arrzdev/adaptv/hooks"

const OPTIONS = ["light", "dark", "system"] as const

function AppearanceSetting() {
  // Read after mount: the server cannot know the stored choice.
  const [value, setValue] = useState<UiThemePreference | null>(null)
  useEffect(() => setValue(readPreference()), [])
  return OPTIONS.map((option) => (
    <Pressable
      key={option}
      className={cn("flex px-4 py-3", value === option && "font-semibold")}
      onPress={() => {
        applyUiThemePreference(option)
        setValue(option)
      }}
    >
      {option}
    </Pressable>
  ))
}`,
    },
    {
      type: "p",
      text: 'On a native build the preference is also written to native storage, so the OS launch screen\'s mask follows the app\'s theme on the next launch. `splashMaskMode` changes that: `"preferences"` (the default), `"system"`, `"light"` or `"dark"`.',
    },
    { type: "h3", text: "The hydration caveat" },
    {
      type: "note",
      tone: "warn",
      text: "Do not branch **markup** on `useTheme()` in a server-rendered app. The server cannot know the visitor's theme and renders `\"light\"`. The client reads the real value off `<html>` on its very first render, so a dark-mode visitor gets different markup and React reports a hydration mismatch. Render both versions and let CSS pick, as the toggle above does with `dark:block` and `dark:hidden`. Using the value in an effect, a handler, or a prop that does not change the HTML (a chart's colour option, for instance) is fine.",
    },
    {
      type: "code",
      label: "logo.tsx",
      lang: "tsx",
      code: `// Mismatches for every dark-mode visitor:
const [theme] = useTheme()
return theme === "dark" ? <LogoLight /> : <LogoDark />

// Correct on the first frame, on every target:
return (
  <>
    <LogoDark className="dark:hidden" />
    <LogoLight className="hidden dark:block" />
  </>
)`,
    },
    { type: "h2", text: "System bars and browser chrome" },
    {
      type: "p",
      text: "What surrounds your app differs by target, and only some of it is yours to colour. adaptv sets every page-level signal (`theme-color`, `color-scheme`, the `html` and `body` background, `viewport-fit=cover`) and, on native, the system bars' icon style. The table is what those signals achieve.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "No system bars. Firefox has never read `theme-color`, and Safari on macOS 26 applies it to installed web apps only.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "iOS 18 and earlier: `theme-color` tints the top bar. iOS 26: the tag is ignored; Safari takes the top and bottom bands from the rendered `html`/`body` background, and content painted to the edge wins over both. Android Chrome: `theme-color` tints the top bar only. The bottom navigation bar follows the device theme.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "iOS: the bands come from the page's own pixels, as above. Android: the navigation bar is the OS's (device theme, or opaque black on older Chrome) and no meta tag, manifest key or CSS colours it.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "Edge to edge. Your background shows under the status bar and home indicator, and the status bar's icons switch between light and dark content with the theme.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Edge to edge with transparent bars. Both the status bar and the navigation bar show your background, and both bars' icons follow the theme.",
        },
      ],
    },
    {
      type: "p",
      text: "On native the bar background is CSS: it is whatever your page paints under the inset, which is why [safe-area padding](/docs/safe-areas) and a full-bleed background go together. The shell sets the icon style from the resolved theme for you. Call [useStatusBar](/docs/hooks-device) yourself only for a screen that needs the opposite, such as a dark photo viewer inside a light app.",
    },
    { type: "h3", text: "One route, its own chrome" },
    {
      type: "p",
      text: "A route can pin the chrome to a colour with the `chromeTint` option. It drives the meta tag and the `html`/`body` paint together, so it works on current iOS as well as Android.",
    },
    {
      type: "code",
      label: "src/routing/pages/settings.page.tsx",
      lang: "tsx",
      code: `export const Route = createFileRoute("/settings")({
  chromeTint: "#1e0033",
  component: Settings,
})`,
    },
    {
      type: "ul",
      items: [
        "**It must be a string literal**, or a top-level `const` declared in the same file. adaptv reads it out of the source at build time and inlines a table into the pre-paint script, so a cold launch straight onto the route shows the tint on the first frame. A computed or imported value fails the build.",
        "**One colour for both themes.** A route that should follow the theme declares nothing.",
        "**No inheritance.** A route without a tint gets `themeColor`, never the tint of a layout above it.",
      ],
    },
    {
      type: "p",
      text: "To animate the chrome, for example dimming the toolbar while a sheet opens, use [useChromeTint](/docs/hooks-device). It writes only the meta tag, so it is visible on Android Chrome and iOS 18 and earlier and does nothing on iOS 26, Firefox, an installed PWA or a native build. Call it unconditionally and treat it as an enhancement.",
    },
    { type: "h2", text: "What goes wrong" },
    {
      type: "table",
      head: ["Symptom", "Cause", "Fix"],
      rows: [
        [
          "`dark:` classes never apply in an OS set to dark.",
          "The stored preference is `light`, or `defaultThemePreference` forces it. `dark:` follows the class, never the media query.",
          'Check `localStorage["ui-theme-preference"]` and the config.',
        ],
        [
          "A strip of the wrong colour above or below the app on iPhone.",
          "`themeColor` differs from the page's background, and the safe-area bands show `themeColor`.",
          "Make them the same colour, or give the route a `chromeTint`.",
        ],
        [
          "A hydration mismatch that only dark-mode users hit.",
          "Markup branches on `useTheme()`.",
          "Render both and switch with `dark:`.",
        ],
        [
          "A second `theme-color` meta in the head fights adaptv's.",
          "The app added its own tag.",
          "Remove it. Set `themeColor`, or `chromeTint` per route.",
        ],
        [
          "The Android navigation bar stays black or white in the installed PWA.",
          "It is owned by the OS on the web. Only the native build controls it.",
          "Nothing to fix on the web. Ship the native build where it matters.",
        ],
        [
          "Your own `background-color` on `body` is ignored.",
          "adaptv writes it inline and important, from `themeColor`.",
          "Put the colour in `themeColor` and paint page backgrounds on the page root.",
        ],
      ],
    },
  ],
}

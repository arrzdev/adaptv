import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "theming",
  title: "Theming",
  summary:
    "Light and dark: the class on `<html>`, `themeColor`, `useTheme`, and what the system bars do on each target.",
  blocks: [
    {
      type: "p",
      text: "A script in the head sets one class on `<html>`, `light` or `dark`, before anything paints. Your colours are yours: define them as CSS custom properties and switch their values. adaptv resolves the preference and colours the chrome.",
    },
    { type: "h2", text: "Set the theme colours" },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `export default defineApp({
  themeColor: { light: "#fbfbfd", dark: "#0b0c14" },
  defaultThemePreference: "system",
})`,
    },
    {
      type: "p",
      text: "`themeColor` is required. Give one side or both. A missing side uses the other. adaptv uses it for:",
    },
    {
      type: "ul",
      items: [
        "the inline CSS that paints `html` and `body` before your stylesheet loads;",
        'the `<meta name="theme-color">` tag. adaptv owns it (id `theme-color-class-override`), so add no tag of your own;',
        "the `html` and `body` background, which iOS reads to colour the bars;",
        "the native launch screen and the manifest `background_color`. See [Icons and splash](/docs/icons-and-splash).",
      ],
    },
    {
      type: "note",
      text: "Make `themeColor` match the background your pages paint. A page background that differs shows `themeColor` in the safe-area bands.",
    },
    { type: "h2", text: "Write the two palettes" },
    {
      type: "p",
      text: "Switch token values. Use Tailwind's names. See [Styling](/docs/styling).",
    },
    {
      type: "code",
      label: "src/styles/main.css",
      lang: "text",
      code: `@import "@arrzdev/adaptv/styles.css";

:root {
  color-scheme: light;
  --color-background: #ffffff;
  --color-foreground: #0a0a0c;
}

.dark {
  color-scheme: dark;
  --color-background: #08080a;
  --color-foreground: #f5f5f7;
}`,
    },
    {
      type: "p",
      text: "Rules follow the class, not the OS media query. For a rule in one theme, use `:where(.dark, .dark *)`. In Tailwind, use `dark:` and `light:`.",
    },
    {
      type: "note",
      text: "Today adaptv still needs Tailwind v4, and `styles.css` carries `dark:` and `light:`. The plain-CSS setup and `@arrzdev/adaptv/tailwind.css` are coming.",
    },
    { type: "h2", text: "How the theme is resolved" },
    {
      type: "p",
      text: "A script built from your config runs before first paint. It reads the stored preference (`ui-theme-preference` in `localStorage`), then `data-ui-theme` on `<html>`, then `defaultThemePreference`. It resolves `system` with `prefers-color-scheme`. Then it sets the class, `color-scheme` and the `theme-color` meta, and paints the `html` background. So the wrong theme never flashes. After that, the shell keeps them in sync.",
    },
    { type: "h2", text: "Read and change the theme" },
    {
      type: "code",
      label: "theme-toggle.tsx",
      lang: "tsx",
      code: `import { useTheme } from "@arrzdev/adaptv/hooks"

function ThemeToggle() {
  const { resolved, setPreference } = useTheme()
  return (
    <button
      type="button"
      onClick={() => setPreference(resolved === "dark" ? "light" : "dark")}
    >
      {resolved === "dark" ? "Light mode" : "Dark mode"}
    </button>
  )
}`,
    },
    {
      type: "p",
      text: '[useTheme](/docs/hooks-device) returns `{ preference, resolved, setPreference }`. `preference` is the user\'s choice: `"light"`, `"dark"` or `"system"`. `resolved` is what is painted: `"light"` or `"dark"`. `setPreference` stores a new choice. On native, the launch screen follows it unless `splashMaskMode` says otherwise.',
    },
    {
      type: "note",
      text: 'In a server-rendered app, the server renders `preference: "system"` and `resolved: "light"`. The first client render answers the same. The hook then re-renders with the real value before paint. So branching markup on `resolved` causes no hydration mismatch. It costs one extra render.',
    },
    { type: "h2", text: "System bars and browser chrome" },
    {
      type: "p",
      text: "adaptv sets `theme-color`, `color-scheme` and the `html` and `body` background. On native it also sets the system bar icon style.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "No system bars. Firefox ignores `theme-color`.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "iOS 18 and earlier: `theme-color` tints the top bar. iOS 26: the bands take the `html` and `body` background. Android Chrome: `theme-color` tints the top bar only.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "iOS: the bands show your page's pixels. Android: the navigation bar follows the device theme, or is opaque black on older Chrome. Nothing you write colours it.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "Edge to edge. Your background shows under the bars. The icons follow the theme.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Edge to edge, with transparent bars. The icons follow the theme.",
        },
      ],
    },
    {
      type: "p",
      text: "On native, the bar background is what your page paints under the inset. Pair [safe-area padding](/docs/safe-areas) with a full-bleed background. For the opposite icon style, call [useStatusBar](/docs/hooks-device).",
    },
    { type: "h3", text: "One route, its own chrome" },
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
      type: "p",
      text: "`chromeTint` sets the meta tag and the `html` and `body` paint for that route. It is one colour for both themes. A route without it gets `themeColor`, not a parent's tint. The value must be a literal string or a same-file `const`.",
    },
    {
      type: "p",
      text: "To animate the chrome, use [useChromeTint](/docs/hooks-device). It writes only the meta tag, so it works on Android Chrome and iOS 18 and earlier.",
    },
    { type: "h2", text: "What goes wrong" },
    {
      type: "table",
      head: ["Symptom", "Cause and fix"],
      rows: [
        [
          "Dark rules never apply when the OS is dark.",
          'The stored preference is `light`, or the config forces it. Check `localStorage["ui-theme-preference"]`.',
        ],
        [
          "Wrong-coloured strip on iPhone.",
          "`themeColor` differs from the page background. Make them match, or set a `chromeTint`.",
        ],
        [
          "A second `theme-color` meta fights adaptv's.",
          "Remove your own tag. Use `themeColor`.",
        ],
      ],
    },
  ],
}

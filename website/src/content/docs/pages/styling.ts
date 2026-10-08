import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "styling",
  title: "Styling",
  summary:
    "adaptv works with any CSS. Tailwind is optional. Your class beats adaptv's default look, and tokens are plain CSS custom properties.",
  blocks: [
    {
      type: "p",
      text: "adaptv ships no palette and no theme object. The default look of a component is plain CSS in the cascade layer `adaptv.components`. It is keyed on the `data-adaptv` and `data-part` attributes that the component renders. Your CSS can be plain CSS, SCSS, CSS modules or Tailwind.",
    },
    { type: "h2", text: "Setup" },
    {
      type: "code",
      label: "Plain CSS: src/styles/main.css",
      lang: "text",
      code: `@import "adaptv/styles.css";

:root {
  --color-primary: oklch(0.55 0.22 264);
}`,
    },
    {
      type: "code",
      label: "Tailwind: src/styles/main.css",
      lang: "text",
      code: `@import "tailwindcss";
@import "adaptv/tailwind.css";

@theme {
  --color-primary: oklch(0.55 0.22 264);
}`,
    },
    {
      type: "p",
      text: "Point `styles` in `adaptv.config.ts` at this file. In Tailwind, list `adaptv()` before `tailwindcss()` in `vite.config.ts`. See the [Vite plugin](/docs/vite-plugin).",
    },
    { type: "h2", text: "Your class wins" },
    {
      type: "p",
      text: "A component has three tiers. The cascade orders them.",
    },
    {
      type: "ul",
      items: [
        "**Default.** adaptv's rule in `@layer adaptv.components`, with zero specificity.",
        "**Yours.** `className` and `style`. Plain CSS, a CSS module or a Tailwind utility all beat the default.",
        "**Locked.** Inline `style` that the component sets last. It beats your class.",
      ],
    },
    {
      type: "p",
      text: 'Few values are locked. Each component page lists them. For example, `View safe="bottom"` locks its bottom padding, so `<View safe="bottom" className="pb-0">` keeps its inset. Behaviour is a prop and look is a class. If a class has no effect, find the prop that owns that behaviour.',
    },
    { type: "h2", text: "Style from data attributes" },
    {
      type: "p",
      text: 'A component sets `data-adaptv="<name>"`. A part inside it sets `data-part="<part>"`. State is a data attribute: `data-pressed`, `data-disabled`, `data-state`. State is never a class name. So global CSS can restyle every instance, with no import and no wrapper.',
    },
    {
      type: "code",
      label: "main.css",
      lang: "text",
      code: `/* Every drawer in the app */
[data-adaptv="drawer"][data-part="content"] {
  border-radius: 20px 20px 0 0;
}

/* One button. In Tailwind: data-pressed:scale-95 */
.save-button[data-pressed] {
  scale: 0.95;
}`,
    },
    { type: "h2", text: "Tokens" },
    {
      type: "p",
      text: "A token is a CSS custom property with the name Tailwind uses. In plain CSS, set it in `:root`. In Tailwind, set it in `@theme`. adaptv reads tokens and defines none.",
    },
    {
      type: "ul",
      items: [
        "Tailwind's own tokens (`--color-*`, `--radius-*`, `--spacing`, `--text-*`) fall back to Tailwind's defaults. An app that sets none looks like a Tailwind app.",
        "Six tokens have no fallback: `--color-background`, `--color-foreground`, `--color-surface`, `--color-border`, `--color-muted` and `--color-primary`.",
        "`--adaptv-ring` sets the keyboard focus ring colour. The default is `currentColor`.",
      ],
    },
    {
      type: "p",
      text: "For a darker shade, use `color-mix(in oklch, var(--color-primary), black 12%)`. For dark mode, see [Theming](/docs/theming).",
    },
    { type: "h2", text: "Safe areas and the keyboard" },
    {
      type: "p",
      text: "`--adaptv-inset-top`, `-right`, `-bottom` and `-left` are always defined. They are `0px` where there is no inset. Use them, not `env(safe-area-inset-*)`: older Android web views read zero.",
    },
    {
      type: "code",
      label: "main.css",
      lang: "text",
      code: `.footer {
  padding-bottom: var(--adaptv-inset-bottom);                 /* pb-safe */
  padding-bottom: calc(var(--adaptv-inset-bottom) + 0.5rem);  /* pb-safe-offset-2 */
  padding-bottom: max(var(--adaptv-inset-bottom), 1rem);      /* pb-safe-or-4 */
}`,
    },
    {
      type: "p",
      text: "The comments name the Tailwind utilities that `tailwind.css` adds. See [Safe areas](/docs/safe-areas). For a whole box, use the `safe` prop on [View](/docs/view).",
    },
    {
      type: "p",
      text: "`--adaptv-keyboard-height` is always defined and rests at `0px`. While the keyboard is up and a component that calls `useKeyboard` is mounted, it holds the height and `<html>` carries `data-keyboard-open`. The attribute is on `<html>`, so a child needs the parent form: `html[data-keyboard-open] .tab-bar { display: none }`. In Tailwind, write `[html[data-keyboard-open]_&]:hidden`. See [Keyboard](/docs/keyboard).",
    },
    { type: "h2", text: "Platform and press state" },
    {
      type: "p",
      text: "Before first paint, adaptv sets `data-adaptv-platform` (`web`, `standalone` or `native`) and `data-adaptv-os` (`ios`, `android` or `web`) on `<html>`. Nothing re-renders. A native web view reports `display-mode: browser`, so a media query cannot find it.",
    },
    {
      type: "table",
      head: ["Tailwind variant", "Plain CSS"],
      rows: [
        [
          "`app:` (installed or native)",
          '`@media (display-mode: standalone)` and `html[data-adaptv-platform="native"]`',
        ],
        ["`web:` (browser tab)", '`html[data-adaptv-platform="web"]`'],
        ["`dark:`", "`:where(.dark, .dark *)`"],
        ["None for the OS", '`html[data-adaptv-os="ios"]`'],
      ],
    },
    {
      type: "p",
      text: "To branch in JavaScript, use `isInstalledApp()`, `isNativePlatform()` and `getOS()` from `adaptv/utils`. Do not use `matchMedia`.",
    },
    {
      type: "p",
      text: "Write `:hover` and `:active` as usual. adaptv corrects them in the built CSS, in any kind of CSS. A hover style does not stick after a tap, and it does not repaint a focus ring. On a component with the press engine, `:active` follows `data-pressed`. On your own elements it stays native.",
    },
    { type: "h2", text: "App-feel resets" },
    {
      type: "p",
      text: 'Three resets make an installed app feel less like a web page. Set each in the `ui` block of the [config](/docs/config) to `"app"` (installed and native only), `"all"` or `"off"`.',
    },
    {
      type: "ul",
      items: [
        '`ui.noSelect` (default `"app"`): `user-select: none`, so a long press is not a text selection. Inputs stay selectable.',
        '`ui.hideScrollbars` (default `"all"`): `showsVerticalScrollIndicator` on [ScrollView](/docs/scroll-view) shows them again.',
        '`ui.touchCallout` (default `"app"`): hides the iOS long-press preview on links.',
      ],
    },
    {
      type: "p",
      text: "To undo a reset on one element, write your own rule. It wins without `!important`. The `selectable` prop on [Text](/docs/text) does the same for text. In Tailwind, the `selectable` class works too.",
    },
    {
      type: "code",
      label: "main.css",
      lang: "text",
      code: `.article-body {
  user-select: text;
}`,
    },
    {
      type: "p",
      text: "Some resets have no switch: no focus ring on click or tap (keyboard focus keeps a 2px outline), no grey tap flash on links, and no yellow WebKit autofill.",
    },
    { type: "h2", text: "A wrapper for your design system" },
    {
      type: "p",
      text: "Make one wrapper per variant. Pass `className` and `ref` through. adaptv joins class lists and does not merge them. To resolve conflicting Tailwind classes, use `tailwind-merge`.",
    },
    { type: "h2", text: "What goes wrong" },
    {
      type: "table",
      head: ["Symptom", "Cause and fix"],
      rows: [
        [
          "A class has no effect on a component.",
          "It conflicts with a locked inline style. Use the prop that owns that behaviour.",
        ],
        [
          "adaptv's resets beat your Tailwind classes.",
          "`tailwindcss()` is before `adaptv()`, or the stylesheet is built outside the plugin. Fix the order, or write `@layer theme, base, adaptv, components, utilities;` as the first line.",
        ],
        [
          "Users cannot select text in the installed app.",
          'Add `selectable` where text must be copyable, or set `ui: { noSelect: "off" }`.',
        ],
      ],
    },
  ],
}

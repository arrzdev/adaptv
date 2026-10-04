import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "styling",
  title: "Styling",
  summary:
    "Tailwind v4 is the styling system. adaptv adds one stylesheet that corrects `hover:` and `active:`, adds the `app:` and `web:` variants and the safe-area utilities, and resets what makes a page feel like a page.",
  blocks: [
    {
      type: "p",
      text: "adaptv components ship unstyled, or with a neutral grey baseline, and take your Tailwind classes through `className`. adaptv has no palette, no spacing scale and no theme object. Tailwind v4 is a hard requirement, because two of the fixes below work by rewriting what `hover:` and `active:` compile to, and only a build-time tool can reach code you already wrote.",
    },
    { type: "h2", text: "Setup" },
    {
      type: "code",
      label: "src/styles/main.css",
      lang: "text",
      code: `@import "tailwindcss";
@import "@arrzdev/adaptv/styles.css";

@theme {
  --color-primary: oklch(0.55 0.22 264);
  --radius-card: 1.25rem;
}`,
    },
    {
      type: "p",
      text: "Point `styles` in `adaptv.config.ts` at this file and adaptv builds it and links it in the head. In `vite.config.ts`, list `adaptv()` before `tailwindcss()`.",
    },
    { type: "h3", text: "The cascade-layer line" },
    {
      type: "p",
      text: "Everything adaptv ships lives in a cascade layer named `adaptv`, ordered between Tailwind's `base` and `components`. That order is what lets your utilities beat adaptv's resets without `!important`. CSS fixes layer order by first mention, so the order has to be declared before any `@import`:",
    },
    {
      type: "code",
      label: "What the plugin prepends",
      lang: "text",
      code: `@layer theme, base, adaptv, components, utilities;`,
    },
    {
      type: "p",
      text: "The `adaptv()` plugin writes that line into your Tailwind entry stylesheet at build time and leaves a hand-written one alone. It warns when it cannot find a Tailwind entry. Write the line yourself anywhere the plugin does not run, such as Storybook or a test harness that imports `styles.css` directly. Without it, `adaptv` registers after `utilities` and every adaptv reset starts beating your classes.",
    },
    { type: "h2", text: "Variants" },
    {
      type: "p",
      text: "adaptv defines six variants, and the set is closed. Two are corrections to variants you already use. Four expose state that is stamped on `<html>` before first paint, so they cost no re-render and cannot cause a hydration mismatch.",
    },
    {
      type: "table",
      head: ["Variant", "Applies when", "Kind"],
      rows: [
        [
          "`hover:`",
          "The pointer can hover (`@media (hover: hover)`) and the element is not focused. A hover style no longer sticks after a tap, and no longer repaints a focus ring grey when the mouse passes over a focused control.",
          "Correction",
        ],
        [
          "`active:`",
          "The element is pressed. On adaptv's pressable components that means the press engine's `data-pressed`; on a plain element it means native `:active`.",
          "Correction",
        ],
        [
          "`app:`",
          "The app is installed: a home-screen PWA (`display-mode: standalone`) or a native build.",
          "State",
        ],
        ["`web:`", "The app is in a real browser tab.", "State"],
        [
          "`dark:` / `light:`",
          "`<html>` carries the `dark` or `light` class. See [Theming](/docs/theming).",
          "State",
        ],
      ],
    },
    {
      type: "code",
      label: "header.tsx",
      lang: "tsx",
      code: `// A back arrow only where there is no browser back button, and
// safe-area padding only where there is a notch to clear.
<View row className="web:py-4 app:py-safe-offset-2">
  <BackButton className="web:hidden app:flex" />
  <Title />
</View>`,
    },
    {
      type: "p",
      text: "`app:` and `web:` are not media queries alone, because a native web view reports `display-mode: browser`. adaptv stamps `data-adaptv-platform` (`web`, `standalone` or `native`) on `<html>` in a blocking head script and the variants read it.",
    },
    {
      type: "p",
      text: 'There is no `ios:` or `android:` variant. The OS is on `<html>` as `data-adaptv-os` (`ios`, `android` or `web`), so CSS can say `[data-adaptv-os="ios"] .toolbar { … }`, and code can call `getOS()` from `@arrzdev/adaptv/utils`, which is constant for the session. There are no negated variants either: Tailwind\'s `not-*` composes with every variant above.',
    },
    { type: "h3", text: "How `active:` reaches the press engine" },
    {
      type: "p",
      text: "Native `:active` has two problems on a touch screen. It cannot be cleared from JavaScript, and it does not light again when a finger drags off a button and slides back on. adaptv's [Button](/docs/button), [Pressable](/docs/pressable), [Link](/docs/link) and the other pressable components run a gesture engine that tracks the press itself and sets `data-pressed` while the pointer is down inside the press region. The engine also puts a `data-press-engine` marker on the element.",
    },
    {
      type: "p",
      text: "adaptv redefines `active:` with two branches: `&[data-pressed]`, and `&:active:not([data-press-engine])`. So `active:scale-95` on a `Button` follows the engine, and the same class on your own `<button>` is native `:active`, unchanged. There is no `pressed:` variant to learn.",
    },
    {
      type: "code",
      label: "save-button.tsx",
      lang: "tsx",
      code: `<Button
  onClick={save}
  className="origin-center rounded-xl bg-blue-600 px-4 py-2 text-white transition-transform duration-200 active:scale-95 active:duration-0"
>
  <Button.Text>Save</Button.Text>
</Button>`,
    },
    {
      type: "note",
      text: "`data-pressed` is pointer-only. Activating a button with the keyboard does not set it, so `active:` styles do not flash on Enter or Space. Style keyboard focus with `focus-visible:`.",
    },
    { type: "h2", text: "Safe-area utilities" },
    {
      type: "p",
      text: "Padding, margin and inset utilities for the device's safe-area insets. Each side has three forms, and every one resolves to zero where there is no inset, which includes a browser tab.",
    },
    {
      type: "table",
      head: ["Form", "Example", "Computes to"],
      rows: [
        ["The inset", "`pb-safe`", "the bottom inset"],
        [
          "The inset plus a gap",
          "`pb-safe-offset-4`",
          "the inset + 4 spacing units",
        ],
        [
          "The inset with a floor",
          "`pb-safe-or-4`",
          "the larger of the inset and 4 spacing units",
        ],
      ],
    },
    {
      type: "p",
      text: "The families are `p`, `px`, `py`, `ps`, `pe`, `pt`, `pr`, `pb`, `pl`; the same nine for margin (`m`, `mx`, … `ml`); and `inset`, `inset-x`, `inset-y`, `start`, `end`, `top`, `right`, `bottom`, `left`. The suffix takes an integer or an arbitrary integer such as `pt-safe-offset-[7]`. There are no negative forms, no `scroll-p*` forms and no `h-screen-safe` family.",
    },
    {
      type: "p",
      text: "They read four custom properties that are always defined: `--adaptv-inset-top`, `-right`, `-bottom` and `-left`. Use those in your own CSS and never write `env(safe-area-inset-*)` directly. On older Android web views `env()` reads zero, and adaptv's properties take the value the native shell injects first and fall back to `env()` second. For a whole box, prefer the `safe` prop on [View](/docs/view), which wins over a conflicting padding class. [Safe areas](/docs/safe-areas) has the full treatment.",
    },
    {
      type: "p",
      text: "One more runtime value follows the same pattern: `--adaptv-keyboard-height` is `0px` at rest and the keyboard's height while it is up, and `<html>` carries `data-keyboard-open`, so `data-keyboard-open:pb-4` works as a variant. See [Keyboard](/docs/keyboard).",
    },
    { type: "h2", text: "App-feel resets" },
    {
      type: "p",
      text: 'Three resets make an installed app stop feeling like a page. Each has a scope in the `ui` block of the [config](/docs/config): `"app"` (installed PWA and native only), `"all"` (every target, browser tab included) or `"off"`. The scope is resolved once in the pre-paint script into an attribute on `<html>`, so the stylesheet is one static file for every config.',
    },
    {
      type: "props",
      rows: [
        {
          name: "ui.noSelect",
          type: '"app" | "all" | "off"',
          default: '"app"',
          description:
            '`user-select: none` on everything, so a long press is not a text selection. `input`, `textarea` and `[contenteditable="true"]` always stay selectable. `"all"` is hostile in a browser tab: nobody can select an error message or copy a code sample.',
        },
        {
          name: "ui.hideScrollbars",
          type: '"app" | "all" | "off"',
          default: '"all"',
          description:
            "Hides scrollbars. The default reaches the browser tab too, because [ScrollView](/docs/scroll-view) has a per-scroller escape: `showsVerticalScrollIndicator` and `showsHorizontalScrollIndicator` emit `scrollbar-visible`, which outranks the reset.",
        },
        {
          name: "ui.touchCallout",
          type: '"app" | "all" | "off"',
          default: '"app"',
          description:
            "Suppresses the iOS long-press link preview sheet on `a[href]`. In a Safari tab the sheet is how people copy a link or open it in a new tab, which is why the default leaves it alone there.",
        },
      ],
    },
    {
      type: "code",
      label: "adaptv.config.ts",
      lang: "ts",
      code: `// A content site: scrollbars in the browser, hidden once installed.
ui: { hideScrollbars: "app" },`,
    },
    { type: "h3", text: "Text selection" },
    {
      type: "p",
      text: "Where `noSelect` is on, opt an element back in with the `selectable` utility, or the `selectable` prop on [Text](/docs/text). It beats the reset on layer order alone. Images, SVGs, videos and canvases are never selectable on any target: a selection that starts on an image begins a native image drag and steals the pointer from a swipe.",
    },
    {
      type: "code",
      label: "order.tsx",
      lang: "tsx",
      code: `<Text selectable>{order.trackingNumber}</Text>
<pre className="selectable">{stackTrace}</pre>`,
    },
    { type: "h3", text: "Resets with no switch" },
    {
      type: "ul",
      items: [
        "**Focus rings.** A click or tap leaves no ring; keyboard focus gets `outline: 2px solid` in `var(--adaptv-ring, currentColor)` with a 2px offset. On a filled button `currentColor` is the label colour, so set `--adaptv-ring` once on `:root` if you have a brand colour.",
        "**The grey tap flash** on links is removed everywhere. Press feedback is yours to draw with `active:`.",
        "**WebKit's autofill yellow** is covered, and autofilled text keeps the field's own colour.",
        '**`type="search"`** loses its native clear button so you can render your own.',
        "The `scrollbar-hidden` and `scrollbar-visible` utilities exist for a scroller you build by hand.",
      ],
    },
    {
      type: "p",
      text: "All of it sits in the `adaptv` layer with no `!important` (one declaration that fights the browser's own autofill stylesheet is the single exception). An unlayered rule of yours, or any Tailwind utility, overrides it at any specificity:",
    },
    {
      type: "code",
      label: "main.css",
      lang: "text",
      code: `.article-body { user-select: text; }`,
    },
    { type: "h2", text: "The class tiers" },
    {
      type: "p",
      text: "Every adaptv component composes its classes in three tiers, resolved with tailwind-merge so a later tier replaces a conflicting class from an earlier one.",
    },
    {
      type: "table",
      head: ["Tier", "Owner", "Meaning"],
      rows: [
        [
          "`base`",
          "adaptv",
          'The neutral default look: `flex flex-col` on `View`, grey on `Button`. Your `className` overrides it, so `<View className="grid">` is a grid.',
        ],
        ["`className`", "You", "The customisation surface."],
        [
          "`locked`",
          "adaptv",
          "Classes the component's behaviour depends on. They win over `className`.",
        ],
      ],
    },
    {
      type: "p",
      text: 'What is locked is small and named on each component\'s reference page. Examples: the scroll axis and overscroll containment on `ScrollView` (owned by the `horizontal` and `scrollEnabled` props, so `overflow-hidden` in `className` cannot silently stop a list scrolling); the `touch-action` classes on pressable components, which keep `pointercancel` firing on iOS so a press knows a scroll took over; safe-area padding from `View`\'s `safe` prop, so `<View safe="bottom" className="pb-0">` keeps its inset.',
    },
    {
      type: "p",
      text: "The rule behind the split: behaviour is a prop and look is a class. When a class you pass has no effect, look for the prop that owns it. Inline `style` follows the same three tiers on components that take it.",
    },
    { type: "h3", text: "State is a data attribute" },
    {
      type: "p",
      text: "Components expose state as `data-*` attributes and never as class names. A component's root carries `data-adaptv=\"<name>\"` (`button`, `scroll-view`, `switch`, …), so global CSS can restyle every instance without importing anything, and Tailwind's data variants cover the local case. Each reference page lists the attributes its component sets.",
    },
    {
      type: "code",
      label: "main.css",
      lang: "text",
      code: `[data-adaptv="not-found"] { background: var(--color-background); }`,
    },
    { type: "h2", text: "Writing a design-system wrapper" },
    {
      type: "p",
      text: "The intended use of an unstyled component is one wrapper per variant in your own design system. Merge with `cn` from `@arrzdev/adaptv/utils`, which is tailwind-merge extended with adaptv's safe-area, `selectable` and scrollbar groups, so a caller's class still overrides yours. Forward the `ref`: adaptv components expose imperative handles through it.",
    },
    {
      type: "code",
      label: "src/components/ui/primary-button.tsx",
      lang: "tsx",
      code: `import type { ButtonHandle } from "@arrzdev/adaptv/components"
import { Button } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import type { ComponentPropsWithRef } from "react"
import { forwardRef } from "react"

const PRIMARY = cn(
  "rounded-md bg-primary px-4 py-2 font-medium text-sm text-white",
  "hover:bg-primary/90",
  "origin-center transition-transform duration-200 ease-out active:scale-[0.98] active:duration-0",
  "disabled:opacity-50",
)

type PrimaryButtonProps = ComponentPropsWithRef<typeof Button> & {
  loading?: boolean
}

export const PrimaryButton = forwardRef<ButtonHandle, PrimaryButtonProps>(
  function PrimaryButton({ className, loading = false, disabled, children, ...props }, ref) {
    return (
      <Button
        ref={ref}
        haptic
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(PRIMARY, className)}
        {...props}
      >
        <Button.Text>{children}</Button.Text>
        {loading && (
          <Button.Trailing className="ps-2">
            <Spinner />
          </Button.Trailing>
        )}
      </Button>
    )
  },
)`,
    },
    {
      type: "ul",
      items: [
        'Branch state classes on values you hold in React (`checked && "bg-green-500"`), or on the attributes the component documents. The [Switch](/docs/switch) page shows the pattern for a compound component.',
        'Build class names as whole strings. Tailwind only compiles names it finds in your source, so `"bg-" + colour` emits nothing.',
        "Tokens go in your `@theme` block. adaptv's own fallback screens use plain greys, and you replace those screens outright (`notFoundScreen`, `offlineComponent`, `bootErrorScreen`).",
        "With no legacy browsers to support, a tint is `color-mix(in oklch, var(--color-primary), black 12%)` at the use site. No precomputed shade tokens are needed.",
      ],
    },
    { type: "h2", text: "What goes wrong" },
    {
      type: "table",
      head: ["Symptom", "Cause", "Fix"],
      rows: [
        [
          "adaptv's resets beat your utilities everywhere.",
          "The layer line is missing: `tailwindcss()` is listed before `adaptv()`, or the stylesheet is used outside the plugin.",
          "Fix the plugin order, or write the `@layer` line as the first statement of the stylesheet.",
        ],
        [
          "A class has no effect on an adaptv component.",
          "It conflicts with a locked class.",
          "Use the prop that owns that behaviour.",
        ],
        [
          "Users cannot select text in the installed app.",
          '`ui.noSelect` defaults to `"app"`.',
          '`selectable` on what should be copyable, or `ui: { noSelect: "off" }` for a reading app.',
        ],
        [
          "No scrollbar on desktop.",
          '`ui.hideScrollbars` defaults to `"all"`.',
          '`showsVerticalScrollIndicator` on that `ScrollView`, or `hideScrollbars: "app"`.',
        ],
        [
          'A side-by-side "plain web" comparison inside your app behaves like adaptv on both sides.',
          "The stylesheet patches the whole document, utilities included.",
          "Write the plain specimen as raw, unlayered CSS.",
        ],
      ],
    },
  ],
}

import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "safe-areas",
  title: "Safe areas",
  summary:
    "Keep content clear of notches, home indicators and system bars with one prop, a family of Tailwind utilities, and a hook for the cases CSS cannot reach.",
  blocks: [
    {
      type: "p",
      text: "A phone screen has regions your content should not sit in: the notch or camera island, the status bar, the home indicator, and in landscape the rounded corners on both sides. The OS reports their size as four insets. adaptv draws every installed target edge to edge, so the app is responsible for padding those insets back in. This page covers the three tools for that and what each target reports.",
    },
    { type: "h2", text: "The short version" },
    {
      type: "ul",
      items: [
        "Pad a box with the `safe` prop on [View](/docs/view), or with a utility such as `pt-safe` or `pb-safe-offset-4`.",
        "Use `useInsets()` only when a number feeds a calculation. It is one render behind the CSS.",
        "Never write `env(safe-area-inset-*)` yourself. On Android it reads `0` in older WebViews, and the utilities already route around that.",
      ],
    },
    { type: "h2", text: "The `safe` prop on View" },
    {
      type: "p",
      text: "`View` takes `safe` with one of five values. Each maps to a padding utility, and that padding is structural: it wins over a conflicting class in `className`. A `View` that was asked to clear the home indicator keeps doing so even when a stray `pb-0` lands on it.",
    },
    {
      type: "table",
      head: ["Value", "Pads", "Utility applied"],
      rows: [
        ['`"top"`', "Top edge", "`pt-safe`"],
        ['`"bottom"`', "Bottom edge", "`pb-safe`"],
        ['`"x"`', "Left and right", "`px-safe`"],
        ['`"y"`', "Top and bottom", "`py-safe`"],
        ['`"all"`', "All four edges", "`p-safe`"],
      ],
    },
    {
      type: "code",
      label: "settings.page.tsx",
      lang: "tsx",
      code: `import { ScrollView, View } from "@arrzdev/adaptv/components"

export function SettingsPage() {
  return (
    <View>
      {/* The header clears the notch, plus a little air. */}
      <View row className="items-center px-4 pt-safe-offset-2 pb-2">
        <Title />
      </View>

      <ScrollView className="px-4">{rows}</ScrollView>

      {/* The action bar clears the home indicator. */}
      <View safe="bottom" className="border-t px-4 pt-3">
        <SaveButton />
      </View>
    </View>
  )
}`,
    },
    {
      type: "note",
      text: "`safe` pads by exactly the inset. When you also want a design gap on the same edge, use an `-offset-` utility in `className` instead of `safe`, because `safe` and a `pb-*` class on the same edge do not add up: the prop wins.",
    },
    { type: "h2", text: "The utilities" },
    {
      type: "p",
      text: "The utilities ship with `@arrzdev/adaptv/styles.css`. Every family comes in three variants, and all of them resolve through the same four values.",
    },
    {
      type: "table",
      head: ["Variant", "Example", "Computes"],
      rows: [
        ["Bare", "`pb-safe`", "The inset."],
        [
          "`-offset-N`",
          "`pb-safe-offset-4`",
          "The inset plus `N` spacing units. Content that must clear the edge and breathe.",
        ],
        [
          "`-or-N`",
          "`pb-safe-or-4`",
          "The inset, but never less than `N` spacing units. A floor for devices with no inset.",
        ],
      ],
    },
    {
      type: "p",
      text: "`N` is a Tailwind spacing integer (`pt-safe-offset-2`) or a bracketed integer (`pt-safe-offset-[7]`). With the default spacing scale, `pt-safe-offset-4` is the inset plus 16px and `pt-safe-or-8` is `max(inset, 32px)`.",
    },
    {
      type: "table",
      head: ["Family", "Utilities", "Property"],
      rows: [
        [
          "Padding",
          "`p-safe`, `px-safe`, `py-safe`, `pt-safe`, `pr-safe`, `pb-safe`, `pl-safe`, `ps-safe`, `pe-safe`",
          "`padding-*`",
        ],
        [
          "Margin",
          "`m-safe`, `mx-safe`, `my-safe`, `mt-safe`, `mr-safe`, `mb-safe`, `ml-safe`, `ms-safe`, `me-safe`",
          "`margin-*`",
        ],
        [
          "Position",
          "`inset-safe`, `inset-x-safe`, `inset-y-safe`, `top-safe`, `right-safe`, `bottom-safe`, `left-safe`, `start-safe`, `end-safe`",
          "`top` / `right` / `bottom` / `left`",
        ],
      ],
    },
    {
      type: "p",
      text: "Each name in the table also exists as `-safe-offset-*` and `-safe-or-*`: `px-safe-offset-6`, `mb-safe-or-4`, `bottom-safe-offset-4`, and so on. Negative variants, `scroll-p*`/`scroll-m*` variants and a safe-height family are not provided.",
    },
    {
      type: "code",
      label: "fab.tsx",
      lang: "tsx",
      code: `// A floating button that sits 16px above the home indicator,
// and 16px from the right edge even in landscape on a notched phone.
<Pressable
  onPress={compose}
  className="fixed right-safe-offset-4 bottom-safe-offset-4 flex size-14 items-center justify-center rounded-full bg-blue-600"
>
  <PlusIcon />
</Pressable>`,
    },
    {
      type: "p",
      text: "Combine them with the `app:` and `web:` variants from [The six targets](/docs/six-targets) when a browser tab and an installed app want different spacing: `web:py-4 app:py-safe-offset-2`.",
    },
    { type: "h2", text: "useInsets" },
    {
      type: "api",
      name: "useInsets()",
      signature:
        "function useInsets(): { top: number; right: number; bottom: number; left: number }",
      description:
        "The four insets as numbers in px, `0` where there is no inset. It reads the same values the utilities read, so the two always agree. It re-measures on orientation change, on visual viewport resize, and when the native shell rewrites the inset values.",
      returns:
        "An `Insets` object. All zeros on the server and on the first client render, then the measured values after mount.",
    },
    {
      type: "p",
      text: "This is an escape hatch. For padding, margin and positioning the utilities cost no re-render, apply before the first paint, and follow a rotation with no JavaScript. Reach for the hook when the inset feeds arithmetic: a snap point, a gesture threshold, available-height maths, a number handed to a native call.",
    },
    {
      type: "code",
      label: "sheet.tsx",
      lang: "tsx",
      code: `import { useInsets } from "@arrzdev/adaptv/hooks"

const HANDLE_HEIGHT = 28

function usePeekSnapPoint() {
  const insets = useInsets()
  return window.innerHeight - insets.bottom - HANDLE_HEIGHT
}`,
    },
    {
      type: "p",
      text: "`readSafeAreaInsets()` from the same import path is the imperative read: one measurement, no subscription, for code that runs outside React.",
    },
    { type: "h2", text: "Why the insets are right on the first frame" },
    {
      type: "p",
      text: "A header that renders under the notch and then jumps down a frame later is a [layout shift](/docs/layout-shift), and on a touch screen a layout shift is a mis-tap. adaptv avoids it by keeping the insets out of JavaScript entirely on the rendering path:",
    },
    {
      type: "ul",
      items: [
        "The app shell adaptv generates always carries `viewport-fit=cover` in its viewport meta. Without it every inset reads `0`. You do not write this tag and cannot get it wrong.",
        "The four values live on `:root` as `--adaptv-inset-top`, `--adaptv-inset-right`, `--adaptv-inset-bottom` and `--adaptv-inset-left`. They are always defined, `0px` where there is no inset, so they are safe inside `calc()` with no fallback.",
        "Each one resolves to the value the native shell injects when there is one, and to the browser's `env(safe-area-inset-*)` otherwise. Both are available to CSS before the first paint, so a `pt-safe` header is laid out correctly in the first frame.",
        "The platform (`web`, `standalone` or `native`) is stamped on `<html>` by a script that runs before paint, so `app:` and `web:` variants resolve in the same frame.",
      ],
    },
    {
      type: "note",
      text: "The four custom properties sit in adaptv's lowest cascade layer, so your own `:root` declaration of the same name wins without `!important`. You should rarely need that; it exists for a harness or a design tool that wants to fake a device.",
    },
    { type: "h2", text: "What each target reports" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "All four insets are `0`. Every utility still computes: `pt-safe-or-8` gives its 32px floor.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "The browser's own bars cover most of the unsafe area, so expect small or zero values. iOS Safari in a tab reports a bottom inset that changes as the address bar collapses.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "iOS reports the real notch and home-indicator insets; this is where a notch first shows up. An installed PWA on Android reports a top inset of `0`, so use an `-or-N` floor there if the header needs air.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "Real insets from `env()`. The native build always draws under the status bar, so an unpadded header will sit under the clock.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Real insets, injected by the native shell as CSS variables, because `env(safe-area-inset-*)` reads `0` in Android WebView below version 140. This is why you never write `env()` by hand.",
        },
      ],
    },
    { type: "h2", text: "What goes wrong" },
    {
      type: "ul",
      items: [
        "**Double padding at the bottom of a form.** [AvoidKeyboard](/docs/avoid-keyboard) reserves the larger of the keyboard and the bottom inset itself. Give it your design gap (`pb-2`) and leave `pb-safe` off that element. Keep the top inset on it.",
        "**A full-bleed background that stops short.** Pad the content, not the painted box. Put the background on the outer element and `safe` on an inner one, so the colour still reaches the screen edge.",
        "**Insets of `0` on an Android phone with gesture navigation.** The injected variables are missing, which means the page is not running inside the adaptv native shell, or a style on `<html>` is overwriting `--safe-area-inset-*`.",
        "**A value from `useInsets()` used for padding.** It works, one render late. Replace it with the matching utility.",
        "**Numbers that do not change on rotation.** Something cached a value from `readSafeAreaInsets()`. Use the hook, or the CSS.",
      ],
    },
    {
      type: "p",
      text: "The built-in screens already handle this: the default [Offline](/docs/offline-boundary) screen pads all four edges, and [ScrollView](/docs/scroll-view) sizes its top fade from the top inset.",
    },
  ],
}

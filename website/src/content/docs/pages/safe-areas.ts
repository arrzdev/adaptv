import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "safe-areas",
  title: "Safe areas",
  summary:
    "Keep content clear of the notch, the status bar and the home indicator.",
  blocks: [
    {
      type: "p",
      text: "Installed apps draw edge to edge. You pad the notch, the status bar and the home indicator yourself. The OS reports these as four insets: top, right, bottom and left.",
    },
    { type: "h2", text: "Pad a box" },
    {
      type: "ol",
      items: [
        "To pad by exactly the inset, set `safe` on a [View](/docs/view): `top`, `bottom`, `x`, `y` or `all`.",
        "To add your own gap, leave `safe` off. Use `pt-safe-offset-4` in `className`.",
        "To set a minimum, use `pb-safe-or-4`. It gives the inset, but never less than 4 spacing units.",
      ],
    },
    {
      type: "code",
      label: "settings.tsx",
      lang: "tsx",
      code: `import { ScrollView, View } from "adaptv/components"

// Title, rows and SaveButton are your own.
export function Settings() {
  return (
    <View>
      <View row className="items-center px-4 pt-safe-offset-2 pb-2">
        <Title />
      </View>
      <ScrollView className="px-4">{rows}</ScrollView>
      <View safe="bottom" className="border-t px-4 pt-3">
        <SaveButton />
      </View>
    </View>
  )
}`,
    },
    {
      type: "p",
      text: "`safe` wins over a padding class on the same edge. The two do not add up.",
    },
    { type: "h2", text: "The utilities" },
    {
      type: "p",
      text: "The utilities are Tailwind classes from `adaptv/tailwind.css`. In plain CSS, add the `--adaptv-inset-top`, `-right`, `-bottom` and `-left` variables yourself: `padding-top: calc(var(--adaptv-inset-top) + 1rem)`. Each family has three forms: `-safe` (the inset), `-safe-offset-N` (the inset plus N) and `-safe-or-N` (at least N). `N` is a Tailwind spacing number, so `pt-safe-offset-4` is the inset plus 16px.",
    },
    {
      type: "table",
      head: ["Family", "Names"],
      rows: [
        ["Padding", "`p`, `px`, `py`, `pt`, `pr`, `pb`, `pl`, `ps`, `pe`"],
        ["Margin", "`m`, `mx`, `my`, `mt`, `mr`, `mb`, `ml`, `ms`, `me`"],
        [
          "Position",
          "`inset`, `inset-x`, `inset-y`, `top`, `right`, `bottom`, `left`, `start`, `end`",
        ],
      ],
    },
    {
      type: "p",
      text: "`ps-safe`, `pe-safe`, `start-safe` and `end-safe` use the left and right insets, also in right-to-left layouts. There are no negative forms. Do not write `env(safe-area-inset-*)` yourself: Android WebView before version 140 reads it as `0`, and the utilities already handle that.",
    },
    {
      type: "code",
      label: "fab.tsx",
      lang: "tsx",
      code: `import { Pressable } from "adaptv/components"

// 16px above the home indicator and 16px from the right edge.
<Pressable
  onPress={compose}
  className="fixed right-safe-offset-4 bottom-safe-offset-4 flex size-14 items-center justify-center rounded-full bg-blue-600"
>
  <PlusIcon />
</Pressable>`,
    },
    { type: "h2", text: "Read the insets in code" },
    {
      type: "p",
      text: "Use `useInsets()` only when a number feeds a calculation, such as a snap point. It returns `{ top, right, bottom, left }` in px. It is zero on the server and on the first render, then updates. For padding, use the utilities: they need no render. `readSafeAreaInsets()` reads the values once, outside React.",
    },
    {
      type: "code",
      label: "sheet.ts",
      lang: "ts",
      code: `import { useInsets } from "adaptv/hooks"

function usePeekSnapPoint() {
  const insets = useInsets()
  return window.innerHeight - insets.bottom - 28
}`,
    },
    {
      type: "p",
      text: "Import `readSafeAreaInsets` from `adaptv/hooks` too.",
    },
    { type: "h2", text: "What each target reports" },
    {
      type: "ul",
      items: [
        "Desktop: all four are `0`. `-safe-or-N` still gives its minimum.",
        "Browser tab: small or zero values. They can change as the address bar collapses.",
        "Installed PWA and native iOS: the real notch and home-indicator insets.",
        "Native Android: the real insets, supplied by the native shell.",
      ],
    },
    { type: "h2", text: "What goes wrong" },
    {
      type: "ul",
      items: [
        "**Double padding under a form.** [AvoidKeyboard](/docs/avoid-keyboard) adds the bottom inset itself. Give it `pb-2`, not `pb-safe`.",
        "**A background stops short of the edge.** Put the colour on the outer element and `safe` on an inner one.",
        "**Insets stay `0` on an Android phone.** The page is not running in the adaptv native app, or a style overwrites `--safe-area-inset-*` on `<html>`.",
        "**Padding from `useInsets()` is one frame late.** Use the matching utility.",
      ],
    },
    {
      type: "p",
      text: "The default [Offline](/docs/offline-boundary) screen already pads all four edges.",
    },
  ],
}

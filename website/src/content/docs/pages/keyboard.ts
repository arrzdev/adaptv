import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "keyboard",
  title: "The software keyboard",
  summary: "Keep inputs visible when the on-screen keyboard opens.",
  blocks: [
    {
      type: "p",
      text: "adaptv gives you one keyboard signal on every target. By default the keyboard opens over the page. On iOS and in a browser, the page does not reflow, scroll or shrink. On Android native, the window shrinks by the keyboard height, so layout there still resizes. You choose which content moves.",
    },
    {
      type: "ul",
      items: [
        "A form inside a [Drawer](/docs/drawer) needs nothing. The drawer handles the keyboard.",
        "A full-screen form: wrap its scroller in [AvoidKeyboard](/docs/avoid-keyboard).",
        "A tab bar or docked bar: react with the CSS hook on `<html>`.",
        "Anything else: read `useKeyboard()`.",
      ],
    },
    { type: "h2", text: "Keep a form above the keyboard" },
    {
      type: "code",
      label: "edit-profile.tsx",
      lang: "tsx",
      code: `import { AvoidKeyboard, Input, View } from "adaptv/components"

export function EditProfile() {
  return (
    <View>
      <Header />
      <AvoidKeyboard className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden overscroll-y-contain touch-pan-x touch-pan-y touch-pinch-zoom px-4 pb-2 pt-safe-offset-2">
        <Input name="name" placeholder="Name" />
        <Input name="email" type="email" placeholder="Email" />
      </AvoidKeyboard>
    </View>
  )
}`,
    },
    {
      type: "ul",
      items: [
        "`AvoidKeyboard` must be the scroller. Put the overflow classes on it. A separate scroller inside it does not get the reserved space.",
        "Leave `pb-safe` off it. It already reserves the larger of the keyboard and the bottom [safe area](/docs/safe-areas).",
        "Do not use it inside a `Drawer`. Both would reserve the space.",
      ],
    },
    { type: "h2", text: "Read the keyboard in code" },
    {
      type: "api",
      name: "useKeyboard()",
      signature:
        "function useKeyboard(options?: UseKeyboardOptions): KeyboardState",
      description:
        "The live keyboard state. It also publishes the state on `<html>` while an enabled `useKeyboard` is mounted. The shell does not mount one, so mount one yourself before you rely on the CSS hook.",
      params: [
        {
          name: "isEnabled",
          type: "boolean",
          default: "true",
          description:
            "Turn the listeners off. A disabled hook reports closed.",
        },
        {
          name: "predictFromCache",
          type: "boolean",
          default: "false",
          description:
            "Start with the last known height when a field takes focus. A prediction that no keyboard confirms is dropped after about 800 ms.",
        },
        {
          name: "visualViewportThreshold",
          type: "number",
          default: "100",
          description:
            "Web only. The smallest viewport change in px that counts as a keyboard.",
        },
        {
          name: "debounceDelay",
          type: "number",
          default: "50",
          description: "Web only. Settle time in ms for viewport events.",
        },
      ],
      returns:
        "`{ isOpen, height, unpaidHeight, resizesLayoutViewport }`. `height` is in px and is `0` when closed. `unpaidHeight` is the part of `height` the layout has not already given up. `resizesLayoutViewport` is `true` on Android native.",
    },
    {
      type: "p",
      text: "Lay out against `unpaidHeight`, not `height`. On Android native the window already shrank, so `height` counts the keyboard twice.",
    },
    {
      type: "code",
      label: "composer.tsx",
      lang: "tsx",
      code: `import { Input, View } from "adaptv/components"
import { useKeyboard } from "adaptv/hooks"

// SendButton is your own component.
function Composer() {
  const { isOpen, unpaidHeight } = useKeyboard()

  return (
    <View
      row
      className="absolute inset-x-0 bottom-0 gap-2 px-3 pt-2"
      style={{ paddingBottom: isOpen ? unpaidHeight + 8 : undefined }}
    >
      <Input placeholder="Message" className="flex-1" />
      <SendButton />
    </View>
  )
}`,
    },
    { type: "h3", text: "React from CSS" },
    {
      type: "table",
      head: ["Hook", "Value", "Use"],
      rows: [
        [
          "`--adaptv-keyboard-height`",
          "The full height. `0px` while closed.",
          "Do not use it for spacing on Android native. Use `unpaidHeight`.",
        ],
        [
          "`data-keyboard-open`",
          "Present while the keyboard is up.",
          "`[html[data-keyboard-open]_&]:hidden`",
        ],
      ],
    },
    {
      type: "p",
      text: "The attribute sits on `<html>`. A bare `data-keyboard-open:` variant on an inner element matches nothing. Write the form in the table.",
    },
    {
      type: "p",
      text: "`dismissVirtualKeyboard()` blurs the focused field. `willOpenVirtualKeyboard(element)` returns `true` for text inputs, textareas and editable elements. Both come from `adaptv/hooks`.",
    },
    { type: "h2", text: "Where the height comes from" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "no",
          note: "No on-screen keyboard. `height` stays `0`.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "Inferred from the viewport. It can lag the animation.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Same as mobile web.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "Exact height from the OS. The webview does not resize.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Exact height from the OS. The window resizes, so use `unpaidHeight`.",
        },
      ],
    },
    { type: "h2", text: "Settings" },
    {
      type: "props",
      rows: [
        {
          name: "patches.viewportFreeze",
          type: "boolean",
          default: "true",
          description:
            "Locks the layout against the keyboard and the address bar. Set `false` to restore browser behaviour and its layout shift.",
        },
        {
          name: "patches.caretRepaint",
          type: "boolean",
          default: "true",
          description:
            "Repaints the iOS caret after a field moves, so no ghost caret stays behind.",
        },
        {
          name: "patches.textMagnifier",
          type: "boolean",
          default: "true",
          description:
            "Blocks the iOS magnifier on double-tap-and-hold outside inputs.",
        },
        {
          name: "allowZoom",
          type: "boolean",
          default: "false",
          description:
            "By default the viewport blocks zoom, which stops iOS zooming on focus. Set `true` to allow pinch zoom, and keep input text at 16px or larger.",
        },
      ],
    },
    { type: "h2", text: "What goes wrong" },
    {
      type: "ul",
      items: [
        "**A gap the size of the keyboard on Android.** You used `height`. Use `unpaidHeight`.",
        "**The CSS hook does nothing.** No `useKeyboard` is mounted, or you used a bare `data-keyboard-open:` variant.",
        "**No keyboard in the iOS Simulator.** Turn off I/O, Keyboard, Connect Hardware Keyboard.",
        "**Different height on a LAN `http://` address.** The page is not a secure context, so the browser keyboard API is missing. The height comes from viewport size.",
        '**A ghost popover on a moving field.** iOS draws autocorrect and selection handles. Set `autoCorrect="off"` and `spellCheck={false}` on the field.',
      ],
    },
  ],
}

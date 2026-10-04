import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "avoid-keyboard",
  title: "AvoidKeyboard",
  summary:
    "A wrapper that reserves room for the on-screen keyboard and scrolls the focused field above it.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { AvoidKeyboard, useKeyboardAvoidance } from "@arrzdev/adaptv/components"',
  source: "src/components/avoid-keyboard/avoid-keyboard.tsx",
  blocks: [
    {
      type: "code",
      label: "edit-profile.page.tsx",
      lang: "tsx",
      code: `import { AvoidKeyboard, Input, TextArea } from "@arrzdev/adaptv/components"

<AvoidKeyboard className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden overscroll-y-contain touch-pan-x touch-pan-y touch-pinch-zoom px-6 pt-safe-offset-2 pb-2">
  <Input name="name" placeholder="Name" />
  <Input name="email" type="email" placeholder="Email" />
  <Input name="city" placeholder="City" />
  <TextArea name="bio" placeholder="Bio" />
</AvoidKeyboard>`,
    },
    {
      type: "note",
      text: "There is no live demo on this page. A desktop browser has no on-screen keyboard, so the keyboard height stays 0 and `AvoidKeyboard` behaves like a plain `<div>`. Open the page on a phone to see it work.",
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: "adaptv freezes the layout viewport app-wide by default (`patches.viewportFreeze` in the [config](/docs/config)). The on-screen keyboard slides over the bottom of your layout and the page does not resize or jump. The cost is that a field near the bottom of a full-screen form ends up underneath the keyboard. `AvoidKeyboard` is the fix for that: it is the counterpart of React Native's `KeyboardAvoidingView`. The [keyboard guide](/docs/keyboard) has the whole picture.",
    },
    {
      type: "p",
      text: "It does two things. While the keyboard is up, it adds the height the keyboard covers to its own bottom padding (or margin), applied in one step with no animation. And when a text field inside it takes focus, it scrolls that field into the band between the top safe area and the keyboard, smoothly, or instantly with reduced motion on.",
    },
    {
      type: "note",
      tone: "warn",
      text: "`AvoidKeyboard` must **be** the scroller. The reserved padding lands on this element. If a separate scroller sits inside it, the padding shrinks that scroller and its content gets no longer, so the focused field still cannot clear the keyboard. Put the scroll classes on `AvoidKeyboard` itself, as in the example: `overflow-y-auto overflow-x-hidden overscroll-y-contain touch-pan-x touch-pan-y touch-pinch-zoom`. They are the same classes a vertical [ScrollView](/docs/scroll-view) emits.",
    },
    { type: "h3", text: "Bottom padding and the safe area" },
    {
      type: "p",
      text: "The component reserves room for whatever covers the bottom of the screen: the keyboard when it is open, or the home-indicator safe area when this element reaches the bottom of the screen, whichever is larger. The two never stack, since the keyboard covers the safe area. That reservation is added to the bottom padding the element has at rest.",
    },
    {
      type: "ul",
      items: [
        "Give the element only your design gap at the bottom, such as `pb-2`.",
        "Do not add `pb-safe` or a bottom `py-safe-offset-*`. The wrapper supplies the bottom inset, and doubling up leaves a permanent empty band.",
        "Keep the top inset (`pt-safe-offset-*`) on the element. The top is never covered.",
        "Pad the bottom with a class and not with inline `style`. The component owns inline `padding-bottom` (or `margin-bottom`) while it is reserving room.",
      ],
    },
    { type: "h3", text: "A bar docked to the bottom" },
    {
      type: "p",
      text: '`behavior="margin"` reserves the room as `margin-bottom`, which lifts the element. Use it for a composer or an action bar that sits at the bottom of the screen and should ride above the keyboard.',
    },
    {
      type: "code",
      label: "chat.page.tsx",
      lang: "tsx",
      code: `<View className="h-full">
  <ScrollView fill>{messages}</ScrollView>
  <AvoidKeyboard behavior="margin" scrollIntoView={false} className="shrink-0 px-4 pt-2 pb-2">
    <Composer />
  </AvoidKeyboard>
</View>`,
    },
    { type: "h3", text: "Where not to use it" },
    {
      type: "p",
      text: "Not inside a [Drawer](/docs/drawer). The drawer does its own keyboard avoidance and the two fight. It is also built for the frozen viewport: with `patches.viewportFreeze` turned off the browser resizes the page for the keyboard, and the measurement this component relies on no longer holds.",
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "behavior",
          type: '"padding" | "margin"',
          default: '"padding"',
          description:
            "Which box property reserves the room. `padding` is for an element that is the scroller. `margin` lifts a bottom-docked bar.",
        },
        {
          name: "scrollIntoView",
          type: "boolean",
          default: "true",
          description:
            "Scroll the focused text field inside this element clear of the keyboard, on focus and again when the keyboard height arrives.",
        },
        {
          name: "scrollBuffer",
          type: "number",
          default: "24",
          description:
            "Gap in pixels kept between the bottom of the focused field and the top of the keyboard.",
        },
        {
          name: "isEnabled",
          type: "boolean",
          default: "true",
          description:
            "When `false`, nothing is reserved, nothing scrolls, and the element reports the keyboard as closed.",
        },
        {
          name: "className",
          type: "string",
          description: "Classes for the root `<div>`. Nothing is locked.",
        },
        {
          name: "style",
          type: "CSSProperties",
          description:
            'Inline style for the root. `paddingBottom` (or `marginBottom` with `behavior="margin"`) and `--adaptv-keyboard-height` are overwritten by the component.',
        },
      ],
    },
    {
      type: "p",
      text: "Every other `<div>` attribute passes through. The ref is the root `<div>`.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "table",
      head: ["Hook", "When", "Example"],
      rows: [
        [
          "`data-keyboard-open`",
          "Present, with no value, while the on-screen keyboard is open.",
          "`data-keyboard-open:pb-4`",
        ],
        [
          "`--adaptv-keyboard-height`",
          "The live keyboard height on this element, `0px` when closed.",
          "`h-[calc(100%-var(--adaptv-keyboard-height))]`",
        ],
      ],
    },
    {
      type: "p",
      text: "Both are also stamped on `<html>` by `useKeyboard`, so chrome outside this subtree, such as a tab bar that should hide while typing, can react as well.",
    },
    { type: "h2", text: "useKeyboardAvoidance" },
    {
      type: "api",
      name: "useKeyboardAvoidance()",
      signature:
        "function useKeyboardAvoidance(options: UseKeyboardAvoidanceOptions): KeyboardAvoidanceState",
      description:
        "The logic behind `AvoidKeyboard`, for an element you render yourself. It watches the keyboard, measures how much of `containerRef` the keyboard covers, and scrolls the focused field clear. It writes no styles: apply `space` yourself as `padding-bottom` or `margin-bottom`.",
      params: [
        {
          name: "containerRef",
          type: "RefObject<HTMLElement | null>",
          required: true,
          description:
            "The element that is measured against the keyboard and searched for the focused field.",
        },
        {
          name: "behavior",
          type: '"padding" | "margin"',
          default: '"padding"',
          description:
            "Which property you will apply `space` to. It decides which resting value is read from the element and added back into `space`.",
        },
        {
          name: "scrollIntoView",
          type: "boolean",
          default: "true",
          description: "Scroll the focused field above the keyboard.",
        },
        {
          name: "scrollBuffer",
          type: "number",
          default: "24",
          description:
            "Gap in pixels between the field and the keyboard. Also exported as `DEFAULT_AVOID_KEYBOARD_SCROLL_BUFFER`.",
        },
        {
          name: "isEnabled",
          type: "boolean",
          default: "true",
          description: "Turn the whole hook off.",
        },
      ],
      returns:
        "`{ isKeyboardOpen, keyboardHeight, space, behavior }`. `space` is the full inline value to apply in pixels, resting inset included, or `0` when there is nothing to reserve and the element's own class should apply.",
    },
    {
      type: "code",
      label: "form-scroller.tsx",
      lang: "tsx",
      code: `function FormScroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const { space, isKeyboardOpen } = useKeyboardAvoidance({ containerRef: ref })

  return (
    <div
      ref={ref}
      className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pb-2"
      style={space > 0 ? { paddingBottom: space } : undefined}
      data-typing={isKeyboardOpen ? "" : undefined}
    >
      {children}
    </div>
  )
}`,
    },
    {
      type: "p",
      text: "The same module exports the pure functions the hook is built from, for tests and custom layouts: `resolveAvoidanceSpace`, `resolveReservedSpace`, `computeScrollIntoViewTop` and `scrollFocusedInputIntoView`.",
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "no",
          note: "No on-screen keyboard, so the height stays 0 and nothing is reserved. The element is a plain `<div>`.",
        },
        {
          target: "Mobile web",
          status: "yes",
          note: "The keyboard height is inferred from the visual viewport, so expect a frame of settling while the keyboard animates in.",
        },
        {
          target: "Installed PWA",
          status: "yes",
          note: "Same as mobile web. The bottom safe-area inset is reserved when the element reaches the bottom of the screen.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "Exact keyboard height from the OS. The layout height does not change when the keyboard opens; only this element moves.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Exact keyboard height from the OS, including the taller keyboard with a suggestion strip.",
        },
      ],
    },
  ],
}

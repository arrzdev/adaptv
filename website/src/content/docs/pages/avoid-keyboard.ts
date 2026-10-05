import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "avoid-keyboard",
  title: "AvoidKeyboard",
  summary:
    "A scroller that keeps the focused field above the on-screen keyboard.",
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
      text: "There is no live demo. A desktop browser has no on-screen keyboard. Open the page on a phone.",
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: "adaptv freezes the layout viewport, so the keyboard covers the bottom of the page and the page does not resize. `AvoidKeyboard` adds the covered height to its bottom padding. When a text field inside it takes focus, it scrolls that field above the keyboard. See the [keyboard guide](/docs/keyboard).",
    },
    {
      type: "note",
      tone: "warn",
      text: "`AvoidKeyboard` must be the scroller. Put the scroll classes on it, as in the example. A scroller inside it would shrink and the field would stay covered.",
    },
    {
      type: "ul",
      items: [
        "The component reserves the larger of the keyboard height and the bottom safe area. Give the element only your design gap, such as `pb-2`. Do not add `pb-safe`.",
        "Keep the top inset (`pt-safe-offset-*`) on the element.",
        "Pad the bottom with a class, not inline `style`. The component owns inline `padding-bottom` while it reserves room.",
        "Do not use it inside a [Drawer](/docs/drawer). The drawer does its own avoidance. It also needs `patches.viewportFreeze` on, which is the default.",
      ],
    },
    {
      type: "p",
      text: 'For a bar docked at the bottom, such as a composer, use `behavior="margin"`. It lifts the element with `margin-bottom`.',
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
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "behavior",
          type: '"padding" | "margin"',
          default: '"padding"',
          description: "Which box property reserves the room.",
        },
        {
          name: "scrollIntoView",
          type: "boolean",
          default: "true",
          description: "Scroll the focused text field clear of the keyboard.",
        },
        {
          name: "scrollBuffer",
          type: "number",
          default: "24",
          description: "Gap in pixels between the field and the keyboard.",
        },
        {
          name: "isEnabled",
          type: "boolean",
          default: "true",
          description: "`false` reserves nothing and scrolls nothing.",
        },
        {
          name: "className",
          type: "string",
          description: "Classes for the root `div`. Nothing is locked.",
        },
        {
          name: "style",
          type: "CSSProperties",
          description:
            "Inline style. The component overwrites the reserved padding or margin and `--adaptv-keyboard-height`.",
        },
      ],
    },
    {
      type: "p",
      text: "Other `div` attributes pass through. The ref is the root `div`.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "table",
      head: ["Hook", "When", "Example"],
      rows: [
        [
          "`data-keyboard-open`",
          "While the keyboard is open.",
          "`data-keyboard-open:pb-4`",
        ],
        [
          "`--adaptv-keyboard-height`",
          "The live keyboard height, `0px` when closed.",
          "`h-[calc(100%-var(--adaptv-keyboard-height))]`",
        ],
      ],
    },
    { type: "h2", text: "useKeyboardAvoidance" },
    {
      type: "api",
      name: "useKeyboardAvoidance()",
      signature:
        "function useKeyboardAvoidance(options: UseKeyboardAvoidanceOptions): KeyboardAvoidanceState",
      description:
        "The logic behind `AvoidKeyboard`, for an element you render yourself. It writes no styles. Apply `space` as `padding-bottom` or `margin-bottom`.",
      params: [
        {
          name: "containerRef",
          type: "RefObject<HTMLElement | null>",
          required: true,
          description:
            "The element to measure and search for the focused field.",
        },
        {
          name: "behavior",
          type: '"padding" | "margin"',
          default: '"padding"',
          description: "The property you apply `space` to.",
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
            "Gap in pixels. Also exported as `DEFAULT_AVOID_KEYBOARD_SCROLL_BUFFER`.",
        },
        {
          name: "isEnabled",
          type: "boolean",
          default: "true",
          description: "Turn the hook off.",
        },
      ],
      returns:
        "`{ isKeyboardOpen, keyboardHeight, space, behavior }`. `space` is the pixel value to apply, or `0` when there is nothing to reserve.",
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "no",
          note: "No on-screen keyboard. The element is a plain `div`.",
        },
        {
          target: "Mobile web",
          status: "yes",
          note: "The height is estimated, so it settles over a frame.",
        },
        { target: "Installed PWA", status: "yes" },
        { target: "iOS", status: "yes", note: "Exact keyboard height." },
        { target: "Android", status: "yes", note: "Exact keyboard height." },
      ],
    },
  ],
}

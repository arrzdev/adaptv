import { ButtonDemo } from "@/components/docs-demos/button-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "button",
  title: "Button",
  summary:
    "A real `<button>` driven by adaptv's press engine, with optional haptics and icon slots whose width changes animate.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { Button, useButton, type ButtonHandle } from "@arrzdev/adaptv/components"',
  source: "src/components/button.tsx",
  blocks: [
    {
      type: "demo",
      component: ButtonDemo,
      code: `import { Button } from "@arrzdev/adaptv/components"

<Button
  haptic
  disabled={pending}
  aria-busy={pending}
  onClick={save}
  className="rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition-transform active:scale-95 disabled:opacity-70"
>
  {pending && (
    <Button.Leading className="pe-2">
      <Spinner />
    </Button.Leading>
  )}
  <Button.Text>{pending ? "Saving" : "Save"}</Button.Text>
</Button>`,
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: "`Button` is a `<button type=\"button\">`, so it is focusable, Space and Enter activate it, and a screen reader announces it. What it replaces is the browser's click. Activation comes from adaptv's press engine, the same one behind [Pressable](/docs/pressable):",
    },
    {
      type: "ul",
      items: [
        "A touch that turns into a scroll never fires and never flashes the pressed style.",
        "Releasing outside the button cancels. The press region extends `48px` past the button's frame, so the normal thumb roll on release still counts.",
        "Dragging off and back on re-arms the press, the way a native control does.",
      ],
    },
    {
      type: "p",
      text: "The handler prop is **`onClick`**, as on any `<button>`. It is `Pressable` that takes `onPress`.",
    },
    {
      type: "p",
      text: "Compose the content from `Button.Text` and, optionally, `Button.Leading` and `Button.Trailing`. Children render in the order you write them.",
    },
    {
      type: "code",
      label: "search-button.tsx",
      lang: "tsx",
      code: `<Button onClick={search} className="rounded-lg bg-gray-900 px-4 py-2 text-white active:scale-95">
  <Button.Leading className="pe-2">
    <SearchIcon />
  </Button.Leading>
  <Button.Text>Search</Button.Text>
</Button>`,
    },
    {
      type: "note",
      tone: "warn",
      text: '`Button` does not submit a form. `type` is always `"button"` and the engine cancels the native click, so there is no `type="submit"` variant. Submit from `onClick`, or call `form.requestSubmit()`.',
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "onClick",
          type: "(event) => void",
          description:
            "Fired on release inside the press region, and on Space or Enter key-up. Typed as the `<button>` click handler; the event you receive is the pointer or keyboard event that ended the press.",
        },
        {
          name: "haptic",
          type: 'boolean | "light" | "medium" | "heavy"',
          default: "false",
          description:
            'Fire a haptic on press-down, the moment of contact. `true` means `"light"`. See Haptics below for what each target can do.',
        },
        {
          name: "disabled",
          type: "boolean",
          default: "false",
          description:
            "Sets `disabled` and `aria-disabled`, drops every gesture, switches the cursor to `not-allowed` and turns the haptic off. A scroll that starts on a disabled button still scrolls the page.",
        },
        {
          name: "className",
          type: "string",
          description:
            "Lands on the `<button>`. Your whole design goes here; there are no variants. An explicit width utility (`w-full`, `w-64`, `sm:w-1/2`) also switches the button to fixed-width mode.",
        },
        {
          name: "children",
          type: "ReactNode",
          description:
            "`Button.Leading`, `Button.Text` and `Button.Trailing`, in order.",
        },
        {
          name: "ref",
          type: "Ref<ButtonHandle>",
          description: "An imperative handle, not the DOM node. See Ref below.",
        },
      ],
    },
    {
      type: "p",
      text: "Every other `<button>` attribute passes through (`aria-*`, `name`, `value`, `form`, `style`, `data-*`, `onFocus`, `onBlur`). The ones the press engine owns are removed from the type: `type`, `onPointerDown`, `onPointerMove`, `onPointerUp`, `onPointerCancel`, `onLostPointerCapture`, `onKeyDown`, `onKeyUp` and `onClickCapture`.",
    },
    { type: "h2", text: "Slots" },
    {
      type: "p",
      text: "All three are direct children of `Button` and throw if rendered outside one.",
    },
    { type: "h3", text: "Button.Text" },
    {
      type: "props",
      rows: [
        {
          name: "children",
          type: "ReactNode",
          required: true,
          description: "The label.",
        },
        {
          name: "className",
          type: "string",
          description:
            "Typography and truncation. In fixed-width mode the label can shrink, so `truncate` works; at intrinsic width it never shrinks.",
        },
      ],
    },
    { type: "h3", text: "Button.Leading and Button.Trailing" },
    {
      type: "props",
      rows: [
        {
          name: "children",
          type: "ReactNode",
          required: true,
          description:
            "An icon, spinner or badge. The slot renders nothing when this is `null`, `false` or whitespace.",
        },
        {
          name: "className",
          type: "string",
          description:
            "Spacing and sizing for the slot: `pe-2` on a leading slot, `ps-2` on a trailing one.",
        },
      ],
    },
    {
      type: "p",
      text: "Both slots are `aria-hidden`: they are decoration, and the accessible name comes from `Button.Text` or `aria-label`. An icon-only button needs an `aria-label`.",
    },
    { type: "h3", text: "Width changes animate" },
    {
      type: "p",
      text: "With no width utility on the root, the button is as wide as its content. When a slot mounts or unmounts, or the label changes, the content row tweens to its new measured width over `200ms` instead of snapping, so a spinner appearing does not jolt the layout next to it. The first render does not animate, and nothing animates under reduced motion or in fixed-width mode.",
    },
    {
      type: "note",
      tone: "warn",
      text: "Put the space between icon and label on the slot (`pe-2`, `ps-2`), never as `gap-*` on the root. A gap disappears the instant the slot unmounts, and the width change happens in two steps.",
    },
    { type: "h2", text: "Haptics" },
    {
      type: "p",
      text: "`haptic` fires on contact, before the press resolves, which is when a native control ticks. For haptics outside a button, use [useHaptics](/docs/hooks-feedback).",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "no",
          note: "No vibration hardware. The prop is harmless.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "Android Chrome vibrates through `navigator.vibrate`, with a longer pulse for a heavier weight. iOS Safari gets the single system tick described under Installed PWA.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Android as above. iOS has no vibration API, so adaptv mounts an invisible switch input over the button and the user's finger triggers the system tick. The weight is ignored there: it is the only haptic WebKit exposes.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "The native haptic engine. `light`, `medium` and `heavy` feel different.",
        },
        {
          target: "Android",
          status: "yes",
          note: "The native haptic engine, with the three weights mapped onto the OS constants.",
        },
      ],
    },
    {
      type: "note",
      text: "The iOS web tick depends on the user having System Haptics turned on, which a page cannot detect. The technique is covered by structural tests only; it has not yet been confirmed on physical iOS hardware.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: "The baseline is neutral: `inline-flex w-fit max-w-full items-center justify-center select-none`, a light grey surface (`bg-gray-50 text-gray-950`) and `cursor-pointer`. All of it can be overridden from `className`, including the cursor (`cursor-wait` on a pending button). The only locked classes are the three `touch-action` utilities the press engine needs.",
    },
    { type: "h3", text: "Press state" },
    {
      type: "p",
      text: "Write plain `active:`. adaptv re-points that Tailwind variant at the engine's `data-pressed` attribute on any element the press engine drives, so `active:scale-95` follows the real press: it appears `100ms` after contact (a scroll cancels it before it shows), stays for at least `150ms` so a quick tap is still visible, drops when the finger leaves the press region and returns when it slides back. Keyboard activation does not set it. [Pressable](/docs/pressable) explains the mechanism.",
    },
    {
      type: "table",
      head: ["Hook", "When", "Example"],
      rows: [
        ['`data-adaptv="button"`', "Always.", '`[data-adaptv="button"] { … }`'],
        [
          "`data-pressed`",
          "A pointer is down inside the press region.",
          "`active:scale-95`",
        ],
        [
          "`:disabled`, `aria-disabled`",
          "`disabled` is set. There is no `data-disabled` on `Button`.",
          "`disabled:opacity-50`",
        ],
        [
          "`:focus-visible`",
          "Keyboard focus. adaptv draws a `2px` outline by default; set `--adaptv-ring` on `:root` to colour it.",
          "`focus-visible:outline-blue-500`",
        ],
      ],
    },
    { type: "h3", text: "Borders and layout shift" },
    {
      type: "p",
      text: "`Button` reserves no border. If a border appears only in some states (selected, invalid), it takes space from the content box and the label moves. Use `outline` for emphasis that toggles: it never takes part in layout and it follows `border-radius`.",
    },
    {
      type: "code",
      label: "toggle-emphasis.tsx",
      lang: "tsx",
      code: `<Button
  className={cn(
    "rounded-lg px-3 py-2 outline-2 outline-transparent",
    selected && "outline-orange-500",
  )}
>
  <Button.Text>{label}</Button.Text>
</Button>`,
    },
    { type: "h3", text: "useButton()" },
    {
      type: "p",
      text: "Inside a `Button`, `useButton()` returns `{ isDisabled, hasFixedWidth }`, for a design-system slot that has to react to the live state. It throws outside a `Button`.",
    },
    {
      type: "code",
      label: "app-button-icon.tsx",
      lang: "tsx",
      code: `function Icon({ children }: { children: ReactNode }) {
  const { isDisabled } = useButton()
  return (
    <Button.Leading className={cn("pe-2", isDisabled && "opacity-40")}>
      {children}
    </Button.Leading>
  )
}`,
    },
    { type: "h2", text: "Ref" },
    {
      type: "p",
      text: "`ref` is a `ButtonHandle`, not the `<button>` element.",
    },
    {
      type: "props",
      rows: [
        {
          name: "disabled",
          type: "boolean",
          description: "Live disabled state. Read only.",
        },
        {
          name: "focus()",
          type: "() => void",
          description: "Focuses the underlying `<button>`.",
        },
      ],
    },
    { type: "h2", text: "Accessibility" },
    {
      type: "ul",
      items: [
        "Space and Enter activate on key-up. A held key does not repeat.",
        "A disabled button uses the native `disabled` attribute, so it leaves the tab order.",
        "For a pending action, set `aria-busy` alongside `disabled`.",
        "Navigation belongs to [Link](/docs/link), which renders a real anchor. Use `Button` with the [router](/docs/router-api) only when navigating is a side effect of an action.",
      ],
    },
    { type: "h2", text: "Where it works" },
    {
      type: "p",
      text: "Press handling, keyboard activation and the width tween are the same on every target. Only `haptic` differs; see the table under Haptics.",
    },
  ],
}

import { CheckboxDemo } from "@/components/docs-demos/checkbox-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "checkbox",
  title: "Checkbox",
  summary:
    "A checkbox with a real input underneath, a press engine on top, an indeterminate state, and a box and mark you paint yourself.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { Checkbox, useCheckbox } from "@arrzdev/adaptv/components"',
  source: "src/components/checkbox.tsx",
  blocks: [
    {
      type: "demo",
      component: CheckboxDemo,
      code: `import { Checkbox, useCheckbox } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"

function Box() {
  const { isChecked, isIndeterminate } = useCheckbox()
  const filled = isChecked || isIndeterminate
  return (
    <Checkbox.Box
      className={cn(
        "rounded-md transition-colors",
        filled ? "bg-blue-600" : "bg-white outline outline-1 -outline-offset-1 outline-gray-300",
      )}
    >
      <Checkbox.Icon className="text-white" />
      {isIndeterminate && <span className="absolute h-0.5 w-2.5 rounded-full bg-white" />}
    </Checkbox.Box>
  )
}
Box.displayName = "Checkbox.Box"

const all = picked.length === TOPPINGS.length
const some = picked.length > 0 && !all

<Checkbox
  size={6}
  aria-label="All toppings"
  checked={all}
  indeterminate={some}
  onCheckedChange={(next) => setPicked(next ? TOPPINGS : [])}
>
  <Box />
</Checkbox>`,
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: "With no children, `Checkbox` renders a grey square (`bg-gray-50`) and a checkmark in the current text colour. That baseline is there so the control is usable before you style it. In an app you compose `Checkbox.Box` and `Checkbox.Icon` and branch their classes on state, either from the `checked` value you already hold or from `useCheckbox()` inside a wrapper. Do not reach for `has-[:checked]:`, `peer-checked:` or `group-*` variants: the state lives in React, and the classes should too.",
    },
    {
      type: "p",
      text: 'It works controlled (`checked` + `onCheckedChange`) or uncontrolled (`defaultChecked`). Underneath it is an `<input type="checkbox">`, visually hidden, so it submits with a form, takes `name`, `value` and `required`, receives keyboard focus and is announced correctly by a screen reader.',
    },
    {
      type: "p",
      text: "A controlled checkbox never moves on its own. `onCheckedChange` reports what the user asked for; the box shows whatever `checked` says. If you ignore the callback, the box stays put.",
    },
    {
      type: "note",
      tone: "warn",
      text: "The component renders the box and nothing else. Text placed inside `<Checkbox>` is not a label: any child that is not a `Checkbox.Box` is wrapped in one, and when a `Checkbox.Box` is present every other child is dropped. Put the text next to the checkbox. A separate `<label htmlFor>` pointing at it does not toggle it either, because activation comes from the press engine and the native click is swallowed. To make the text tappable, give it its own [Pressable](/docs/pressable) that sets the same state.",
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "checked",
          type: "boolean",
          description: "Controlled checked state.",
        },
        {
          name: "defaultChecked",
          type: "boolean",
          default: "false",
          description: "Initial checked state when uncontrolled.",
        },
        {
          name: "indeterminate",
          type: "boolean",
          default: "false",
          description:
            "Mixed selection. Sets `input.indeterminate`, hides the mark, and makes the next toggle resolve to `true` whatever `checked` was. It is a third look on top of `checked`, and it stays on until you pass `false`.",
        },
        {
          name: "onCheckedChange",
          type: "(checked: boolean) => void",
          description:
            "Fired when the user toggles. Receives the next value. Never fires while disabled.",
        },
        {
          name: "size",
          type: "number",
          default: "8",
          description:
            "Tailwind spacing index. The box edge is `size × 0.25rem` (so `8` is 2rem), the mark is 0.625 of the edge, and the checkmark's stroke scales with it.",
        },
        {
          name: "disabled",
          type: "boolean",
          default: "false",
          description:
            "Drops every gesture, disables the input and switches the cursor to `not-allowed`. Read it in a wrapper with `useCheckbox().isDisabled`.",
        },
        {
          name: "className",
          type: "string",
          description:
            "Lands on the root `<label>`, which is the hit target. Merged after the baseline `relative inline-flex shrink-0 items-center justify-center cursor-pointer`.",
        },
        {
          name: "style",
          type: "CSSProperties",
          description: "Inline style for the root `<label>`.",
        },
        {
          name: "id",
          type: "string",
          description: "Id of the underlying input. Generated when omitted.",
        },
        {
          name: "children",
          type: "ReactNode",
          description:
            "An optional `Checkbox.Box`. Omit it for the default box and checkmark.",
        },
      ],
    },
    {
      type: "p",
      text: "Every other `<input>` attribute passes through to the hidden input (`name`, `value`, `required`, `aria-label`, `aria-labelledby`), except the ones the component owns: `type`, `onChange`, `size`, `className`, `style`, `children` and `defaultChecked`. `onPointerDown` and `onPointerUp` are the exception to the exception: they are attached to the root `<label>` and run before the press engine's own handlers.",
    },
    { type: "h2", text: "Checkbox.Box" },
    {
      type: "p",
      text: "The visible square. It is a `<span>` whose width and height come from the root's `size`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "className",
          type: "string",
          description:
            "Shape, fill and ring. Merged over the `bg-gray-50` baseline.",
        },
        {
          name: "style",
          type: "CSSProperties",
          description:
            "Inline style. `width` and `height` are locked to the value derived from `size` and cannot be overridden here.",
        },
        {
          name: "children",
          type: "ReactNode",
          description:
            "Usually a `Checkbox.Icon`. Leave it empty for a checkbox whose checked state is the fill alone.",
        },
      ],
    },
    { type: "h2", text: "Checkbox.Icon" },
    {
      type: "p",
      text: "The mark inside the box. It is always mounted; its `opacity` is `1` when checked and `0` when unchecked or indeterminate, so it can fade with `transition-opacity`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "className",
          type: "string",
          description:
            "Mark colour (the default checkmark strokes with `currentColor`, so use `text-*`) and motion utilities.",
        },
        {
          name: "children",
          type: "ReactNode",
          description:
            "A custom mark, rendered in a `<span>` sized like the default one. Omit it for the built-in SVG checkmark.",
        },
      ],
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: "`useCheckbox()` gives a box or icon wrapper the live `isChecked`, `isIndeterminate`, `isDisabled` and `size`. It throws outside a `<Checkbox>`. Give a box wrapper the display name `Checkbox.Box` so the root recognises it; without it the root wraps your component in a second, default box.",
    },
    {
      type: "code",
      label: "app-checkbox.tsx",
      lang: "tsx",
      code: `import type { CheckboxHandle, CheckboxProps } from "@arrzdev/adaptv/components"
import { Checkbox as BaseCheckbox, useCheckbox } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import { forwardRef } from "react"

function Box() {
  const { isChecked, isDisabled } = useCheckbox()
  return (
    <BaseCheckbox.Box
      className={cn(
        "rounded-sm",
        isChecked ? "bg-blue-600" : "bg-white ring-1 ring-inset ring-gray-300",
        isDisabled && "opacity-50",
      )}
    >
      <BaseCheckbox.Icon className="text-white" />
    </BaseCheckbox.Box>
  )
}
Box.displayName = "Checkbox.Box"

export const Checkbox = forwardRef<CheckboxHandle, CheckboxProps>(
  function Checkbox(props, ref) {
    return (
      <BaseCheckbox ref={ref} {...props}>
        <Box />
      </BaseCheckbox>
    )
  },
)`,
    },
    {
      type: "table",
      head: ["Element", "Hook", "Locked"],
      rows: [
        [
          "Root `<label>`",
          '`[data-adaptv="checkbox"]`, and `[data-pressed]` while a pointer press is down',
          "The `touch-action` classes that keep a press cancellable when the page scrolls. Layout is yours: turning the root into a larger hit target with padding is a supported restyle.",
        ],
        [
          "`Checkbox.Box`",
          "`className`, `style`",
          "`relative flex shrink-0 items-center justify-center overflow-hidden`, plus the width and height from `size`.",
        ],
        [
          "`Checkbox.Icon`",
          "`className`",
          "`pointer-events-none`, plus width, height and `opacity`. Pinning the opacity would draw a checkmark on an unchecked box.",
        ],
      ],
    },
    {
      type: "p",
      text: "There is no built-in dash for the indeterminate state: the mark hides and the rest is up to you. Fill the box, as the demo does, or render your own dash inside `Checkbox.Box` when `isIndeterminate` is true. A custom `Checkbox.Icon` child will not work for this, because the icon is transparent while indeterminate.",
    },
    {
      type: "p",
      text: "Keyboard activation does not set `data-pressed`, so a press animation tied to it never plays for Space or Enter. Use `focus-within:` on the root for a focus ring: the focused element is the hidden input inside it.",
    },
    { type: "h2", text: "Ref" },
    {
      type: "props",
      rows: [
        {
          name: "checked",
          type: "boolean",
          description: "Live checked state. Read only.",
        },
        {
          name: "disabled",
          type: "boolean",
          description: "Live disabled state. Read only.",
        },
        {
          name: "focus()",
          type: "() => void",
          description: "Focuses the underlying checkbox input.",
        },
      ],
    },
    { type: "h2", text: "Accessibility" },
    {
      type: "ul",
      items: [
        "The root has no text, so always pass `aria-label` or `aria-labelledby`. Both land on the input.",
        "Tab focuses the input. Space and Enter both toggle it, once per key press; a held key does not repeat.",
        "While indeterminate, the input reports the mixed state to assistive technology through `input.indeterminate`.",
        "The default checkmark is `aria-hidden`.",
      ],
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Mouse and keyboard.",
        },
        {
          target: "Mobile web",
          status: "yes",
          note: "A touch that turns into a scroll cancels the press, so a checkbox in a list does not toggle under a scrolling thumb.",
        },
        { target: "Installed PWA", status: "yes" },
        {
          target: "iOS",
          status: "yes",
          note: "Call `selection()` from [useHaptics](/docs/hooks-feedback) in `onCheckedChange` for the tick a native control has.",
        },
        { target: "Android", status: "yes" },
      ],
    },
  ],
}

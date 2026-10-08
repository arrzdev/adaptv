import { CheckboxDemo } from "@/components/docs-demos/checkbox-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "checkbox",
  title: "Checkbox",
  summary:
    "A checkbox with an indeterminate state and a box you paint yourself.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { Checkbox, useCheckbox } from "adaptv/components"',
  source: "src/components/checkbox.tsx",
  blocks: [
    {
      type: "demo",
      component: CheckboxDemo,
      code: `import { Checkbox, useCheckbox } from "adaptv/components"

function Box() {
  const { isChecked, isIndeterminate } = useCheckbox()
  const filled = isChecked || isIndeterminate
  return (
    <Checkbox.Box
      className={\`rounded-md transition-colors \${
        filled ? "bg-blue-600" : "bg-white outline outline-1 -outline-offset-1 outline-gray-300"
      }\`}
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
      text: 'With no children, `Checkbox` is a grey square with a checkmark. To style it, compose `Checkbox.Box` and `Checkbox.Icon`. Branch their classes on your `checked` value or on `useCheckbox()` in a wrapper, not on `:checked` or `peer-checked:` variants. It is a hidden `<input type="checkbox">`, so it works in forms and screen readers. A controlled checkbox shows what `checked` says and nothing else.',
    },
    {
      type: "note",
      tone: "warn",
      text: "`Checkbox` has no label text. Put the text next to it. A `<label>` that wraps it toggles it.",
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        { name: "checked", type: "boolean", description: "Controlled state." },
        {
          name: "defaultChecked",
          type: "boolean",
          default: "false",
          description: "Start state, uncontrolled.",
        },
        {
          name: "indeterminate",
          type: "boolean",
          default: "false",
          description:
            "Mixed selection. The mark hides and the next toggle gives `true`. It stays on until you pass `false`.",
        },
        {
          name: "onCheckedChange",
          type: "(checked: boolean) => void",
          description: "Called with the next value. Never runs while disabled.",
        },
        {
          name: "size",
          type: "number",
          default: "8",
          description:
            "Tailwind spacing index. The box edge is `size × 0.25rem`.",
        },
        {
          name: "disabled",
          type: "boolean",
          default: "false",
          description: "Ignore gestures and disable the input.",
        },
        {
          name: "className",
          type: "string",
          description: "Lands on the root `<label>`, the hit target.",
        },
        {
          name: "children",
          type: "ReactNode",
          description: "A `Checkbox.Box`. Any other child is wrapped in a box.",
        },
      ],
    },
    {
      type: "p",
      text: "Other `<input>` attributes pass through to the hidden input, such as `name`, `value`, `required` and `aria-label`.",
    },
    { type: "h3", text: "Checkbox.Box and Checkbox.Icon" },
    {
      type: "p",
      text: "`Checkbox.Box` is the square. It takes `className`, `style` and `children`. Its width and height come from `size` and are locked. `Checkbox.Icon` is the mark. It takes `className` (use `text-*` for colour) and optional `children` for a custom mark. Its opacity is `1` when checked and `0` otherwise, so it can fade. There is no built-in dash for indeterminate. Fill the box, or draw a dash in the box when `isIndeterminate` is true.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: '`useCheckbox()` returns `isChecked`, `isIndeterminate`, `isDisabled` and `size`. Set a box wrapper\'s `displayName` to `Checkbox.Box`, or the root wraps it in a second box. The root has `data-adaptv="checkbox"` and `data-pressed` while a pointer is down. Keyboard activation does not set `data-pressed`. For a focus ring, use `focus-within:` on the root. The `touch-action` classes are locked.',
    },
    { type: "h2", text: "Accessibility" },
    {
      type: "p",
      text: "Always pass `aria-label` or `aria-labelledby`. Space and Enter toggle it. In the mixed state the input reports `indeterminate`. A `ref` gives read-only `checked` and `disabled`, and `focus()`.",
    },
    { type: "h2", text: "Where it works" },
    {
      type: "p",
      text: "Everywhere. A scroll cancels a touch, so a checkbox in a list does not toggle under a scrolling thumb. On iOS, call `selection()` from [useHaptics](/docs/hooks-feedback) in `onCheckedChange`.",
    },
  ],
}

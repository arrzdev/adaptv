import { SwitchDemo } from "@/components/docs-demos/switch-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "switch",
  title: "Switch",
  summary:
    "An on/off toggle with a real checkbox underneath, a press engine on top, and no paint of its own.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine: 'import { Switch, useSwitch } from "@arrzdev/adaptv/components"',
  source: "src/components/switch.tsx",
  blocks: [
    {
      type: "demo",
      component: SwitchDemo,
      code: `import { Switch } from "@arrzdev/adaptv/components"

const [checked, setChecked] = useState(true)

<Switch
  size={7}
  aria-label="Notifications"
  checked={checked}
  onCheckedChange={setChecked}
  className={cn("rounded-full bg-gray-300 transition-colors", checked && "bg-green-500")}
>
  <Switch.Thumb className="rounded-full bg-white shadow-sm" />
</Switch>`,
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: "`Switch` ships a neutral grey baseline and nothing else. The track takes your classes through `className`, the thumb through `Switch.Thumb`. Branch the on state from the `checked` value you already hold. Do not reach for `has-[:checked]:` or `aria-checked:` variants: the state lives in React, and the classes should too.",
    },
    {
      type: "p",
      text: 'It works controlled (`checked` + `onCheckedChange`) or uncontrolled (`defaultChecked`). Underneath it is an `<input type="checkbox" role="switch">`, so it submits with a form, takes `name` and `value`, and is announced correctly by a screen reader.',
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "checked",
          type: "boolean",
          description: "Controlled on state.",
        },
        {
          name: "defaultChecked",
          type: "boolean",
          default: "false",
          description: "Initial on state when uncontrolled.",
        },
        {
          name: "onCheckedChange",
          type: "(checked: boolean) => void",
          description: "Fired when the user toggles. Receives the next value.",
        },
        {
          name: "size",
          type: "number",
          description:
            "Tailwind spacing index. Track height is `size × 0.25rem`, width is 12/7 of the height, and the thumb is 6/7 of the height with an equal gap on every side.",
        },
        {
          name: "disabled",
          type: "boolean",
          default: "false",
          description:
            "Drops every gesture and sets `aria-disabled`. Read it in a thumb wrapper with `useSwitch().isDisabled`.",
        },
        {
          name: "className",
          type: "string",
          description: "Track utilities, merged after the neutral baseline.",
        },
        {
          name: "children",
          type: "ReactNode",
          description:
            "An optional `Switch.Thumb`. Omit it for the default neutral thumb.",
        },
      ],
    },
    {
      type: "p",
      text: "Every other `<input>` attribute passes through, except the ones the component owns: `type`, `role`, `onChange`, `size`, `className`, `style` and `children`.",
    },
    { type: "h2", text: "Styling the thumb" },
    {
      type: "p",
      text: "A design-system wrapper usually wants the thumb to react to state too. `useSwitch()` gives a thumb wrapper the live `isChecked`, `isDisabled` and `size`. Give the wrapper the display name `Switch.Thumb` so the track still recognises it as its thumb.",
    },
    {
      type: "code",
      label: "app-switch.tsx",
      lang: "tsx",
      code: `function Thumb() {
  const { isDisabled } = useSwitch()
  return (
    <Switch.Thumb
      className={cn("rounded-full bg-white shadow-sm", isDisabled && "opacity-50")}
    />
  )
}
Thumb.displayName = "Switch.Thumb"`,
    },
    { type: "h2", text: "Ref" },
    {
      type: "props",
      rows: [
        {
          name: "checked",
          type: "boolean",
          description: "Live on state. Read only.",
        },
        {
          name: "disabled",
          type: "boolean",
          description: "Live disabled state. Read only.",
        },
        {
          name: "focus()",
          type: "() => void",
          description: "Focuses the underlying checkbox.",
        },
      ],
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Mouse and keyboard. Space toggles it.",
        },
        { target: "Mobile web", status: "yes" },
        { target: "Installed PWA", status: "yes" },
        {
          target: "iOS",
          status: "yes",
          note: "Pair it with [useHaptics](/docs/hooks-feedback) for the selection tick a native switch has.",
        },
        { target: "Android", status: "yes" },
      ],
    },
  ],
}

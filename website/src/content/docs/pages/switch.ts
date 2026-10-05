import { SwitchDemo } from "@/components/docs-demos/switch-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "switch",
  title: "Switch",
  summary: "An on/off toggle with no paint of its own.",
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
      text: '`Switch` is a checkbox with `role="switch"`,. Style the track with `className` and the thumb with `Switch.Thumb`. Branch the on state from your `checked` value, not `:checked` variants.',
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
          description: "Start state, uncontrolled.",
        },
        {
          name: "onCheckedChange",
          type: "(checked: boolean) => void",
          description: "Called with the next value.",
        },
        {
          name: "size",
          type: "number",
          description:
            "Tailwind spacing index. Track height is `size × 0.25rem`. Width is 12/7 of that.",
        },
        {
          name: "disabled",
          type: "boolean",
          default: "false",
          description: "Ignore gestures.",
        },
        {
          name: "className",
          type: "string",
          description: "Track classes.",
        },
        {
          name: "children",
          type: "ReactNode",
          description: "A `Switch.Thumb`.",
        },
      ],
    },
    {
      type: "p",
      text: "Other `<input>` attributes pass through.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "p",
      text: "A thumb wrapper can call `useSwitch()` for `isChecked`, `isDisabled` and `size`. Name it `Switch.Thumb` with `displayName`.",
    },
    { type: "h2", text: "Where it works" },
    {
      type: "p",
      text: "Everywhere. On iOS, pair it with [useHaptics](/docs/hooks-feedback).",
    },
  ],
}

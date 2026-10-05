import { WheelColumnDemo } from "@/components/docs-demos/wheel-column-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "wheel-column",
  title: "WheelColumn",
  summary: "One column of a picker wheel.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { WheelColumn, WHEEL_ITEM_HEIGHT, WHEEL_HEIGHT } from "@arrzdev/adaptv/components"',
  source: "src/components/wheel-column.tsx",
  blocks: [
    {
      type: "demo",
      component: WheelColumnDemo,
      code: `import type { WheelItem } from "@arrzdev/adaptv/components"
import { View, WHEEL_ITEM_HEIGHT, WheelColumn } from "@arrzdev/adaptv/components"

function range(count: number): WheelItem[] {
  return Array.from({ length: count }, (_, value) => ({
    value,
    label: String(value).padStart(2, "0"),
  }))
}

const HOURS = range(24)
const MINUTES = range(60)
const item = "text-gray-400 data-[active=true]:text-gray-950"

const [hour, setHour] = useState(9)
const [minute, setMinute] = useState(30)

<View row className="relative w-44 items-stretch">
  {/* the selection band is yours: one row tall, behind the columns */}
  <View
    aria-hidden
    className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-lg bg-gray-100"
    style={{ height: WHEEL_ITEM_HEIGHT }}
  />
  <WheelColumn
    ariaLabel="Hour"
    items={HOURS}
    value={hour}
    onChange={setHour}
    className="relative flex-1"
    itemClassName={item}
  />
  <WheelColumn
    ariaLabel="Minute"
    items={MINUTES}
    value={minute}
    onChange={setMinute}
    className="relative flex-1"
    itemClassName={item}
  />
</View>`,
    },
    { type: "h2", text: "Usage" },
    {
      type: "p",
      text: "`WheelColumn` takes a list of `{ value, label }` items and reports the centred one. It is controlled. Hold the value in state and update it in `onChange`. Put several columns side by side to make a picker. Draw the selection band yourself, one `WHEEL_ITEM_HEIGHT` tall, behind the columns. The wheel glides with free momentum. About 120ms after it stops, it rolls to the nearest row. A tap on a row rolls it to the centre.",
    },
    { type: "h2", text: "Props" },
    {
      type: "props",
      rows: [
        {
          name: "items",
          type: "WheelItem[]",
          required: true,
          description:
            "The rows. `WheelItem` is `{ value: number; label: string }`. Values must be unique. Memoise the array.",
        },
        {
          name: "value",
          type: "number",
          required: true,
          description:
            "The centred value. A value not in `items` centres the first row. Changes from outside are ignored while the wheel moves.",
        },
        {
          name: "onChange",
          type: "(value: number) => void",
          required: true,
          description:
            "Called live as rows cross the centre, and once more when the wheel settles.",
        },
        {
          name: "ariaLabel",
          type: "string",
          required: true,
          description:
            "Name for the column. It is the `aria-label` of a `fieldset`.",
        },
        {
          name: "className",
          type: "string",
          description:
            "Classes for the scroll container: width, flex share, position.",
        },
        {
          name: "itemClassName",
          type: "string",
          description:
            "Classes for every row. Style the centred row with `data-[active=true]:`.",
        },
      ],
    },
    {
      type: "p",
      text: "These are all the props. The row height and the number of visible rows are fixed.",
    },
    {
      type: "table",
      head: ["Export", "Value", "Use"],
      rows: [
        ["`WHEEL_ITEM_HEIGHT`", "`30`", "Height of one row in pixels."],
        ["`WHEEL_HEIGHT`", "`150`", "Height of the column: five rows."],
      ],
    },
    {
      type: "note",
      tone: "warn",
      text: "`onChange` compares against the `value` prop. If you do not store the new value, it fires on every scroll event. Store it on every call. Debounce expensive work.",
    },
    { type: "h2", text: "Haptics" },
    {
      type: "p",
      text: "The wheel makes no tick of its own. Call `selection()` from [useHaptics](/docs/hooks-feedback) in `onChange`.",
    },
    { type: "h2", text: "Styling" },
    {
      type: "table",
      head: ["Element", "Hook", "Locked"],
      rows: [
        [
          "Column (`fieldset`)",
          '`[data-adaptv="wheel-column"]`, `className`',
          "Height, the fade mask, vertical scroll and overscroll.",
        ],
        [
          "Row (`button`)",
          '`itemClassName`, `data-active="true"` on the centred row',
          "`h-full w-full` and touch-action classes.",
        ],
      ],
    },
    {
      type: "p",
      text: "Change only colours in `itemClassName`. Keep size and weight equal across rows. Do not add transform classes. The wheel sets a transform on each row while it moves. Inside a [Drawer](/docs/drawer), spinning the wheel never drags the sheet.",
    },
    { type: "h2", text: "Accessibility" },
    {
      type: "p",
      text: "The column is a labelled `fieldset` and one tab stop. Arrow keys move one row. Page Up and Page Down move five. Home and End go to the first and last row.",
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "Mouse wheel, trackpad, keys and clicks work. A mouse cannot drag the wheel.",
        },
        { target: "Mobile web", status: "yes" },
        { target: "Installed PWA", status: "yes" },
        { target: "iOS", status: "yes", note: "The longest fling." },
        {
          target: "Android",
          status: "yes",
          note: "The fling is shorter than on iOS.",
        },
      ],
    },
  ],
}

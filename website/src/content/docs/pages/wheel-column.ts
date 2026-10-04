import { WheelColumnDemo } from "@/components/docs-demos/wheel-column-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "wheel-column",
  title: "WheelColumn",
  summary:
    "One column of an iOS-style picker wheel: free momentum, a drum projection, a live value while it spins and a snap when it stops.",
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
      text: "`WheelColumn` is a single column. It knows nothing about dates or times: it takes a list of `{ value, label }` items and reports which one is centred. A picker is several columns side by side, composed where you use them.",
    },
    {
      type: "p",
      text: "It is a controlled component. Hold the value in state, pass it as `value`, and update it from `onChange`. There is no uncontrolled mode.",
    },
    {
      type: "p",
      text: "The column is a native scroller with free momentum. There is deliberately no CSS scroll-snap: on iOS `scroll-snap-type: y mandatory` cuts a fling down to a row or two, because the engine aims for the nearest snap point. The wheel glides as far as the platform lets it, and 120ms after it stops it rolls smoothly to the nearest whole row. Tapping or clicking a row rolls it to the centre.",
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
            "The rows, in order. `WheelItem` is `{ value: number; label: string }`. Values must be unique: they are the rows' React keys.",
        },
        {
          name: "value",
          type: "number",
          required: true,
          description:
            "The centred value. When it changes from outside while the wheel is idle, the wheel jumps to that row; while the wheel is moving, outside changes are ignored so an echo of `onChange` never yanks a glide. A value that is not in `items` centres the first row.",
        },
        {
          name: "onChange",
          type: "(value: number) => void",
          required: true,
          description:
            "Fired whenever the centred row differs from `value`: live, as rows cross the centre, and once more when the wheel settles.",
        },
        {
          name: "ariaLabel",
          type: "string",
          required: true,
          description:
            "Accessible name for the column. It is rendered as the `aria-label` of a `<fieldset>`.",
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
            "Classes for every row. Branch the centred row with `data-[active=true]:`.",
        },
      ],
    },
    {
      type: "p",
      text: "These are all the props. There is no `disabled`, no `ref` and no way to change the row height or the number of visible rows.",
    },
    { type: "h3", text: "Constants" },
    {
      type: "table",
      head: ["Export", "Value", "Use"],
      rows: [
        [
          "`WHEEL_ITEM_HEIGHT`",
          "`30`",
          "Height of one row in pixels. Size your selection band with it so the band cannot drift from the rows.",
        ],
        [
          "`WHEEL_HEIGHT`",
          "`150`",
          "Height of the column: five rows, two visible above and below the centre.",
        ],
      ],
    },
    { type: "h2", text: "Live value and settle" },
    {
      type: "p",
      text: "`onChange` does not wait for the wheel to stop. On every scroll event the column works out which row is centred and, if that row's value differs from the `value` prop, calls `onChange`. When you store the value each time, that is one call per row crossed. The point of reporting live is that closing a sheet or submitting a form mid-glide saves what the user last saw.",
    },
    {
      type: "p",
      text: "When scrolling stops and no finger is down, the wheel rolls to the exact row and calls `onChange` a final time if the value still differs. There is no separate settle callback and no flag that tells a live call from the last one.",
    },
    {
      type: "note",
      tone: "warn",
      text: "The comparison is against the `value` prop. If you ignore `onChange` and leave `value` unchanged, every scroll event reports again, because the centred row keeps differing from the prop. Store the value on every call. If the work behind it is expensive (a request, a big re-render), keep the state update cheap and debounce the expensive part.",
    },
    { type: "h2", text: "Composing a date picker" },
    {
      type: "p",
      text: "Three columns and one `Date`. Each column's `onChange` rebuilds the date from its own new part and the other two current parts. The day column's items depend on the month and year, so the day has to be clamped when the month changes: keep `value` inside `items`, or the wheel falls back to its first row.",
    },
    {
      type: "code",
      label: "date-wheel-picker.tsx",
      lang: "tsx",
      code: `import type { WheelItem } from "@arrzdev/adaptv/components"
import { View, WHEEL_ITEM_HEIGHT, WheelColumn } from "@arrzdev/adaptv/components"
import { useMemo, useRef } from "react"

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"]
const ITEM = "text-gray-400 data-[active=true]:text-gray-950"

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate()
}

export function DateWheelPicker({ value, onChange }: {
  value: Date
  onChange: (value: Date) => void
}) {
  const day = value.getDate()
  const month = value.getMonth()
  const year = value.getFullYear()

  const monthItems = useMemo<WheelItem[]>(
    () => MONTHS.map((label, index) => ({ value: index, label })),
    [],
  )
  //seeded once, so the year the picker opened on stays on the wheel
  const seededYear = useRef(year)
  const yearItems = useMemo<WheelItem[]>(() => {
    const current = new Date().getFullYear()
    const first = Math.min(current, seededYear.current)
    const last = Math.max(current + 5, seededYear.current)
    return Array.from({ length: last - first + 1 }, (_, i) => ({
      value: first + i,
      label: \`\${first + i}\`,
    }))
  }, [])
  const dayItems = useMemo<WheelItem[]>(
    () =>
      Array.from({ length: daysInMonth(year, month) }, (_, i) => ({
        value: i + 1,
        label: \`\${i + 1}\`,
      })),
    [year, month],
  )

  //Feb 30 -> Feb 28: clamp the day to the month it lands in
  function emit(nextYear: number, nextMonth: number, nextDay: number) {
    const clamped = Math.min(nextDay, daysInMonth(nextYear, nextMonth))
    onChange(new Date(nextYear, nextMonth, clamped))
  }

  return (
    <View row className="relative items-stretch">
      <View
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded bg-gray-100"
        style={{ height: WHEEL_ITEM_HEIGHT }}
      />
      <WheelColumn ariaLabel="Day" items={dayItems} value={day}
        onChange={(next) => emit(year, month, next)}
        className="relative flex-[1.1]" itemClassName={ITEM} />
      <WheelColumn ariaLabel="Month" items={monthItems} value={month}
        onChange={(next) => emit(year, next, day)}
        className="relative flex-[1.6]" itemClassName={ITEM} />
      <WheelColumn ariaLabel="Year" items={yearItems} value={year}
        onChange={(next) => emit(next, month, day)}
        className="relative flex-[1.2]" itemClassName={ITEM} />
    </View>
  )
}`,
    },
    {
      type: "ul",
      items: [
        "Memoise the item arrays. The wheel re-projects its rows whenever `items` changes identity.",
        "Build the year range once, from the year the picker opened on. If it is derived from the live selection, the original year drops off the wheel the moment you scroll away from it.",
        "Give each column `relative` when a band sits behind them, so the columns paint above it.",
        "Inside a [Drawer](/docs/drawer) nothing extra is needed: the column is marked `data-drawer-no-drag`, so spinning past the first row never starts dragging the sheet.",
      ],
    },
    { type: "h2", text: "Haptics" },
    {
      type: "p",
      text: "The wheel does not tick on its own. Because `onChange` fires once per row crossed, it is the place to add one: call `selection()` from [useHaptics](/docs/hooks-feedback) before you store the value. Where that produces a pulse depends on the target; see that page.",
    },
    {
      type: "code",
      label: "tick-per-row.tsx",
      lang: "tsx",
      code: `const haptic = useHaptics()

<WheelColumn
  ariaLabel="Minute"
  items={MINUTES}
  value={minute}
  onChange={(next) => {
    haptic.selection()
    setMinute(next)
  }}
/>`,
    },
    { type: "h2", text: "Styling" },
    {
      type: "table",
      head: ["Element", "Hook", "Locked"],
      rows: [
        [
          "Column (`<fieldset>`)",
          '`[data-adaptv="wheel-column"]`, `className`',
          "Height (`150px`), the fade mask over the outer rows, vertical scrolling and contained overscroll. The index is read from `scrollTop`, so an `overflow-hidden` here would freeze the value at the first row; it is dropped.",
        ],
        [
          "Row (`<button>`)",
          '`itemClassName`, `data-active="true"` on the centred row and `"false"` on the rest',
          "`h-full w-full`, so the whole 30px slot is the tap target, and the `touch-action` classes.",
        ],
      ],
    },
    {
      type: "p",
      text: "The row baseline is `flex items-center justify-center text-lg font-medium text-gray-400 tabular-nums transition-colors duration-150 data-[active=true]:text-gray-900`. A native wheel keeps size and weight uniform and marks the centre row by colour alone, so change colours in `itemClassName` and leave size and weight equal across rows.",
    },
    {
      type: "p",
      text: "The drum effect is a `transform` written to each row from JavaScript on every animation frame while the wheel moves: rows tilt 22° per step and recede as they approach the rim. Do not add transform utilities or a transform transition to the rows. The loop stops on the frame the wheel goes idle.",
    },
    {
      type: "p",
      text: "The selection band, separators between columns and any labels (`h`, `min`) are yours to draw. The column ships no band, because its colour and shape belong to the app.",
    },
    { type: "h2", text: "Accessibility" },
    {
      type: "note",
      tone: "warn",
      text: 'There is no keyboard support yet. The column is a labelled `<fieldset>`, but it is not in the tab order and does not handle arrow keys, and the row buttons are `tabIndex={-1}`. A keyboard or switch user cannot change the value. If your app must be operable without a pointer, offer a native `<input type="date">`, `<input type="time">` or `<select>` as an alternative.',
    },
    { type: "h2", text: "Where it works" },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "Mouse wheel, trackpad and clicking a row work, and the value and snap are correct. A mouse cannot drag the wheel, and trackpad momentum is the OS's own, so the feel says little here.",
        },
        {
          target: "Mobile web",
          status: "yes",
          note: "Real touch momentum.",
        },
        { target: "Installed PWA", status: "yes" },
        {
          target: "iOS",
          status: "yes",
          note: "The reference feel. A hard flick should spin the drum a long way; if it moves only a row or two, something has reintroduced scroll-snap.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Chromium's fling is shorter than WebKit's, so the drum coasts less far. That is the platform.",
        },
      ],
    },
  ],
}

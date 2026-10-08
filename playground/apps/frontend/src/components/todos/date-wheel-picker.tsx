import type { WheelItem } from "adaptv/components"
import { View, WHEEL_ITEM_HEIGHT, WheelColumn } from "adaptv/components"
import { useMemo, useRef } from "react"

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

// brand paint for the neutral WheelColumn rows (active row reads as selected)
const WHEEL_ITEM_CLASS = "text-muted data-[active=true]:text-foreground"

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

type DateWheelPickerProps = {
  value: Date
  onChange: (value: Date) => void
}

export function DateWheelPicker({
  value,
  onChange,
}: DateWheelPickerProps) {
  const day = value.getDate()
  const month = value.getMonth()
  const year = value.getFullYear()

  //freeze the year range to the value seeded on mount so an originally-selected
  //past year stays reachable — deriving min/max from the live `year` dropped it
  //off the wheel the moment you scrolled away
  const seededYear = useRef(year)

  const monthItems = useMemo<WheelItem[]>(
    () => MONTH_LABELS.map((label, index) => ({ value: index, label })),
    [],
  )

  const yearItems = useMemo<WheelItem[]>(() => {
    const current = new Date().getFullYear()
    const min = Math.min(current, seededYear.current)
    const max = Math.max(current + 5, seededYear.current)
    const items: WheelItem[] = []
    for (let y = min; y <= max; y++)
      items.push({ value: y, label: `${y}` })
    return items
  }, [])

  const dayItems = useMemo<WheelItem[]>(() => {
    const count = daysInMonth(year, month)
    const items: WheelItem[] = []
    for (let d = 1; d <= count; d++)
      items.push({ value: d, label: `${d}` })
    return items
  }, [year, month])

  //rebuild the date, clamping the day to the chosen month (e.g. Feb 30 -> Feb 28)
  function emit(nextYear: number, nextMonth: number, nextDay: number) {
    const clampedDay = Math.min(nextDay, daysInMonth(nextYear, nextMonth))
    onChange(new Date(nextYear, nextMonth, clampedDay))
  }

  return (
    <View row className="relative flex items-stretch">
      <View
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 z-0 -translate-y-1/2 rounded bg-secondary"
        style={{ height: WHEEL_ITEM_HEIGHT }}
      />
      <WheelColumn
        className="relative flex-[1.1]"
        itemClassName={WHEEL_ITEM_CLASS}
        items={dayItems}
        value={day}
        ariaLabel="Day"
        onChange={(nextDay) => emit(year, month, nextDay)}
      />
      <WheelColumn
        className="relative flex-[1.6]"
        itemClassName={WHEEL_ITEM_CLASS}
        items={monthItems}
        value={month}
        ariaLabel="Month"
        onChange={(nextMonth) => emit(year, nextMonth, day)}
      />
      <WheelColumn
        className="relative flex-[1.2]"
        itemClassName={WHEEL_ITEM_CLASS}
        items={yearItems}
        value={year}
        ariaLabel="Year"
        onChange={(nextYear) => emit(nextYear, month, day)}
      />
    </View>
  )
}

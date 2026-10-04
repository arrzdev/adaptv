import type { WheelItem } from "@arrzdev/adaptv/components"
import {
  View,
  WHEEL_ITEM_HEIGHT,
  WheelColumn,
} from "@arrzdev/adaptv/components"
import { useState } from "react"

function range(count: number): WheelItem[] {
  return Array.from({ length: count }, (_, value) => ({
    value,
    label: String(value).padStart(2, "0"),
  }))
}

const HOURS = range(24)
const MINUTES = range(60)
const ITEM_CLASS = "text-muted data-[active=true]:text-foreground"

export function WheelColumnDemo() {
  const [hour, setHour] = useState(9)
  const [minute, setMinute] = useState(30)

  return (
    <View className="items-center gap-4">
      <View row className="relative w-44 items-stretch">
        <View
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-lg bg-sunken"
          style={{ height: WHEEL_ITEM_HEIGHT }}
        />
        <WheelColumn
          ariaLabel="Hour"
          items={HOURS}
          value={hour}
          onChange={setHour}
          className="relative flex-1"
          itemClassName={ITEM_CLASS}
        />
        <WheelColumn
          ariaLabel="Minute"
          items={MINUTES}
          value={minute}
          onChange={setMinute}
          className="relative flex-1"
          itemClassName={ITEM_CLASS}
        />
      </View>
      <span className="font-mono text-[13px] text-muted">
        value: {String(hour).padStart(2, "0")}:{String(minute).padStart(2, "0")}
      </span>
    </View>
  )
}

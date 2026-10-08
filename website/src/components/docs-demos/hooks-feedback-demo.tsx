import { View } from "adaptv/components"
import type { GestureState } from "adaptv/hooks"
import { useGestureEngine } from "adaptv/hooks"
import { useState } from "react"

export function HooksFeedbackDemo() {
  const [state, setState] = useState<GestureState>("idle")
  const [last, setLast] = useState("nothing yet")

  const handlers = useGestureEngine({
    onPressUp: () => setLast("tap"),
    onLongPressDown: () => setLast("long press"),
    onStateChange: setState,
  })

  return (
    <View className="items-center gap-3">
      <button
        {...handlers}
        type="button"
        className="flex h-24 w-56 cursor-pointer touch-manipulation select-none items-center justify-center rounded-xl border border-border-strong bg-surface font-mono text-[13px] text-foreground transition-transform active:scale-95 active:bg-sunken"
      >
        {state}
      </button>
      <span className="font-mono text-[13px] text-muted">last: {last}</span>
      <span className="text-[13px] text-subtle">
        Tap it, hold it, or press and drag out and back in.
      </span>
    </View>
  )
}

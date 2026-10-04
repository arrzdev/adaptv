import { Pressable, View } from "@arrzdev/adaptv/components"
import { useState } from "react"

export function PressableDemo() {
  const [presses, setPresses] = useState(0)
  return (
    <View className="w-full max-w-xs items-center gap-3">
      <Pressable
        onPress={() => setPresses((count) => count + 1)}
        className="flex w-full flex-col gap-1 rounded-2xl border border-border bg-raised p-4 transition-transform active:scale-95 active:bg-sunken"
      >
        <span className="font-medium text-[15px] text-foreground">
          Press and hold
        </span>
        <span className="text-[13px] text-subtle">
          Drag off the card and back on. Release inside to fire onPress.
        </span>
      </Pressable>
      <span className="font-mono text-[13px] text-muted">
        onPress: {presses}
      </span>
    </View>
  )
}

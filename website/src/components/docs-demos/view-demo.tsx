import { View } from "@arrzdev/adaptv/components"

const TILE =
  "rounded-lg border border-border bg-raised px-3 py-2 font-mono text-[13px] text-foreground"

export function ViewDemo() {
  return (
    <View className="w-full max-w-sm gap-4">
      <View className="gap-2">
        <span className={TILE}>column</span>
        <span className={TILE}>is the default</span>
      </View>
      <View row className="gap-2">
        <span className={TILE}>row</span>
        <span className={TILE}>side</span>
        <span className={TILE}>by side</span>
      </View>
      <View
        center
        className="h-20 rounded-lg border border-border-strong border-dashed font-mono text-[13px] text-muted"
      >
        center
      </View>
    </View>
  )
}

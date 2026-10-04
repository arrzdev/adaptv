import { Switch, View } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import { useState } from "react"

export function SwitchDemo() {
  const [checked, setChecked] = useState(true)
  return (
    <View row className="items-center gap-4">
      <Switch
        size={7}
        aria-label="Notifications"
        checked={checked}
        onCheckedChange={setChecked}
        className={cn(
          "rounded-full bg-border-strong transition-colors",
          checked && "bg-success",
        )}
      >
        <Switch.Thumb className="rounded-full bg-white shadow-sm" />
      </Switch>
      <span className="font-mono text-[13px] text-muted">
        checked: {String(checked)}
      </span>
    </View>
  )
}

import { Checkbox, useCheckbox, View } from "@arrzdev/adaptv/components"
import { useState } from "react"
import { cn } from "@/utils/cn"

function Box() {
  const { isChecked, isIndeterminate } = useCheckbox()
  const filled = isChecked || isIndeterminate
  return (
    <Checkbox.Box
      className={cn(
        "rounded-md transition-colors",
        filled
          ? "bg-brand"
          : "bg-surface outline outline-1 -outline-offset-1 outline-border-strong",
      )}
    >
      <Checkbox.Icon className="text-white" />
      {isIndeterminate && (
        <span className="absolute h-0.5 w-2.5 rounded-full bg-white" />
      )}
    </Checkbox.Box>
  )
}
Box.displayName = "Checkbox.Box"

const TOPPINGS = ["Mushrooms", "Olives", "Basil"] as const

export function CheckboxDemo() {
  const [picked, setPicked] = useState<readonly string[]>(["Olives"])
  const all = picked.length === TOPPINGS.length
  const some = picked.length > 0 && !all

  return (
    <View className="gap-3">
      <View row className="items-center gap-3">
        <Checkbox
          size={6}
          aria-label="All toppings"
          checked={all}
          indeterminate={some}
          onCheckedChange={(next) => setPicked(next ? TOPPINGS : [])}
        >
          <Box />
        </Checkbox>
        <span className="text-[14px] font-medium text-foreground">
          All toppings
        </span>
      </View>
      {TOPPINGS.map((topping) => (
        <View key={topping} row className="items-center gap-3 ps-6">
          <Checkbox
            size={6}
            aria-label={topping}
            checked={picked.includes(topping)}
            onCheckedChange={(next) =>
              setPicked((current) =>
                next
                  ? [...current, topping]
                  : current.filter((item) => item !== topping),
              )
            }
          >
            <Box />
          </Checkbox>
          <span className="text-[14px] text-subtle">{topping}</span>
        </View>
      ))}
    </View>
  )
}

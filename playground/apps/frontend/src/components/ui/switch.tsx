import type { SwitchHandle, SwitchProps } from "@arrzdev/adaptv/components"
import {
  Switch as BaseSwitch,
  useSwitch,
} from "@arrzdev/adaptv/components"
import { forwardRef } from "react"
import { useHaptics } from "@/hooks/use-haptics"
import { cn } from "@/utils/cn"

function SwitchThumb() {
  const { isDisabled } = useSwitch()

  return (
    <BaseSwitch.Thumb
      className={cn(
        "rounded-full bg-surface shadow-sm",
        isDisabled && "opacity-50",
      )}
    />
  )
}
SwitchThumb.displayName = "Switch.Thumb"

export const Switch = forwardRef<SwitchHandle, SwitchProps>(
  function Switch({ checked, className, onCheckedChange, ...props }, ref) {
    const haptic = useHaptics()
    return (
      <BaseSwitch
        ref={ref}
        checked={checked}
        className={cn(
          "rounded-full bg-secondary transition-colors",
          checked && "bg-primary",
          className,
        )}
        onCheckedChange={(next) => {
          haptic.selection()
          onCheckedChange?.(next)
        }}
        {...props}
      >
        <SwitchThumb />
      </BaseSwitch>
    )
  },
)

import type {
  CheckboxHandle,
  CheckboxProps,
} from "@arrzdev/adaptv/components"
import {
  Checkbox as BaseCheckbox,
  useCheckbox,
} from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import { forwardRef } from "react"

function CheckboxBox() {
  const { isChecked, isIndeterminate, isDisabled } = useCheckbox()

  return (
    <BaseCheckbox.Box
      className={cn(
        "rounded-sm",
        //checked (interactive or the archived locked box): a solid orange fill,
        //no ring — a ring-inset over the fill reads as a shiny border
        isChecked && "bg-primary",
        //empty / indeterminate boxes keep a ring so they're visible
        !isChecked && "ring-1 ring-inset",
        !isChecked &&
          isDisabled &&
          "ring-border-subtle bg-secondary opacity-50",
        !isChecked &&
          !isDisabled &&
          isIndeterminate &&
          "ring-border-strong bg-secondary",
        !isChecked &&
          !isDisabled &&
          !isIndeterminate &&
          "ring-border bg-surface",
      )}
    >
      <CheckboxIcon />
    </BaseCheckbox.Box>
  )
}
CheckboxBox.displayName = "Checkbox.Box"

function CheckboxIcon() {
  const { isChecked, isIndeterminate } = useCheckbox()

  return (
    <BaseCheckbox.Icon
      className={cn(
        (isChecked || isIndeterminate) && "text-primary-foreground",
      )}
    />
  )
}
CheckboxIcon.displayName = "Checkbox.Icon"

export const Checkbox = forwardRef<CheckboxHandle, CheckboxProps>(
  function Checkbox({ className, ...props }, ref) {
    return (
      <BaseCheckbox ref={ref} className={className} {...props}>
        <CheckboxBox />
      </BaseCheckbox>
    )
  },
)

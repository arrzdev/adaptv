import { Text, View } from "@arrzdev/adaptv/components"
import type { ReactNode } from "react"
import { secondaryButtonClassName } from "@/components/ui/secondary-button"
import { cn } from "@/utils/cn"

//the identical full-width secondary-button sizing every drawer's Cancel carries.
//exported so callers can style their own Close/button node (AppDrawer.Close vs a
//raw <button>) without re-typing the class string.
export const drawerCancelClassName = cn(
  secondaryButtonClassName,
  "w-full py-3.5 text-base font-semibold leading-none",
)

type DrawerActionFooterProps = {
  /** Primary/hold action, injected so PrimaryButton vs HoldToConfirmButton stays caller-controlled. */
  action: ReactNode
  /** Cancel affordance (an `AppDrawer.Close` or raw `<button>`). Omit when there's no cancel. */
  cancel?: ReactNode
  /** One-line error text; the slot is always reserved so an error can't shift the buttons. */
  errorMessage?: string
  className?: string
}

//the shared footer body for the form/confirm drawers: a fixed-height error slot
//above a caller-supplied action button and optional Cancel. only the genuinely
//identical parts (the reserved alert slot + the column wrapper) live here; the
//buttons themselves stay injected so their diverging state (disabled, busy,
//vibrate, Close vs raw) belongs to the caller.
export function DrawerActionFooter({
  action,
  cancel,
  errorMessage,
  className,
}: DrawerActionFooterProps) {
  return (
    <View className={cn("flex w-full flex-col gap-y-3", className)}>
      {/* reserved one-line slot — always present so an error can't shift the buttons */}
      <Text
        render={<p />}
        role="alert"
        className="min-h-5 whitespace-pre-line text-sm text-error"
      >
        {errorMessage}
      </Text>
      {action}
      {cancel}
    </View>
  )
}

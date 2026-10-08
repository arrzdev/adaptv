import type { ButtonHandle } from "adaptv/components"
import { Button as BaseButton } from "adaptv/components"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { forwardRef } from "react"
import { useHaptics } from "@/hooks/use-haptics"
import { cn } from "@/utils/cn"

export const ICON_BUTTON_CLASSNAME = cn(
  "inline-flex size-11 shrink-0 items-center justify-center rounded-full border-0 bg-secondary text-foreground",
  "hover:bg-border-strong",
  "focus:outline-none",
  //micro tier — small icon target gets a firmer squeeze than a full-size button
  "origin-center transition-transform duration-200 ease-out active:duration-0 active:scale-95",
  "disabled:opacity-50",
)

type IconButtonProps = Omit<
  ComponentPropsWithRef<typeof BaseButton>,
  "children"
> & {
  children: ReactNode
  "aria-label": string
}

export const IconButton = forwardRef<ButtonHandle, IconButtonProps>(
  function IconButton({ children, className, onClick, ...props }, ref) {
    const haptic = useHaptics()
    return (
      <BaseButton
        ref={ref}
        className={cn(ICON_BUTTON_CLASSNAME, className)}
        onClick={(event) => {
          haptic.impact("light")
          onClick?.(event)
        }}
        {...props}
      >
        <BaseButton.Text className="inline-flex items-center justify-center">
          {children}
        </BaseButton.Text>
      </BaseButton>
    )
  },
)

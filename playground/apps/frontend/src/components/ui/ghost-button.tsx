import type { ButtonHandle } from "adaptv/components"
import { Button as BaseButton } from "adaptv/components"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { forwardRef } from "react"
import { useHaptics } from "@/hooks/use-haptics"
import { cn } from "@/utils/cn"

const GHOST_BUTTON_CLASSNAME = cn(
  "rounded-full border-0 bg-transparent px-4 py-2 text-sm font-medium text-muted",
  "hover:bg-secondary hover:text-foreground",
  "focus:outline-none",
  "origin-center transition-transform duration-200 ease-out active:duration-0 active:scale-[0.98]",
  "disabled:opacity-50",
)

type GhostButtonProps = Omit<
  ComponentPropsWithRef<typeof BaseButton>,
  "children"
> & {
  children: ReactNode
}

export const GhostButton = forwardRef<ButtonHandle, GhostButtonProps>(
  function GhostButton({ children, className, onClick, ...props }, ref) {
    const haptic = useHaptics()
    return (
      <BaseButton
        ref={ref}
        className={cn(GHOST_BUTTON_CLASSNAME, className)}
        onClick={(event) => {
          haptic.impact("light")
          onClick?.(event)
        }}
        {...props}
      >
        <BaseButton.Text>{children}</BaseButton.Text>
      </BaseButton>
    )
  },
)

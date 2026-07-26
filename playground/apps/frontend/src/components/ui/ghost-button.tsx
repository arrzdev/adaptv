import type { ButtonHandle } from "@arrzdev/adaptv/components"
import { Button as BaseButton } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { forwardRef } from "react"

const GHOST_BUTTON_CLASSNAME = cn(
  "rounded-full border-0 bg-transparent px-4 py-2 text-sm font-medium text-muted",
  "hover:bg-secondary hover:text-foreground",
  "focus:outline-none",
  "origin-center transition-transform duration-200 ease-out pressed:duration-0 pressed:scale-[0.98]",
  "disabled:opacity-50",
)

type GhostButtonProps = Omit<
  ComponentPropsWithRef<typeof BaseButton>,
  "children"
> & {
  children: ReactNode
}

export const GhostButton = forwardRef<ButtonHandle, GhostButtonProps>(
  function GhostButton({ children, className, ...props }, ref) {
    return (
      <BaseButton
        ref={ref}
        className={cn(GHOST_BUTTON_CLASSNAME, className)}
        {...props}
      >
        <BaseButton.Text>{children}</BaseButton.Text>
      </BaseButton>
    )
  },
)

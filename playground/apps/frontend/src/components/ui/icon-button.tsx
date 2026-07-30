import type { ButtonHandle } from "@arrzdev/adaptv/components"
import { Button as BaseButton } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { forwardRef } from "react"

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
  function IconButton({ children, className, ...props }, ref) {
    return (
      <BaseButton
        ref={ref}
        className={cn(ICON_BUTTON_CLASSNAME, className)}
        {...props}
      >
        <BaseButton.Text className="inline-flex items-center justify-center">
          {children}
        </BaseButton.Text>
      </BaseButton>
    )
  },
)

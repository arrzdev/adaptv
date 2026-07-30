import type { ButtonHandle } from "@arrzdev/adaptv/components"
import { Button as BaseButton } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { Children, forwardRef, isValidElement } from "react"
import { ButtonSpinner } from "@/components/ui/button-spinner"

const PRIMARY_BUTTON_CLASSNAME = cn(
  "rounded-md border-0 bg-primary px-4 py-2 text-sm font-medium leading-none text-primary-foreground",
  "hover:bg-accent",
  "focus:outline-none",
  "origin-center transition-transform duration-200 ease-out active:duration-0 active:scale-[0.98]",
  "disabled:opacity-50",
  "aria-busy:bg-secondary aria-busy:text-muted aria-busy:saturate-50 aria-busy:opacity-70 aria-busy:hover:bg-secondary",
)

type PrimaryButtonProps = Omit<
  ComponentPropsWithRef<typeof BaseButton>,
  "children"
> & {
  children: ReactNode
  loading?: boolean
}

const BUTTON_COMPOUND_DISPLAY_NAMES = new Set([
  "Button.Leading",
  "Button.Trailing",
  "Button.Text",
])

function primaryButtonUsesCompoundSlots(children: ReactNode): boolean {
  let usesCompound = false
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    const type = child.type as { displayName?: string }
    if (BUTTON_COMPOUND_DISPLAY_NAMES.has(type.displayName ?? "")) {
      usesCompound = true
    }
  })
  return usesCompound
}

function normalizePrimaryButtonChildren(children: ReactNode): ReactNode {
  if (primaryButtonUsesCompoundSlots(children)) return children
  return <BaseButton.Text>{children}</BaseButton.Text>
}

export const PrimaryButton = forwardRef<ButtonHandle, PrimaryButtonProps>(
  function PrimaryButton(
    { children, className, disabled, loading = false, ...props },
    ref,
  ) {
    return (
      <BaseButton
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(PRIMARY_BUTTON_CLASSNAME, className)}
        {...props}
      >
        {normalizePrimaryButtonChildren(children)}
        {loading && (
          <BaseButton.Trailing className="ps-2">
            <ButtonSpinner />
          </BaseButton.Trailing>
        )}
      </BaseButton>
    )
  },
)

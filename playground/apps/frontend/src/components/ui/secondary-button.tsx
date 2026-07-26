import type { ButtonHandle } from "@arrzdev/adaptv/components"
import { Button as BaseButton } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { forwardRef } from "react"
import { ButtonSpinner } from "@/components/ui/button-spinner"

export const secondaryButtonClassName = cn(
  "rounded-md ring-1 ring-inset ring-border bg-surface px-4 py-2 text-sm font-medium text-foreground",
  "hover:bg-secondary",
  "focus:outline-none",
  "origin-center transition-transform duration-200 ease-out pressed:duration-0 pressed:scale-[0.98]",
  "disabled:opacity-50",
  "aria-busy:bg-secondary aria-busy:text-muted aria-busy:saturate-50 aria-busy:opacity-70 aria-busy:ring-border-subtle aria-busy:hover:bg-secondary",
)

type SecondaryButtonProps = Omit<
  ComponentPropsWithRef<typeof BaseButton>,
  "children"
> & {
  children: ReactNode
  loading?: boolean
}

export const SecondaryButton = forwardRef<
  ButtonHandle,
  SecondaryButtonProps
>(function SecondaryButton(
  { children, className, disabled, loading = false, ...props },
  ref,
) {
  return (
    <BaseButton
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(secondaryButtonClassName, className)}
      {...props}
    >
      <BaseButton.Text>{children}</BaseButton.Text>
      {loading && (
        <BaseButton.Trailing className="ps-2">
          <ButtonSpinner />
        </BaseButton.Trailing>
      )}
    </BaseButton>
  )
})

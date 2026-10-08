import type { ButtonHandle } from "adaptv/components"
import { Button as BaseButton } from "adaptv/components"
import type { ComponentPropsWithRef, ReactNode } from "react"
import { forwardRef } from "react"
import { ButtonSpinner } from "@/components/ui/button-spinner"
import { useHaptics } from "@/hooks/use-haptics"
import { cn } from "@/utils/cn"

export const secondaryButtonClassName = cn(
  "rounded-md ring-1 ring-inset ring-border bg-surface px-4 py-2 text-sm font-medium text-foreground",
  "hover:bg-secondary",
  "focus:outline-none",
  "origin-center transition-transform duration-200 ease-out active:duration-0 active:scale-[0.98]",
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
  { children, className, disabled, loading = false, onClick, ...props },
  ref,
) {
  const haptic = useHaptics()
  return (
    <BaseButton
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(secondaryButtonClassName, className)}
      onClick={(event) => {
        haptic.impact("light")
        onClick?.(event)
      }}
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

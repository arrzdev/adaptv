import type { TextAreaHandle } from "adaptv/components"
import { TextArea as BaseTextArea } from "adaptv/components"
import { forwardRef } from "react"
import { cn } from "@/utils/cn"

//no min-h — the base primitive's `rows` floor owns the empty height
const TEXT_AREA_CLASSNAME = cn(
  "block w-full rounded-2xl px-4 py-3 text-base ring-1 ring-inset ring-border bg-surface transition-[box-shadow]",
  "focus-within:outline-none focus-within:ring-primary",
  "placeholder:text-muted caret-foreground text-foreground",
)

type TextAreaProps = {
  value: string
  onChange: (value: string) => void
  onSubmitKey?: () => void
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  className?: string
  name?: string
  /** Minimum rows while auto-growing (base default: 4). */
  rows?: number
  /**
   * Grow with the content (base default: true). `false` fills the height of a
   * sized parent and scrolls inside it, and `rows` no longer applies.
   */
  autoResize?: boolean
  "aria-label"?: string
}

export const TextArea = forwardRef<TextAreaHandle, TextAreaProps>(
  function TextArea(
    {
      value,
      onChange,
      onSubmitKey,
      placeholder,
      disabled,
      autoFocus,
      className,
      name,
      rows,
      autoResize,
      "aria-label": ariaLabel,
    },
    ref,
  ) {
    return (
      <BaseTextArea
        ref={ref}
        name={name}
        rows={rows}
        autoResize={autoResize}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onSubmitKey={onSubmitKey}
        className={cn(
          TEXT_AREA_CLASSNAME,
          disabled && "ring-border-subtle bg-secondary opacity-50",
          className,
        )}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  },
)

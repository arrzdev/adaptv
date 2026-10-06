import type { InputHandle } from "@arrzdev/adaptv/components"
import { Input as BaseInput } from "@arrzdev/adaptv/components"
import type { KeyboardEvent } from "react"
import { forwardRef, useId } from "react"
import { cn } from "@/utils/cn"

const TEXT_INPUT_SHELL_CLASSNAME = cn(
  "block rounded-md ring-1 ring-inset ring-border bg-surface transition-[box-shadow]",
  "focus-within:outline-none focus-within:ring-primary",
)

const TEXT_INPUT_FIELD_CLASSNAME = cn(
  "w-full min-w-0 border-0 bg-transparent px-3 py-2 text-base text-foreground shadow-none ring-0 outline-none",
  "placeholder:text-muted caret-foreground",
)

type TextInputProps = {
  value: string
  onChange: (value: string) => void
  /** Enter without Shift — desktop only (touch keyboards use `onKeyDown`). */
  onSubmit?: () => void
  /** Raw keydown passthrough; fires on desktop AND touch (unlike `onSubmit`). */
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  fieldClassName?: string
  name?: string
  /** Native input type — text | email | password (default text). */
  type?: "text" | "email" | "password"
  /** Native autocomplete hint (e.g. "email", "current-password"). */
  autoComplete?: string
  /** Software-keyboard action-key label (e.g. "next", "go"). */
  enterKeyHint?:
    | "enter"
    | "done"
    | "go"
    | "next"
    | "previous"
    | "search"
    | "send"
  /** Focus the field when it mounts (fires inside the drawer portal — no open-timing race). */
  autoFocus?: boolean
  "aria-label"?: string
}

export const TextInput = forwardRef<InputHandle, TextInputProps>(
  function TextInput(
    {
      value,
      onChange,
      onSubmit,
      onKeyDown,
      placeholder,
      disabled,
      className,
      fieldClassName,
      name,
      type = "text",
      autoComplete,
      enterKeyHint,
      autoFocus,
      "aria-label": ariaLabel,
    },
    ref,
  ) {
    const inputId = useId()

    return (
      <label
        htmlFor={inputId}
        className={cn(
          TEXT_INPUT_SHELL_CLASSNAME,
          disabled && "ring-border-subtle bg-secondary opacity-50",
          className,
        )}
      >
        <BaseInput
          ref={ref}
          id={inputId}
          name={name}
          type={type}
          autoComplete={autoComplete}
          enterKeyHint={enterKeyHint}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          autoFocus={autoFocus}
          // Marks this field for the drawer engine to re-focus on a fast reopen, where the
          // panel is reused and React's mount-only autoFocus never re-fires.
          data-autofocus={autoFocus || undefined}
          aria-label={ariaLabel}
          className={cn(TEXT_INPUT_FIELD_CLASSNAME, fieldClassName)}
          onChange={(e) => onChange(e.target.value)}
          onSubmitKey={onSubmit}
          onKeyDown={onKeyDown}
        />
      </label>
    )
  },
)

import type {
  ComponentProps,
  FocusEvent,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
} from "react"
import {
  Children,
  createContext,
  forwardRef,
  useContext,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react"
import { PRESS_TARGET_DISABLED_LOCKED_CLASS } from "#adaptv/components/press-core"
import { isTouchDevice } from "#adaptv/utils/is-touch-device"
import { mergeStyles } from "#adaptv/utils/styles"

/* =============================================================================
 * TYPES
 * ============================================================================= */

/**
 * Imperative API for {@link Input}. Attach with `ref`.
 *
 * | Member | Description |
 * |--------|-------------|
 * | `value` | Live field value (readonly) |
 * | `disabled` | Live disabled state (readonly) |
 * | `grouped` | `true` when compound slot children are present (readonly) |
 * | `focus()` | Focus the underlying `<input>` |
 * | `clear()` | Clear value and dispatch native `input`/`change` |
 */
export type InputHandle = {
  readonly value: string
  readonly disabled: boolean
  readonly grouped: boolean
  focus: () => void
  clear: () => void
}

/** Shared props for {@link Input.Leading} and {@link Input.Trailing}. */
export interface InputSlotProps {
  /** Icon, control, or label content in the slot. */
  children: ReactNode
  /** Tier 2 gutter/sizing (`pe-*`, `ps-*`, fixed widths, etc.). */
  className?: string
}

/** Props for `Input.Leading`. Place before trailing slots in JSX order. */
export type InputLeadingProps = InputSlotProps

/** Props for `Input.Trailing`. Place after leading slots in JSX order. */
export type InputTrailingProps = InputSlotProps

/**
 * Single-line text field. Forwards native `<input>` props (`value`, `defaultValue`,
 * `onChange`, `disabled`, `name`, `aria-*`, etc.).
 *
 * **Controlled** — `value` + `onChange`. **Uncontrolled** — `defaultValue`.
 *
 * With {@link Input.Leading} / {@link Input.Trailing} children, `className`
 * styles the group `<label>`; tokens like `placeholder:` route to the inner
 * `<input>`. Without slots, the full `className` merges onto the `<input>`.
 */
export type InputProps = Omit<
  ComponentProps<"input">,
  "onKeyDown" | "onBlur"
> & {
  /** {@link Input.Leading} / {@link Input.Trailing} slots; presence switches to grouped layout. */
  children?: ReactNode
  /** Called on Enter without Shift (desktop only; ignored on touch devices). */
  onSubmitKey?: () => void
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  onBlur?: (e: FocusEvent<HTMLInputElement>) => void
}

interface InputFieldProps extends Omit<InputProps, "children"> {
  grouped?: boolean
  inputId: string
  /** The `placeholder:` / `caret:` half of {@link partitionInputClassName}. */
  innerClassName?: string
}

interface InputGroupProps {
  children: ReactNode
  className?: string
  inputId: string
  disabled?: boolean
}

/* =============================================================================
 * CLASSES
 * ============================================================================= */

//LOCKED on the slots: `order-*` IS the compound contract. Children render in
//document order and the field is injected with `order-2`, so leading → field →
//trailing only holds while these stick; `shrink-0` keeps an icon from collapsing
//when the label runs out of room. Alignment is a default.
const INPUT_SLOT_LOCKED_LAYOUT_CLASS = "inline-flex shrink-0"
const INPUT_SLOT_BASE_LAYOUT_CLASS = "items-center self-center"
const INPUT_LEADING_LOCKED_ORDER_CLASS = "order-1"
const INPUT_TRAILING_LOCKED_ORDER_CLASS = "order-3"
const INPUT_GROUP_LAYOUT_CLASS = "flex items-center w-fit min-w-0"
const INPUT_GROUP_INTERACTION_CLASS = "cursor-text"
const INPUT_GROUP_NON_INTERACTION_CLASS =
  PRESS_TARGET_DISABLED_LOCKED_CLASS
const INPUT_GROUP_DISABLED_CURSOR_CLASS = "cursor-not-allowed"
//⚠︎ No default border width — see the note in button.tsx. Pre-allocating one only
//cancels the shift at exactly 1px and permanently shrinks the content box; use
//`outline` for toggled emphasis instead.
const INPUT_GROUP_SURFACE_CLASS = "bg-gray-50 text-gray-950"
const INPUT_FIELD_RESIZE_CLASS = "resize-none"
const INPUT_FIELD_INTERACTION_CLASS = "cursor-text"
const INPUT_FIELD_NON_INTERACTION_CLASS =
  PRESS_TARGET_DISABLED_LOCKED_CLASS
const INPUT_FIELD_DISABLED_CURSOR_CLASS = "cursor-not-allowed"
const INPUT_FIELD_SURFACE_CLASS = "bg-gray-50 text-gray-950"
//LOCKED when grouped: this is what makes the field a chromeless participant in the
//label's flex row rather than a second visible box inside the first. `order-2` is
//the slot contract above; `flex-1 min-w-0` is what lets it give way to the slots;
//the chrome-strippers are why the group's own surface is the only visible one.
const INPUT_FIELD_GROUPED_CHROMELESS_CLASS =
  "order-2 min-w-0 flex-1 border-none bg-transparent p-0 shadow-none text-inherit"

/* =============================================================================
 * CONTEXT
 * ============================================================================= */

/** Programmatic state Tier 2 reads via {@link useInput}. */
export type InputContextValue = {
  isGrouped: boolean
  isDisabled: boolean
}

const InputContext = createContext<InputContextValue | null>(null)

/**
 * Reactive layout state for grouped {@link Input} trees.
 * Use in Tier 2 wrappers and slot sub-parts — branch with `isGrouped` /
 * `isDisabled`, not `has-[:disabled]:` or `group-*` selectors.
 */
export function useInput(): InputContextValue {
  const ctx = useContext(InputContext)
  if (ctx === null) {
    throw new Error("useInput must be used within <Input>.")
  }
  return ctx
}

/* =============================================================================
 * SLOT HELPERS
 * ============================================================================= */

function inputSlotHasContent(children: ReactNode): boolean {
  let hasContent = false
  Children.forEach(children, (child) => {
    if (child == null || child === false) return
    if (typeof child === "string") {
      if (child.trim().length > 0) hasContent = true
      return
    }
    if (typeof child === "number") {
      hasContent = true
      return
    }
    hasContent = true
  })
  return hasContent
}

function inputHasCompoundChildren(children: ReactNode): boolean {
  if (children == null || children === false) return false
  let hasChild = false
  Children.forEach(children, (child) => {
    if (child == null || child === false) return
    hasChild = true
  })
  return hasChild
}

/* =============================================================================
 * CLASSNAME PARTITIONING
 * ============================================================================= */

const INPUT_FIELD_CLASS_PREFIXES = ["placeholder:", "caret:"] as const

function isInputFieldClassToken(token: string) {
  return INPUT_FIELD_CLASS_PREFIXES.some((prefix) =>
    token.startsWith(prefix),
  )
}

/** Shell vs inner `<input>` split when addon grouping is active. */
function partitionInputClassName(className?: string) {
  if (!className) {
    return { shellClassName: undefined, innerClassName: undefined }
  }

  const shellTokens: string[] = []
  const innerTokens: string[] = []

  for (const token of className.trim().split(/\s+/)) {
    if (!token) continue
    if (isInputFieldClassToken(token)) innerTokens.push(token)
    else shellTokens.push(token)
  }

  return {
    shellClassName:
      shellTokens.length > 0 ? shellTokens.join(" ") : undefined,
    innerClassName:
      innerTokens.length > 0 ? innerTokens.join(" ") : undefined,
  }
}

const INPUT_ADDON_INTERACTIVE_SELECTOR =
  "button, a, input, select, textarea, [role='button']"

/* =============================================================================
 * INPUT LEADING / TRAILING
 * ============================================================================= */

/**
 * Leading icon or control slot. Place before {@link Input.Trailing} in JSX order.
 *
 * Renders nothing when `children` is empty. Prefer conditional mount when the
 * whole slot is optional.
 *
 * Clicks on interactive addon content do not steal focus from the field.
 *
 * **Padding model** — `Input` `className` (`px-*`, `py-*`) insets slots from the
 * group border. Space beside the editable area is owned here (`pe-*`) or via
 * `gap-*` on the group — not both unless intentional.
 *
 * @example
 * ```tsx
 * <Input className="w-full px-3">
 *   <Input.Leading className="pe-2">
 *     <SearchIcon />
 *   </Input.Leading>
 * </Input>
 * ```
 */
function InputLeading({ children, className }: InputLeadingProps) {
  useInput()
  if (!inputSlotHasContent(children)) return null

  function handleMouseDownCapture(e: MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (!target.closest(INPUT_ADDON_INTERACTIVE_SELECTOR)) return
    e.preventDefault()
  }

  return (
    <div
      className={mergeStyles({
        base: INPUT_SLOT_BASE_LAYOUT_CLASS,
        className,
        locked: [
          INPUT_SLOT_LOCKED_LAYOUT_CLASS,
          INPUT_LEADING_LOCKED_ORDER_CLASS,
        ],
      })}
      onMouseDownCapture={handleMouseDownCapture}
    >
      {children}
    </div>
  )
}

InputLeading.displayName = "Input.Leading"

/**
 * Trailing icon or control slot. Place after {@link Input.Leading} in JSX order.
 *
 * See {@link InputLeading} for empty-child behavior and spacing guidance.
 *
 * @example
 * ```tsx
 * <Input className="w-full px-3">
 *   <Input.Leading className="pe-2">
 *     <SearchIcon />
 *   </Input.Leading>
 *   {canClear && (
 *     <Input.Trailing className="ps-2">
 *       <ClearButton />
 *     </Input.Trailing>
 *   )}
 * </Input>
 * ```
 */
function InputTrailing({ children, className }: InputTrailingProps) {
  useInput()
  if (!inputSlotHasContent(children)) return null

  function handleMouseDownCapture(e: MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (!target.closest(INPUT_ADDON_INTERACTIVE_SELECTOR)) return
    e.preventDefault()
  }

  return (
    <div
      className={mergeStyles({
        base: INPUT_SLOT_BASE_LAYOUT_CLASS,
        className,
        locked: [
          INPUT_SLOT_LOCKED_LAYOUT_CLASS,
          INPUT_TRAILING_LOCKED_ORDER_CLASS,
        ],
      })}
      onMouseDownCapture={handleMouseDownCapture}
    >
      {children}
    </div>
  )
}

InputTrailing.displayName = "Input.Trailing"

/* =============================================================================
 * INPUT GROUP
 * ============================================================================= */

function InputGroup({
  children,
  className,
  inputId,
  disabled,
}: InputGroupProps) {
  function handleMouseDown(e: MouseEvent<HTMLLabelElement>) {
    const field = document.getElementById(inputId)
    if (!(field instanceof HTMLInputElement)) return
    if (document.activeElement !== field) return
    const target = e.target as HTMLElement
    if (field === target || field.contains(target)) return
    if (target.closest(INPUT_ADDON_INTERACTIVE_SELECTOR)) return
    e.preventDefault()
  }

  return (
    <label
      data-adaptv="input"
      htmlFor={inputId}
      //LOCKED: `non-clickable` when disabled — a disabled field that still accepts
      //a tap (and still shows a text caret) is a bug, not a style. `cursor-text`
      //when enabled is only a cursor, so it stays base and a consumer can change it.
      className={mergeStyles({
        base: [
          INPUT_GROUP_LAYOUT_CLASS,
          INPUT_GROUP_SURFACE_CLASS,
          !disabled && INPUT_GROUP_INTERACTION_CLASS,
          disabled && INPUT_GROUP_DISABLED_CURSOR_CLASS,
        ],
        className,
        locked: disabled && INPUT_GROUP_NON_INTERACTION_CLASS,
      })}
      onMouseDown={handleMouseDown}
    >
      {children}
    </label>
  )
}

InputGroup.displayName = "InputGroup"

/* =============================================================================
 * INPUT FIELD
 * ============================================================================= */

const InputField = forwardRef<HTMLInputElement, InputFieldProps>(
  function InputField(
    {
      className,
      innerClassName,
      disabled,
      grouped = false,
      onSubmitKey,
      onKeyDown,
      onBlur,
      size,
      type,
      inputId,
      ...props
    },
    ref,
  ) {
    function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
      if (
        onSubmitKey &&
        e.key === "Enter" &&
        !e.shiftKey &&
        !isTouchDevice()
      ) {
        e.preventDefault()
        e.stopPropagation()
        onSubmitKey()
      }
      onKeyDown?.(e)
    }

    return (
      <input
        ref={ref}
        id={inputId}
        type={type}
        size={grouped ? size : (size ?? 20)}
        //Grouped, the chromeless class is LOCKED: it is what makes this field a
        //participant in the label's flex row (`order-2 flex-1 min-w-0`) instead of
        //a second visible box inside the first, and the consumer already has the
        //group shell for exactly the chrome it strips. Ungrouped there is no shell,
        //so the same surface is a plain BASE the consumer restyles freely.
        className={mergeStyles({
          base: [
            INPUT_FIELD_RESIZE_CLASS,
            !grouped && INPUT_FIELD_SURFACE_CLASS,
            !grouped && !disabled && INPUT_FIELD_INTERACTION_CLASS,
            !grouped && disabled && INPUT_FIELD_DISABLED_CURSOR_CLASS,
          ],
          className: grouped
            ? innerClassName
            : [className, innerClassName],
          locked: [
            grouped && INPUT_FIELD_GROUPED_CHROMELESS_CLASS,
            disabled && INPUT_FIELD_NON_INTERACTION_CLASS,
          ],
        })}
        onKeyDown={handleKeyDown}
        onBlur={onBlur}
        {...props}
        disabled={disabled}
      />
    )
  },
)

InputField.displayName = "InputField"

function dispatchFieldValueEvents(field: HTMLInputElement) {
  field.dispatchEvent(new Event("input", { bubbles: true }))
  field.dispatchEvent(new Event("change", { bubbles: true }))
}

/* =============================================================================
 * ROOT
 * ============================================================================= */

/**
 * Text field: bare `<input>` when alone; labeled flex group when
 * {@link Input.Leading} / {@link Input.Trailing} children exist. Slot children
 * render in document order; the field is injected with `order-2` so visual order
 * is leading → field → trailing.
 *
 * **With slots** — `className` styles the group `<label>` (`placeholder:` and
 * `caret:` tokens route to the inner `<input>`). Use `focus-within:` on the
 * shell, `disabled` via props + `disabled &&` in Tier 2 `cn()` — not
 * `has-[:disabled]:`. Use `useInput().isGrouped` in Tier 2 sub-parts; never
 * scan `children`.
 *
 * Shell `px-*` / `py-*` inset slots from the border; use slot `pe-*` / `ps-*`
 * (or group `gap-*`) for gutters beside the text. Pass `w-full` or another fixed
 * width on the root when slot mount/unmount should not resize the control.
 *
 * **Bare** — full `className` merges onto the `<input>`.
 *
 * **Imperative handle** (`ref`)
 * - `ref.current.value` — live field value (readonly).
 * - `ref.current.disabled` — reflects the live disabled state (readonly).
 * - `ref.current.grouped` — `true` when compound slot children are present (readonly).
 * - `ref.current.focus()` — focuses the underlying input.
 * - `ref.current.clear()` — clears the native `<input>` and dispatches `input`/`change`.
 *
 * **Baseline styles**: neutral gray surface with a **transparent 1px border**, so
 * a `focus-within:border-primary` or an invalid-state border costs no layout —
 * under `box-sizing: border-box` a border that appears later eats the content box
 * and the text jumps. It is `base`, so `border-0` still wins. Bare fields use
 * native inline-block width (~20 characters via default `size={20}`). Pass
 * `w-full` or another width utility when the field should fill its parent. Border
 * colours and focus rings belong in Tier 2 `className`.
 *
 * @example
 * ```tsx
 * const ref = useRef<InputHandle>(null)
 *
 * <Input ref={ref} name="q" placeholder="Search" className="w-full px-3">
 *   <Input.Leading className="pe-2">
 *     <SearchIcon />
 *   </Input.Leading>
 * </Input>
 * ```
 */
const InputRoot = forwardRef<InputHandle, InputProps>(function Input(
  {
    children,
    className,
    id,
    value,
    name,
    onChange,
    onInput,
    defaultValue,
    disabled,
    ...fieldProps
  },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const fieldRef = useRef<HTMLInputElement | null>(null)

  const isGrouped = inputHasCompoundChildren(children)
  const { shellClassName, innerClassName } = useMemo(
    () => partitionInputClassName(className),
    [className],
  )

  useImperativeHandle(
    ref,
    () => ({
      get value() {
        return fieldRef.current?.value ?? ""
      },
      get disabled() {
        return fieldRef.current?.disabled ?? false
      },
      get grouped() {
        return isGrouped
      },
      focus: () => {
        fieldRef.current?.focus()
      },
      clear: () => {
        const field = fieldRef.current
        if (!field) return
        field.value = ""
        dispatchFieldValueEvents(field)
      },
    }),
    [isGrouped],
  )

  const chromeLessField = (
    <InputField
      ref={fieldRef}
      //only when it IS the root: grouped, the wrapping label above carries it, and
      //stamping both would make `[data-adaptv="input"]` match two nested elements
      data-adaptv={isGrouped ? undefined : "input"}
      grouped={isGrouped}
      inputId={inputId}
      name={name}
      //both halves of the partition are the CONSUMER tier, so they are handed over
      //separately and merged there rather than pre-joined here — that keeps one
      //mergeStyles call as the single place precedence is decided (§2)
      className={isGrouped ? undefined : shellClassName}
      innerClassName={innerClassName}
      value={value}
      defaultValue={defaultValue}
      onChange={onChange}
      onInput={onInput}
      disabled={disabled}
      {...fieldProps}
    />
  )

  const isDisabled = Boolean(disabled)

  const tree = isGrouped ? (
    <InputGroup
      inputId={inputId}
      className={shellClassName}
      disabled={isDisabled}
    >
      {chromeLessField}
      {children}
    </InputGroup>
  ) : (
    chromeLessField
  )

  return (
    <InputContext.Provider value={{ isGrouped, isDisabled }}>
      {tree}
    </InputContext.Provider>
  )
})

InputRoot.displayName = "Input"

/* =============================================================================
 * COMPOUND EXPORT
 * ============================================================================= */

const InputCompound = Object.assign(InputRoot, {
  Leading: InputLeading,
  Trailing: InputTrailing,
})
export { InputCompound as Input }

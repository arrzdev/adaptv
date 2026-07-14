import type {
  CSSProperties,
  InputHTMLAttributes,
  PointerEvent,
  ReactElement,
  ReactNode,
} from "react"
import {
  Children,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { useGestureEngine } from "#nativ/hooks/use-gesture-engine"
import { cn } from "#nativ/utils/cn"
import { dynamicValues } from "#nativ/utils/dynamic-values"

/* =============================================================================
 * TYPES
 * ============================================================================= */

/**
 * Imperative API for {@link Checkbox}. Attach with `ref`.
 *
 * | Member | Description |
 * |--------|-------------|
 * | `checked` | Live checked state (readonly) |
 * | `disabled` | Live disabled state (readonly) |
 * | `focus()` | Focus the underlying `<input type="checkbox">` |
 */
export type CheckboxHandle = {
  readonly checked: boolean
  readonly disabled: boolean
  focus: () => void
}

/** Programmatic state from {@link useCheckbox} for Tier 2 branch paint. */
export type CheckboxContextValue = {
  isChecked: boolean
  isIndeterminate: boolean
  isDisabled: boolean
  /** Tailwind spacing index passed to the root `size` prop. */
  size: number
}

/**
 * Props for the root {@link Checkbox}.
 *
 * Controlled: `checked` + `onCheckedChange`. Uncontrolled: `defaultChecked`.
 * Forwards native checkbox props (`name`, `disabled`, `aria-*`, etc.) to the
 * real `<input type="checkbox">`.
 *
 * Tier 2 box/icon paint: {@link useCheckbox} inside `Checkbox.Box` /
 * `Checkbox.Icon` slots, and/or controlled `checked` on the root wrapper.
 */
export interface CheckboxProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    | "type"
    | "onChange"
    | "size"
    | "className"
    | "style"
    | "children"
    | "defaultChecked"
  > {
  /** Controlled checked state. */
  checked?: boolean
  /** Initial checked state when uncontrolled. */
  defaultChecked?: boolean
  /** Mixed selection; maps to `input.indeterminate`. */
  indeterminate?: boolean
  /** Fired when the user toggles; receives the next checked value. */
  onCheckedChange?: (checked: boolean) => void
  /** Tier 2 utilities merged after the neutral baseline on the root `<label>`. */
  className?: string
  style?: CSSProperties
  /**
   * Tailwind spacing index: box edge = size × 0.25rem; icon scales with box.
   */
  size?: number
  /** Optional `Checkbox.Box` / `Checkbox.Icon` slots (defaults to box + checkmark). */
  children?: ReactNode
}

/**
 * Props for `Checkbox.Box`. Must be a descendant of `<Checkbox>` (or a Tier 2
 * wrapper whose `displayName` is `Checkbox.Box`).
 */
export interface CheckboxBoxProps {
  /** Tier 2 box shape, border, and fill utilities. */
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

/**
 * Props for `Checkbox.Icon`. Must be inside `Checkbox.Box` (or Tier 2
 * `Checkbox.Icon` with matching `displayName`).
 */
export interface CheckboxIconProps {
  /** Tier 2 mark color, size overrides, and motion utilities. */
  className?: string
  /** Custom mark; omit for the neutral SVG checkmark. */
  children?: ReactNode
}

/* =============================================================================
 * CLASSES
 * ============================================================================= */

const CHECKBOX_ROOT_LAYOUT_CLASS =
  "relative inline-flex shrink-0 items-center justify-center"
const CHECKBOX_ROOT_INTERACTION_CLASS = "clickable"
const CHECKBOX_INPUT_CHROMELESS_CLASS = "peer sr-only"
const CHECKBOX_BOX_LAYOUT_CLASS =
  "relative flex shrink-0 items-center justify-center overflow-hidden"
const CHECKBOX_BOX_SURFACE_CLASS = "bg-gray-50"
const CHECKBOX_ICON_LAYOUT_CLASS = "pointer-events-none"

/* =============================================================================
 * CONTEXT
 * ============================================================================= */

const CheckboxContext = createContext<CheckboxContextValue | null>(null)

/**
 * Reactive checked state for {@link Checkbox} compound trees.
 * Use in Tier 2 `Checkbox.Box` / `Checkbox.Icon` wrappers — branch with
 * `isChecked` / `isIndeterminate` / `isDisabled`, not `has-[:checked]:` or
 * `group-*` selectors.
 */
export function useCheckbox(): CheckboxContextValue {
  const ctx = useContext(CheckboxContext)
  if (!ctx) {
    throw new Error("useCheckbox must be used within <Checkbox>.")
  }
  return ctx
}

/* =============================================================================
 * LAYOUT
 *
 * Proportional box/icon dimensions from the `size` spacing index, applied as rem
 * inline styles (Tailwind does not emit runtime arbitrary size classes here).
 * ============================================================================= */

function checkboxLayout(size: number) {
  return dynamicValues({
    size,
    derive: ({ edgeRem, size: s }) => {
      const iconToBox = 0.625
      const strokeBaselineSize = 8
      const strokeBaseline = 2.5
      return {
        boxRem: edgeRem,
        iconRem: edgeRem * iconToBox,
        strokeWidth: strokeBaseline * (s / strokeBaselineSize),
      }
    },
  })
}

function checkboxBoxStyle(size: number): CSSProperties {
  const { boxRem } = checkboxLayout(size)
  return {
    width: `${boxRem}rem`,
    height: `${boxRem}rem`,
  }
}

function checkboxIconStyle(size: number): CSSProperties {
  const { iconRem } = checkboxLayout(size)
  return {
    width: `${iconRem}rem`,
    height: `${iconRem}rem`,
  }
}

function checkboxIconMarkOpacity(
  isChecked: boolean,
  isIndeterminate: boolean,
): number {
  if (isIndeterminate) return 0
  return isChecked ? 1 : 0
}

/* =============================================================================
 * CHILDREN PARTITIONING
 * ============================================================================= */

function isCheckboxBoxElement(
  child: ReactNode,
): child is ReactElement<CheckboxBoxProps> {
  if (!isValidElement(child)) return false
  if (child.type === CheckboxBox) return true
  const type = child.type
  if (typeof type === "function" || typeof type === "object")
    return (
      (type as { displayName?: string }).displayName === "Checkbox.Box"
    )
  return false
}

function resolveCheckboxBoxChild(children: ReactNode): ReactNode {
  if (children == null) {
    return (
      <CheckboxBox>
        <CheckboxIcon />
      </CheckboxBox>
    )
  }

  let box: ReactNode = null

  Children.forEach(children, (child) => {
    if (isCheckboxBoxElement(child)) {
      box = child
    }
  })

  if (box) return box

  return <CheckboxBox>{children}</CheckboxBox>
}

/* =============================================================================
 * CHECKBOX BOX
 * ============================================================================= */

/**
 * Visual checkbox square. Rendered by default; replace with
 * `<Checkbox.Box className="…">` for custom box chrome.
 *
 * @example
 * ```tsx
 * function BrandedBox({ children }: { children: ReactNode }) {
 *   const { isChecked, isDisabled } = useCheckbox()
 *   return (
 *     <Checkbox.Box
 *       className={cn(
 *         isDisabled ? "border-muted bg-muted" : "border-border bg-surface",
 *         isChecked && "border-primary bg-primary",
 *       )}
 *     >
 *       {children}
 *     </Checkbox.Box>
 *   )
 * }
 * ```
 */
function CheckboxBox({ className, style, children }: CheckboxBoxProps) {
  const { size } = useCheckbox()

  return (
    <span
      style={{ ...checkboxBoxStyle(size), ...style }}
      className={cn(
        CHECKBOX_BOX_LAYOUT_CLASS,
        CHECKBOX_BOX_SURFACE_CLASS,
        className,
      )}
    >
      {children}
    </span>
  )
}

CheckboxBox.displayName = "Checkbox.Box"

/* =============================================================================
 * CHECKBOX ICON
 * ============================================================================= */

/**
 * Checkmark (or custom mark) centered in `Checkbox.Box`. Omitted for box-only
 * checked states. Replace with `<Checkbox.Icon className="…" />` or pass
 * `children` for a custom mark.
 */
function CheckboxIcon({ className, children }: CheckboxIconProps) {
  const { isChecked, isIndeterminate, size } = useCheckbox()
  const layout = checkboxLayout(size)
  const markStyle: CSSProperties = {
    ...checkboxIconStyle(size),
    opacity: checkboxIconMarkOpacity(isChecked, isIndeterminate),
  }

  if (children) {
    return (
      <span
        style={markStyle}
        className={cn(CHECKBOX_ICON_LAYOUT_CLASS, className)}
      >
        {children}
      </span>
    )
  }

  return (
    <svg
      aria-hidden
      style={markStyle}
      className={cn(CHECKBOX_ICON_LAYOUT_CLASS, className)}
      fill="none"
      viewBox="0 0 16 16"
    >
      <title>Checkmark</title>
      <path
        d="M3.5 8.2 6.4 11.1 12.5 4.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={layout.strokeWidth}
      />
    </svg>
  )
}

CheckboxIcon.displayName = "Checkbox.Icon"

/* =============================================================================
 * ROOT
 *
 * Renders a native `<input type="checkbox">` inside a `<label>` with a
 * decorative box (and optional icon). The checkbox is the form control — no
 * Touch taps use {@link useGestureEngine} on the label (same as legacy switch).
 * The native input is `readOnly`; React state owns `checked`.
 * Tier 2 styles the label via root `className` and each compound part via
 * {@link useCheckbox}.
 * ============================================================================= */

/**
 * Checkbox: native `<input type="checkbox">` + visual box label.
 *
 * **Tier 2 brand paint** — root `className` for focus/hit target; branch inside
 * `Checkbox.Box` / `Checkbox.Icon` with {@link useCheckbox} (`isChecked && "…"`).
 *
 * **Imperative handle** (`ref`)
 * - `ref.current.checked` — live checked (readonly)
 * - `ref.current.disabled` — live disabled (readonly)
 * - `ref.current.focus()` — focuses the native input
 *
 * @example
 * ```tsx
 * const [on, setOn] = useState(false)
 *
 * <Checkbox checked={on} onCheckedChange={setOn} aria-label="Agree">
 *   <Checkbox.Box className={cn(on && "bg-primary")}>
 *     <Checkbox.Icon className={cn(on && "text-primary-fg")} />
 *   </Checkbox.Box>
 * </Checkbox>
 * ```
 */
const Checkbox = forwardRef<CheckboxHandle, CheckboxProps>(
  function Checkbox(
    {
      checked: controlledChecked,
      defaultChecked = false,
      indeterminate = false,
      onCheckedChange,
      className,
      disabled,
      size = 8,
      style,
      children,
      onPointerDown: onPointerDownProp,
      onPointerUp: onPointerUpProp,
      id: idProp,
      ...inputProps
    },
    ref,
  ) {
    const inputId = useId()
    const resolvedInputId = idProp ?? inputId
    const isControlled = controlledChecked !== undefined
    const [uncontrolledChecked, setUncontrolledChecked] =
      useState(defaultChecked)
    const isChecked = isControlled
      ? controlledChecked
      : uncontrolledChecked
    const isDisabled = Boolean(disabled)
    const isIndeterminate = Boolean(indeterminate)
    const checkboxContext: CheckboxContextValue = {
      isChecked,
      isIndeterminate,
      isDisabled,
      size,
    }

    const inputRef = useRef<HTMLInputElement>(null)

    useLayoutEffect(() => {
      const input = inputRef.current
      if (!input) return
      input.indeterminate = isIndeterminate
    }, [isIndeterminate])

    useImperativeHandle(
      ref,
      () => ({
        get checked() {
          return inputRef.current?.checked ?? isChecked
        },
        get disabled() {
          return inputRef.current?.disabled ?? isDisabled
        },
        focus: () => {
          inputRef.current?.focus()
        },
      }),
      [isChecked, isDisabled],
    )

    const toggle = useCallback(() => {
      if (isDisabled) return
      const next = isIndeterminate ? true : !isChecked
      if (!isControlled) {
        setUncontrolledChecked(next)
      }
      onCheckedChange?.(next)
    }, [
      isChecked,
      isControlled,
      isDisabled,
      isIndeterminate,
      onCheckedChange,
    ])

    const gestureEngineHandlers = useGestureEngine({
      disabled: isDisabled,
      onPressUp: toggle,
    })

    const boxChild = resolveCheckboxBoxChild(children)

    return (
      <CheckboxContext.Provider value={checkboxContext}>
        <label
          htmlFor={resolvedInputId}
          style={style}
          className={cn(
            CHECKBOX_ROOT_LAYOUT_CLASS,
            !isDisabled && CHECKBOX_ROOT_INTERACTION_CLASS,
            className,
          )}
          {...gestureEngineHandlers}
          onPointerDown={(e: PointerEvent<HTMLLabelElement>) => {
            onPointerDownProp?.(
              e as unknown as PointerEvent<HTMLInputElement>,
            )
            gestureEngineHandlers.onPointerDown(e)
          }}
          onPointerUp={(e: PointerEvent<HTMLLabelElement>) => {
            onPointerUpProp?.(
              e as unknown as PointerEvent<HTMLInputElement>,
            )
            gestureEngineHandlers.onPointerUp(e)
          }}
        >
          <input
            {...inputProps}
            ref={inputRef}
            id={resolvedInputId}
            type="checkbox"
            checked={isChecked}
            disabled={disabled}
            readOnly
            className={CHECKBOX_INPUT_CHROMELESS_CLASS}
          />
          {boxChild}
        </label>
      </CheckboxContext.Provider>
    )
  },
)

Checkbox.displayName = "Checkbox"

/* =============================================================================
 * COMPOUND EXPORT
 * ============================================================================= */

const CheckboxCompound = Object.assign(Checkbox, {
  Box: CheckboxBox,
  Icon: CheckboxIcon,
})

export { CheckboxCompound as Checkbox }

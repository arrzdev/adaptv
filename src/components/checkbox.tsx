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
import {
  PRESS_TARGET_DISABLED_LOCKED_CLASS,
  PRESS_TARGET_LOCKED_CLASS,
} from "#adaptv/components/press-core"
import { useGestureEngine } from "#adaptv/hooks/use-gesture-engine"
import { dynamicValues } from "#adaptv/utils/dynamic-values"
import { mergeStyles } from "#adaptv/utils/styles"

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

const CHECKBOX_ROOT_LAYOUT_CLASS =
  "inline-flex shrink-0 items-center justify-center"
//LOCKED: the input is laid over the whole label, so the label is its containing
//block; a consumer `static` here would send the input to the nearest positioned
//ancestor and make the checkbox's accessible frame some other element's box
const CHECKBOX_ROOT_LOCKED_LAYOUT_CLASS = "relative"
//LOCKED (touch) and BASE (cursor) are separate tiers — press-core explains why
const CHECKBOX_ROOT_INTERACTION_CLASS = PRESS_TARGET_LOCKED_CLASS
const CHECKBOX_ROOT_CURSOR_CLASS = "cursor-pointer"
const CHECKBOX_ROOT_NON_INTERACTION_CLASS =
  PRESS_TARGET_DISABLED_LOCKED_CLASS
const CHECKBOX_ROOT_DISABLED_CURSOR_CLASS = "cursor-not-allowed"
//LOCKED: the input is the ONLY element assistive tech and automation see, so its
//box is the control's frame to VoiceOver, TalkBack and every tap aimed at it. It
//used to be `sr-only`, a clipped 1px box in the middle of a 32x32 label
//(measured on chromium and webkit), so screen readers framed a speck and anything
//aiming at that frame hit the painted box instead of the control. Covering the
//label exactly, invisibly, makes the accessible frame and the hit area one
//rectangle, and a consumer who widens the label into a full row widens both. Pointer events land on the input and bubble
//to the label, where the gesture engine still owns the press. There is no
//`peer`: the input is rendered AFTER the box so it paints over it without a
//z-index (the box is positioned, and a z-index would lift an invisible input over
//unrelated overlays), and a `peer-*` variant only reaches later siblings.
const CHECKBOX_INPUT_LOCKED_CLASS =
  "absolute inset-0 m-0 size-full cursor-[inherit] appearance-none opacity-0"
//LOCKED: the box is the positioning context for the absolutely-centred mark and
//the clip for a custom one; `shrink-0` keeps the square square inside a flex label.
const CHECKBOX_BOX_LOCKED_LAYOUT_CLASS =
  "relative flex shrink-0 items-center justify-center overflow-hidden"
//⚠︎ Do NOT re-add `border border-transparent` here — see the note in button.tsx.
//It cancels the shift only for a 1px border and permanently shrinks the content box
//of every checkbox. Use `outline` for a toggled checked/selected ring instead.
const CHECKBOX_BOX_SURFACE_CLASS = "bg-gray-50"
//LOCKED: the mark sits over the box; if it took pointer events it would swallow the
//tap the label's gesture engine is waiting for and the checkbox would stop toggling.
const CHECKBOX_ICON_LOCKED_LAYOUT_CLASS = "pointer-events-none"

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

  //The box edge is `lockedStyle`, not `baseStyle`: it is derived from the root's
  //`size` PROP, and the mark's own width/height and stroke width are derived from
  //the SAME number. A consumer inline `width` would resize the square without
  //resizing the checkmark, which is a silently broken control rather than a
  //restyled one — `size={n}` is the supported way to change it.
  const { className: boxClassName, style: boxStyle } = mergeStyles({
    base: CHECKBOX_BOX_SURFACE_CLASS,
    className,
    locked: CHECKBOX_BOX_LOCKED_LAYOUT_CLASS,
    style,
    lockedStyle: checkboxBoxStyle(size),
  })

  return (
    <span style={boxStyle} className={boxClassName}>
      {children}
    </span>
  )
}

CheckboxBox.displayName = "Checkbox.Box"

/**
 * Checkmark (or custom mark) centered in `Checkbox.Box`. Omitted for box-only
 * checked states. Replace with `<Checkbox.Icon className="…" />` or pass
 * `children` for a custom mark.
 */
function CheckboxIcon({ className, children }: CheckboxIconProps) {
  const { isChecked, isIndeterminate, size } = useCheckbox()
  const layout = checkboxLayout(size)
  //`opacity` is checked-state, not geometry — it belongs to the same locked tier as
  //the size for the same reason: it IS the mark's visibility, and a consumer who
  //pins it to 1 gets a checkmark on an unchecked box. Branch with `useCheckbox()`.
  const markStyle: CSSProperties = {
    ...checkboxIconStyle(size),
    opacity: checkboxIconMarkOpacity(isChecked, isIndeterminate),
  }

  //`Checkbox.Icon` takes no `style` prop, so the inline tier has only the locked
  //layer — named explicitly rather than passed as a bare `style=` so it reads as
  //the same decision the box makes.
  const iconStyles = mergeStyles({
    base: undefined,
    className,
    locked: CHECKBOX_ICON_LOCKED_LAYOUT_CLASS,
    lockedStyle: markStyle,
  })

  if (children) {
    return (
      <span style={iconStyles.style} className={iconStyles.className}>
        {children}
      </span>
    )
  }

  return (
    <svg
      aria-hidden
      style={iconStyles.style}
      className={iconStyles.className}
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
          data-adaptv="checkbox"
          htmlFor={resolvedInputId}
          //Two things are locked. The interaction utility, for the reason press-core
          //gives: {@link PRESS_TARGET_LOCKED_CLASS} carries the `touch-action`
          //longhand that keeps `pointercancel` alive on iOS (WebKit 240917), and no
          //`className` may defeat it. And `relative`, because the input is laid
          //over the label and measured against it. The rest of the layout is
          //deliberately BASE, so `inline-flex` / `shrink-0` are a default, and a
          //consumer turning this into a full-width `flex` row hit target is a
          //legitimate restyle, not a break: the accessible frame grows with it.
          {...mergeStyles({
            base: [
              CHECKBOX_ROOT_LAYOUT_CLASS,
              isDisabled
                ? CHECKBOX_ROOT_DISABLED_CURSOR_CLASS
                : CHECKBOX_ROOT_CURSOR_CLASS,
            ],
            className,
            locked: [
              CHECKBOX_ROOT_LOCKED_LAYOUT_CLASS,
              isDisabled
                ? CHECKBOX_ROOT_NON_INTERACTION_CLASS
                : CHECKBOX_ROOT_INTERACTION_CLASS,
            ],
            style,
            //nothing about the root is structural in INLINE style: the geometry
            //lives on the box, and the press state is a class + an attribute
            lockedStyle: undefined,
          })}
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
          {boxChild}
          <input
            {...inputProps}
            ref={inputRef}
            id={resolvedInputId}
            type="checkbox"
            checked={isChecked}
            disabled={disabled}
            //not a behaviour: `readonly` does not apply to a checkbox, so the
            //browser still flips it and the engine still owns the toggle. It is
            //what tells React this controlled `checked` has no `onChange` on
            //purpose, and Chromium's accessibility tree does not expose it
            readOnly
            className={CHECKBOX_INPUT_LOCKED_CLASS}
          />
        </label>
      </CheckboxContext.Provider>
    )
  },
)

Checkbox.displayName = "Checkbox"

const CheckboxCompound = Object.assign(Checkbox, {
  Box: CheckboxBox,
  Icon: CheckboxIcon,
})

export { CheckboxCompound as Checkbox }

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
 * Imperative API for {@link Switch}. Attach with `ref`.
 *
 * | Member | Description |
 * |--------|-------------|
 * | `checked` | Live on/off state (readonly) |
 * | `disabled` | Live disabled state (readonly) |
 * | `focus()` | Focus the underlying checkbox (`role="switch"`) |
 */
export type SwitchHandle = {
  readonly checked: boolean
  readonly disabled: boolean
  focus: () => void
}

/** Programmatic state from {@link useSwitch} for Tier 2 branch paint. */
export type SwitchContextValue = {
  isChecked: boolean
  isDisabled: boolean
  /** Tailwind spacing index passed to the root `size` prop. */
  size: number
}

/**
 * Props for the root {@link Switch}.
 *
 * Controlled: `checked` + `onCheckedChange`. Uncontrolled: `defaultChecked`.
 * Forwards native checkbox props (`name`, `disabled`, `aria-*`, etc.) to the
 * real `<input type="checkbox" role="switch">`.
 *
 * Tier 2 track paint: `className={cn(isChecked && "…")}` on the root (controlled
 * `checked` at the wrapper) and/or {@link useSwitch} inside `Switch.Thumb` slots.
 */
export interface SwitchProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    | "type"
    | "role"
    | "onChange"
    | "size"
    | "className"
    | "style"
    | "children"
  > {
  /** Controlled on state. */
  checked?: boolean
  /** Initial on state when uncontrolled. */
  defaultChecked?: boolean
  /** Fired when the user toggles; receives the next checked value. */
  onCheckedChange?: (checked: boolean) => void
  /** Tier 2 track utilities merged after the neutral baseline. */
  className?: string
  style?: CSSProperties
  /**
   * Tailwind spacing index: track height = size × 0.25rem; width 12/7× height;
   * thumb 6/7× height, centered with an equal gap on every side.
   */
  size?: number
  /** Optional `Switch.Thumb` slot (defaults to a neutral thumb). */
  children?: ReactNode
}

/**
 * Props for `Switch.Thumb`. Must be a direct child of `<Switch>` (or a Tier 2
 * wrapper whose `displayName` is `Switch.Thumb`).
 *
 * Branch thumb paint with {@link useSwitch} (`isChecked && "…"`) or controlled
 * `checked` from the parent wrapper.
 */
export interface SwitchThumbProps {
  /** Tier 2 thumb shape, color, and shadow utilities. */
  className?: string
}

/* =============================================================================
 * CLASSES
 * ============================================================================= */

const SWITCH_TRACK_LAYOUT_CLASS =
  "relative inline-flex shrink-0 items-center"
const SWITCH_TRACK_SURFACE_CLASS = "bg-gray-50"
const SWITCH_TRACK_INTERACTION_CLASS = "clickable"
const SWITCH_INPUT_CHROMELESS_CLASS = "peer sr-only"
const SWITCH_THUMB_LAYOUT_CLASS =
  "pointer-events-none absolute top-1/2 -translate-y-1/2 shrink-0"
const SWITCH_THUMB_SURFACE_CLASS = "bg-gray-950"

/* =============================================================================
 * CONTEXT
 * ============================================================================= */

const SwitchContext = createContext<SwitchContextValue | null>(null)

/**
 * Reactive on/off state for {@link Switch} compound trees.
 * Use in Tier 2 `Switch.Thumb` wrappers — branch with `isChecked` / `isDisabled`,
 * not `has-[:checked]:`, `aria-checked:`, or `enabled:` variants.
 */
export function useSwitch(): SwitchContextValue {
  const ctx = useContext(SwitchContext)
  if (!ctx) {
    throw new Error("useSwitch must be used within <Switch>.")
  }
  return ctx
}

/* =============================================================================
 * LAYOUT
 *
 * Proportional track/thumb dimensions from the `size` spacing index, applied as
 * rem inline styles (Tailwind does not emit runtime arbitrary size classes here).
 * ============================================================================= */

function switchLayout(size: number) {
  return dynamicValues({
    size,
    derive: ({ edgeRem }) => {
      const trackWidthPerHeight = 12 / 7
      const thumbPerHeight = 6 / 7
      const trackHRem = edgeRem
      const trackWRem = edgeRem * trackWidthPerHeight
      const thumbRem = edgeRem * thumbPerHeight
      const thumbInsetRem = (trackHRem - thumbRem) / 2
      return { trackHRem, trackWRem, thumbRem, thumbInsetRem }
    },
  })
}

function switchTrackStyle(size: number): CSSProperties {
  const { trackHRem, trackWRem } = switchLayout(size)
  return {
    height: `${trackHRem}rem`,
    width: `${trackWRem}rem`,
  }
}

function switchThumbStyle(
  isChecked: boolean,
  size: number,
): CSSProperties {
  const { trackWRem, thumbRem, thumbInsetRem } = switchLayout(size)
  return {
    height: `${thumbRem}rem`,
    width: `${thumbRem}rem`,
    left: isChecked
      ? `${trackWRem - thumbRem - thumbInsetRem}rem`
      : `${thumbInsetRem}rem`,
  }
}

/* =============================================================================
 * CHILDREN PARTITIONING
 * ============================================================================= */

function isSwitchThumbElement(
  child: ReactNode,
): child is ReactElement<SwitchThumbProps> {
  if (!isValidElement(child)) return false
  if (child.type === SwitchThumb) return true
  const type = child.type
  if (typeof type === "function" || typeof type === "object")
    return (
      (type as { displayName?: string }).displayName === "Switch.Thumb"
    )
  return false
}

function resolveSwitchThumbChild(children: ReactNode): ReactNode {
  if (children == null) {
    return <SwitchThumb />
  }

  let thumb: ReactNode = null

  Children.forEach(children, (child) => {
    if (isSwitchThumbElement(child)) {
      thumb = child
    }
  })

  return thumb ?? <SwitchThumb />
}

/* =============================================================================
 * SWITCH THUMB
 * ============================================================================= */

/**
 * Thumb pill inside the track. Rendered by default; replace with
 * `<Switch.Thumb className="…" />` for custom thumb chrome.
 *
 * @example
 * ```tsx
 * function BrandedThumb() {
 *   const { isChecked } = useSwitch()
 *   return <Switch.Thumb className={cn(isChecked && "bg-white")} />
 * }
 *
 * <Switch aria-label="Wi-Fi" checked={on} onCheckedChange={setOn}>
 *   <BrandedThumb />
 * </Switch>
 * ```
 */
function SwitchThumb({ className }: SwitchThumbProps) {
  const { isChecked, size } = useSwitch()

  return (
    <span
      aria-hidden
      style={switchThumbStyle(isChecked, size)}
      className={cn(
        SWITCH_THUMB_LAYOUT_CLASS,
        SWITCH_THUMB_SURFACE_CLASS,
        className,
      )}
    />
  )
}

SwitchThumb.displayName = "Switch.Thumb"

/* =============================================================================
 * ROOT
 *
 * Renders a native `<input type="checkbox" role="switch">` inside a `<label>`
 * track. The checkbox is the form control (no hidden-field sync). Visual thumb is
 * decorative (`pointer-events-none`). Tier 2 styles the track via root `className`
 * and thumb slots via {@link useSwitch} or controlled `checked` on the wrapper.
 * ============================================================================= */

/**
 * Toggle switch: native checkbox (`role="switch"`) + visual track label.
 *
 * **Tier 2 brand paint** — root `className={cn(isChecked && "…")}` (controlled
 * `checked` on the wrapper) and/or {@link useSwitch} inside `Switch.Thumb` slots.
 * Do not branch with `has-[:checked]:`, `aria-checked:`, or `enabled:` variants.
 *
 * **Imperative handle** (`ref`)
 * - `ref.current.checked` — live on/off (readonly)
 * - `ref.current.disabled` — live disabled (readonly)
 * - `ref.current.focus()` — focuses the checkbox
 *
 * @example
 * ```tsx
 * const [on, setOn] = useState(false)
 *
 * <Switch
 *   checked={on}
 *   onCheckedChange={setOn}
 *   aria-label="Dark mode"
 *   className={cn(on ? "bg-brand-600" : "bg-gray-200")}
 * >
 *   <Switch.Thumb className={cn(on && "bg-white")} />
 * </Switch>
 * ```
 */
const Switch = forwardRef<SwitchHandle, SwitchProps>(function Switch(
  {
    checked: controlledChecked,
    defaultChecked = false,
    onCheckedChange,
    className,
    disabled,
    size = 7,
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
  const isChecked = isControlled ? controlledChecked : uncontrolledChecked
  const isDisabled = Boolean(disabled)
  const switchContext: SwitchContextValue = { isChecked, isDisabled, size }

  const inputRef = useRef<HTMLInputElement>(null)

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
    const next = !isChecked
    if (!isControlled) {
      setUncontrolledChecked(next)
    }
    onCheckedChange?.(next)
  }, [isChecked, isControlled, isDisabled, onCheckedChange])

  const gestureEngineHandlers = useGestureEngine({
    disabled: isDisabled,
    onPressUp: toggle,
  })

  const thumbChild = resolveSwitchThumbChild(children)

  return (
    <SwitchContext.Provider value={switchContext}>
      <label
        htmlFor={resolvedInputId}
        style={{ ...switchTrackStyle(size), ...style }}
        className={cn(
          SWITCH_TRACK_LAYOUT_CLASS,
          SWITCH_TRACK_SURFACE_CLASS,
          !isDisabled && SWITCH_TRACK_INTERACTION_CLASS,
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
          onPointerUpProp?.(e as unknown as PointerEvent<HTMLInputElement>)
          gestureEngineHandlers.onPointerUp(e)
        }}
      >
        <input
          {...inputProps}
          ref={inputRef}
          id={resolvedInputId}
          type="checkbox"
          role="switch"
          aria-checked={isChecked}
          checked={isChecked}
          disabled={disabled}
          readOnly
          className={SWITCH_INPUT_CHROMELESS_CLASS}
        />
        {thumbChild}
      </label>
    </SwitchContext.Provider>
  )
})

Switch.displayName = "Switch"

/* =============================================================================
 * COMPOUND EXPORT
 * ============================================================================= */

const SwitchCompound = Object.assign(Switch, { Thumb: SwitchThumb })

export { SwitchCompound as Switch }

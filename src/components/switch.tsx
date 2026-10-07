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
import {
  PRESS_TARGET_DISABLED_LOCKED_STYLE,
  PRESS_TARGET_LOCKED_STYLE,
} from "#adaptv/components/press-core"
import { useGestureEngine } from "#adaptv/hooks/use-gesture-engine"
import { dynamicValues } from "#adaptv/utils/dynamic-values"
import { composeStyles } from "#adaptv/utils/styles"

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

//The track's inline-flex layout, surface and cursor and the thumb's surface are
//default rules in styles/switch.css. What is here is LOCKED, inline
//(docs/decisions/styling.md §2.0), so no `className` can defeat it.
//
//LOCKED: `position: relative` is the positioning context the thumb's `absolute` +
//computed `left` inset are measured against — drop it and the thumb flies to the
//nearest positioned ancestor, usually the page. The touch pass-through is
//press-core's (WebKit 240917); a disabled track keeps it and adds `user-select: none`.
const SWITCH_TRACK_LOCKED_STYLE: CSSProperties = Object.freeze({
  position: "relative",
  ...PRESS_TARGET_LOCKED_STYLE,
})
const SWITCH_TRACK_DISABLED_LOCKED_STYLE: CSSProperties = Object.freeze({
  position: "relative",
  ...PRESS_TARGET_DISABLED_LOCKED_STYLE,
})
//LOCKED: the input is the ONLY element assistive tech and automation see, so its
//box is the control's frame to VoiceOver, TalkBack and every tap aimed at it. It
//used to be `sr-only`: a clipped 1px box at the track's left edge, so the frame
//announced was under a point wide and a tap at its centre landed OUTSIDE the
//track and did nothing (measured: a 1x1 box at x=343 beside a 48x28 track at
//x=344). Covering the track exactly, invisibly, makes the accessible frame and
//the hit area one rectangle on every engine. Pointer events now land on the
//input and bubble to the label, where the gesture engine still owns the press.
const SWITCH_INPUT_LOCKED_STYLE: CSSProperties = Object.freeze({
  position: "absolute",
  inset: 0,
  margin: 0,
  width: "100%",
  height: "100%",
  cursor: "inherit",
  appearance: "none",
  opacity: 0,
})
//LOCKED: the thumb is decorative and sits over the track's hit area — taking
//pointer events would swallow the tap the label's gesture engine needs. The
//absolute placement + vertical centring are what the computed inset and travel
//assume. `translate` is the separate property, so it composes with the travel
//`transform` in `switchThumbStyle`.
const SWITCH_THUMB_LOCKED_LAYOUT_STYLE: CSSProperties = Object.freeze({
  pointerEvents: "none",
  position: "absolute",
  top: "50%",
  translate: "0 -50%",
  flexShrink: 0,
})

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

//The thumb rests at the OFF inset and TRAVELS on `transform`, never on `left`.
//A `left` change is a layout shift — one entry per toggle (measured 3.1e-5 at
//1280x720, 1.3e-4 at 390x844) — and a toggle with no input behind it (the
//"Dark mode" row following the OS appearance, state that syncs in) has no
//`hadRecentInput` to excuse it, so it counted toward CLS (VISION.md §2.1). A
//transform is not a shift. It composes with the locked `translate: 0 -50%`,
//which is a separate property.
function switchThumbStyle(
  isChecked: boolean,
  size: number,
): CSSProperties {
  const { trackWRem, thumbRem, thumbInsetRem } = switchLayout(size)
  const travelRem = trackWRem - thumbRem - 2 * thumbInsetRem
  return {
    height: `${thumbRem}rem`,
    width: `${thumbRem}rem`,
    left: `${thumbInsetRem}rem`,
    transform: `translateX(${isChecked ? travelRem : 0}rem)`,
  }
}

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

  //`switchThumbStyle` is `lockedStyle`: its `transform` is the ON/OFF POSITION,
  //computed from the track width and the thumb size that the root's `size` prop
  //derived. It is state, not look — a consumer pinning `transform` inline would
  //freeze the thumb on one side while the control kept toggling. Colour and shape
  //stay `className`.
  const thumb = composeStyles({
    className,
    lockedStyle: {
      ...SWITCH_THUMB_LOCKED_LAYOUT_STYLE,
      ...switchThumbStyle(isChecked, size),
    },
  })

  return (
    <span
      aria-hidden
      data-adaptv="switch-thumb"
      data-part="thumb"
      style={thumb.style}
      className={thumb.className || undefined}
    />
  )
}

SwitchThumb.displayName = "Switch.Thumb"

/* =============================================================================
 * ROOT
 *
 * Renders a native `<input type="checkbox" role="switch">` inside a `<label>`
 * track. The checkbox is the form control (no hidden-field sync). Visual thumb is
 * decorative (`pointer-events: none`). Tier 2 styles the track via root `className`
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
    //an OUTER label (a settings row wrapping this switch) forwards its click to
    //the input; no press on the track produced it, so the engine hands it here
    //and the switch toggles exactly as if the track had been tapped
    onUnownedClick: toggle,
  })

  const thumbChild = resolveSwitchThumbChild(children)

  //`switchTrackStyle` is LOCKED: the thumb's travel is computed from this exact
  //track width, so an inline `width` from the consumer resizes the track and leaves
  //the thumb parked at the old offset. `size={n}` is the supported way to change it,
  //and it moves both. The touch pass-through is locked for the press-core reason
  //(WebKit 240917) — see {@link PRESS_TARGET_LOCKED_STYLE}, and
  //{@link PRESS_TARGET_DISABLED_LOCKED_STYLE} for why a disabled track keeps the same
  //touch pass-through rather than going `touch-action: none`.
  const trackStyles = composeStyles({
    className,
    style,
    lockedStyle: {
      ...(isDisabled
        ? SWITCH_TRACK_DISABLED_LOCKED_STYLE
        : SWITCH_TRACK_LOCKED_STYLE),
      ...switchTrackStyle(size),
    },
  })

  return (
    <SwitchContext.Provider value={switchContext}>
      <label
        data-adaptv="switch"
        data-part="root"
        data-disabled={isDisabled ? "" : undefined}
        htmlFor={resolvedInputId}
        className={trackStyles.className || undefined}
        style={trackStyles.style}
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
          data-adaptv="switch-input"
          data-part="input"
          style={SWITCH_INPUT_LOCKED_STYLE}
        />
        {thumbChild}
      </label>
    </SwitchContext.Provider>
  )
})

Switch.displayName = "Switch"

const SwitchCompound = Object.assign(Switch, { Thumb: SwitchThumb })

export { SwitchCompound as Switch }

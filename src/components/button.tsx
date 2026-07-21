import { motion } from "motion/react"
import type { ComponentProps, ReactNode, RefObject } from "react"
import {
  Children,
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { ImpactWeight } from "#nativ/capabilities/haptics"
import { haptics } from "#nativ/capabilities/haptics"
import type {
  GestureEvent,
  OmitGestureEngineHandlers,
} from "#nativ/hooks/use-gesture-engine"
import { useGestureEngine } from "#nativ/hooks/use-gesture-engine"
import { useHapticTick } from "#nativ/hooks/use-haptic-tick"
import { useReducedMotion } from "#nativ/hooks/use-reduced-motion"
import { cn } from "#nativ/utils/cn"
import { mergeStyles } from "#nativ/utils/styles"

// Buttons are small touch targets, so widen the reentrant press region well past
// the engine's default margin — a normal thumb-roll on release (~35px, measured on
// device) must still read as "pressed" and commit the tap. Safe to be generous:
// pointer-capture keeps the gesture on this button, so a large region can't leak
// taps to neighbours — you only lose the tap by deliberately sliding far off.
const BUTTON_PRESS_OUTSET_PX = 48

/* =============================================================================
 * TYPES
 * ============================================================================= */

/**
 * Imperative API for {@link Button}. Attach with `ref`.
 *
 * | Member | Description |
 * |--------|-------------|
 * | `disabled` | Live disabled state (readonly) |
 * | `focus()` | Focus the underlying `<button>` |
 */
export type ButtonHandle = {
  readonly disabled: boolean
  focus: () => void
}

/** Shared props for {@link Button.Leading} and {@link Button.Trailing}. */
export interface ButtonSlotProps {
  /** Icon, spinner, or indicator in the slot. */
  children: ReactNode
  /** Tier 2 gutter/sizing (`pe-*`, `ps-*`, fixed widths, etc.). */
  className?: string
}

/** Props for `Button.Leading`. Must be a direct child of `<Button>`. */
export type ButtonLeadingProps = ButtonSlotProps

/** Props for `Button.Trailing`. Must be a direct child of `<Button>`. */
export type ButtonTrailingProps = ButtonSlotProps

/**
 * Props for `Button.Text`. Must be a direct child of `<Button>`.
 *
 * @example
 * ```tsx
 * <Button>
 *   <Button.Text>Search</Button.Text>
 * </Button>
 * ```
 */
export interface ButtonTextProps {
  /** Label or rich label content. */
  children: ReactNode
  /** Tier 2 typography and truncation utilities. */
  className?: string
}

/** Native `<button>` props except gesture handlers and `type` (always `button`). */
export type ButtonProps = OmitGestureEngineHandlers<
  Omit<ComponentProps<"button">, "type">
> & {
  /** Fired on pointer/keyboard release via {@link useGestureEngine}. */
  onClick?: ComponentProps<"button">["onClick"]
  /**
   * Fire a haptic on press-down (the moment of contact). `true` = light; pass a
   * weight for a firmer tap. Default off.
   *
   * Backend per platform: the native engine on a Capacitor build,
   * `navigator.vibrate` on Android/Chrome web, and — on iOS web, which has
   * neither — an invisible `<input switch>` transducer mounted on this button so
   * the user's real finger triggers the system tick.
   *
   * ⚠︎ On iOS web the weight is ignored: the system tick is the only haptic
   * WebKit exposes, and there is no way to vary it. The prop still takes a weight
   * because the other five targets honour it.
   * @see src/capabilities/haptic-tick.ts
   */
  haptic?: ImpactWeight | boolean
}

/** Resolve the {@link ButtonProps.haptic} prop to an impact weight (or none). */
export function resolveButtonHaptic(
  haptic: ImpactWeight | boolean | undefined,
): ImpactWeight | null {
  if (!haptic) return null
  return haptic === true ? "light" : haptic
}

/* =============================================================================
 * CLASSES
 * ============================================================================= */

const BUTTON_SLOT_LAYOUT_CLASS =
  "inline-flex shrink-0 items-center justify-center [&>svg]:block"
const BUTTON_TEXT_INTRINSIC_LAYOUT_CLASS =
  "inline-flex shrink-0 items-center"
const BUTTON_TEXT_FIXED_LAYOUT_CLASS = "inline-flex min-w-0 items-center"
const BUTTON_CONTENT_MEASURE_ROW_CLASS =
  "inline-flex w-max max-w-full items-center"
const BUTTON_CONTENT_MOTION_SHELL_CLASS =
  "relative inline-flex max-w-full items-center overflow-hidden"
const BUTTON_CONTENT_INNER_ROW_CLASS =
  "inline-flex w-max max-w-full items-center"
const BUTTON_ROOT_LAYOUT_CLASS =
  "inline-flex w-fit min-w-0 max-w-full items-center justify-center select-none"
const BUTTON_ROOT_SURFACE_CLASS = "bg-gray-50 text-gray-950"
const BUTTON_ROOT_INTERACTION_CLASS = "clickable"
const BUTTON_ROOT_NON_INTERACTION_CLASS = "non-clickable"

/* =============================================================================
 * CONTEXT
 * ============================================================================= */

/** Programmatic state Tier 2 reads via {@link useButton}. */
export type ButtonContextValue = {
  isDisabled: boolean
  /** Root has an explicit width utility (`w-full`, `w-64`, …) — content width does not animate. */
  hasFixedWidth: boolean
}

const ButtonContext = createContext<ButtonContextValue | null>(null)

/**
 * Reactive disabled state for {@link Button} compound trees.
 * Use in Tier 2 sub-parts when styling must track the live control state.
 */
export function useButton(): ButtonContextValue {
  const ctx = useContext(ButtonContext)
  if (ctx === null) {
    throw new Error("useButton must be used within <Button>.")
  }
  return ctx
}

/* =============================================================================
 * SLOT HELPERS
 * ============================================================================= */

function buttonSlotHasContent(children: ReactNode): boolean {
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

/* =============================================================================
 * WIDTH MODE
 * ============================================================================= */

const BUTTON_FIXED_WIDTH_UTILITY =
  /^w-(?:full|screen|min|max|\d+|\[\S+\]|\d+\/\d+)$/

function buttonUtilityBase(token: string): string {
  const colon = token.lastIndexOf(":")
  return colon === -1 ? token : token.slice(colon + 1)
}

/**
 * True when root `className` sets an explicit width (not `w-fit` / `w-auto`).
 * Responsive prefixes (`sm:w-full`, …) count.
 */
export function buttonHasFixedWidth(className?: string): boolean {
  if (!className) return false
  return className.split(/\s+/).some((token) => {
    const base = buttonUtilityBase(token)
    if (base === "w-fit" || base === "w-auto") return false
    return BUTTON_FIXED_WIDTH_UTILITY.test(base)
  })
}

/* =============================================================================
 * MOTION
 * ============================================================================= */

const BUTTON_MOTION_TRANSITION = {
  duration: 0.2,
  ease: [0, 0, 0.2, 1] as const,
}

/* =============================================================================
 * BUTTON LEADING / TRAILING
 * ============================================================================= */

/**
 * Leading icon or indicator slot. Place before {@link Button.Text} in JSX order.
 *
 * Renders nothing when `children` is empty (`null`, `false`, whitespace-only
 * text). Prefer conditional mount when the whole slot is optional:
 *
 * ```tsx
 * {pending && (
 *   <Button.Trailing className="ps-2">
 *     <Spinner />
 *   </Button.Trailing>
 * )}
 * ```
 *
 * Mounts and unmounts instantly. When the root uses intrinsic width (`w-fit`,
 * default), the content row shell tweens width on layout change.
 *
 * Put inset spacing on this slot (`pe-*`), not `gap-*` on the root — gap
 * vanishes on unmount and causes a two-step width transition.
 *
 * @example
 * ```tsx
 * <Button>
 *   <Button.Leading className="pe-2">
 *     <SearchIcon />
 *   </Button.Leading>
 *   <Button.Text>Search</Button.Text>
 * </Button>
 * ```
 */
function ButtonLeading({ children, className }: ButtonLeadingProps) {
  useButton()
  if (!buttonSlotHasContent(children)) return null

  return (
    <span aria-hidden className={cn(BUTTON_SLOT_LAYOUT_CLASS, className)}>
      {children}
    </span>
  )
}

ButtonLeading.displayName = "Button.Leading"

/**
 * Trailing icon or indicator slot. Place after {@link Button.Text} in JSX order.
 *
 * See {@link ButtonLeading} for empty-child behavior and spacing guidance.
 *
 * @example
 * ```tsx
 * <Button>
 *   <Button.Text>Run</Button.Text>
 *   {pending && (
 *     <Button.Trailing className="ps-2">
 *       <Spinner />
 *     </Button.Trailing>
 *   )}
 * </Button>
 * ```
 */
function ButtonTrailing({ children, className }: ButtonTrailingProps) {
  useButton()
  if (!buttonSlotHasContent(children)) return null

  return (
    <span aria-hidden className={cn(BUTTON_SLOT_LAYOUT_CLASS, className)}>
      {children}
    </span>
  )
}

ButtonTrailing.displayName = "Button.Trailing"

/* =============================================================================
 * BUTTON TEXT
 * ============================================================================= */

/**
 * Button label slot.
 *
 * @example
 * ```tsx
 * <Button>
 *   <Button.Text>Search</Button.Text>
 * </Button>
 * ```
 */
function ButtonText({ children, className }: ButtonTextProps) {
  const { hasFixedWidth } = useButton()

  return (
    <span
      className={cn(
        hasFixedWidth
          ? BUTTON_TEXT_FIXED_LAYOUT_CLASS
          : BUTTON_TEXT_INTRINSIC_LAYOUT_CLASS,
        className,
      )}
    >
      {children}
    </span>
  )
}

ButtonText.displayName = "Button.Text"

/* =============================================================================
 * BUTTON CONTENT ROW
 * ============================================================================= */

interface ButtonContentRowProps {
  buttonRef: RefObject<HTMLButtonElement | null>
  children: ReactNode
  hasFixedWidth: boolean
  reducedMotion: boolean
}

function buttonMeasureContentWidth(
  measureEl: HTMLSpanElement,
  buttonEl: HTMLButtonElement | null,
): number {
  const intrinsic = Math.ceil(measureEl.scrollWidth)
  if (!buttonEl) return intrinsic
  const cap = buttonEl.clientWidth
  return cap > 0 ? Math.min(intrinsic, cap) : intrinsic
}

function ButtonContentRow({
  buttonRef,
  children,
  hasFixedWidth,
  reducedMotion,
}: ButtonContentRowProps) {
  const measureRef = useRef<HTMLSpanElement>(null)
  const [contentWidth, setContentWidth] = useState(0)
  const [widthTransitionEnabled, setWidthTransitionEnabled] =
    useState(false)
  const hasScheduledWidthTransitionRef = useRef(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: reconnect observer when slot content changes
  useLayoutEffect(() => {
    if (hasFixedWidth) return
    const el = measureRef.current
    if (!el) return

    const updateWidth = () => {
      setContentWidth(buttonMeasureContentWidth(el, buttonRef.current))
    }

    updateWidth()

    const observer = new ResizeObserver(updateWidth)
    observer.observe(el)
    const button = buttonRef.current
    if (button) observer.observe(button)
    return () => observer.disconnect()
  }, [buttonRef, hasFixedWidth, children])

  // Enable width tween only after the first non-zero measure has painted — avoids
  // mount grow-from-zero (motion interpolating 0 → measured) and defer-mount
  // shrink (shell constraining the measure node before width is applied).
  useLayoutEffect(() => {
    if (hasFixedWidth) return
    if (contentWidth === 0 || hasScheduledWidthTransitionRef.current)
      return
    hasScheduledWidthTransitionRef.current = true
    const frame = requestAnimationFrame(() => {
      setWidthTransitionEnabled(true)
    })
    return () => cancelAnimationFrame(frame)
  }, [contentWidth, hasFixedWidth])

  if (hasFixedWidth || reducedMotion) {
    return (
      <span className={BUTTON_CONTENT_MEASURE_ROW_CLASS} ref={measureRef}>
        {children}
      </span>
    )
  }

  return (
    <motion.span
      className={BUTTON_CONTENT_MOTION_SHELL_CLASS}
      initial={false}
      animate={{ width: contentWidth > 0 ? contentWidth : "auto" }}
      transition={
        widthTransitionEnabled ? BUTTON_MOTION_TRANSITION : { duration: 0 }
      }
    >
      <span ref={measureRef} className={BUTTON_CONTENT_INNER_ROW_CLASS}>
        {children}
      </span>
    </motion.span>
  )
}

ButtonContentRow.displayName = "ButtonContentRow"

/* =============================================================================
 * ROOT
 * ============================================================================= */

/**
 * Primitive `<button>` composed with {@link Button.Leading}, {@link Button.Text},
 * and {@link Button.Trailing}. Children render in document order.
 *
 * Native `<button>` props are forwarded except pointer / keyboard activation
 * handlers (activation uses {@link useGestureEngine}).
 *
 * **Imperative handle** (`ref`)
 * - `ref.current.focus()` — focuses the underlying button element.
 * - `ref.current.disabled` — reflects the live disabled state (readonly).
 *
 * **Baseline styles**: neutral gray, `w-fit`, `inline-flex`. Provide variants
 * via `className` — no internal variant logic. With intrinsic width, the content
 * row tweens width when slots mount or unmount; with a fixed width on the root
 * (`w-full`, `w-64`, …), size does not animate.
 *
 * **Styling hooks** — pass `className` to the root `<button>`:
 *
 * | Attribute | When | Example |
 * |-----------|------|---------|
 * | `data-pressed` | pointer is down within the press region; reentrant (drops when the finger drags off, returns when it slides back in) and pointer-only — keyboard activation never sets it | `pressed:scale-95` |
 *
 * Press feedback rides `data-pressed`, not native `:active` — use the `pressed:`
 * variant for scale feedback (`origin-center`, instant in, ~200ms ease-out release).
 *
 * @example
 * ```tsx
 * const ref = useRef<ButtonHandle>(null)
 *
 * <Button ref={ref} disabled={isPending} aria-busy={isPending}>
 *   {isPending && (
 *     <Button.Leading className="pe-2">
 *       <Spinner />
 *     </Button.Leading>
 *   )}
 *   <Button.Text>Run</Button.Text>
 * </Button>
 * ```
 */
const Button = forwardRef<ButtonHandle, ButtonProps>(function Button(
  { className, children, disabled, onClick, haptic, ...props },
  ref,
) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const reducedMotion = useReducedMotion()

  useImperativeHandle(
    ref,
    () => ({
      get disabled() {
        return buttonRef.current?.disabled ?? false
      },
      focus() {
        buttonRef.current?.focus()
      },
    }),
    [],
  )

  const isDisabled = Boolean(disabled)
  const hasFixedWidth = buttonHasFixedWidth(className)

  //iOS web can only produce a haptic from a real finger landing on a real
  //`<input switch>`, so the `haptic` prop mounts a transducer overlay in addition
  //to firing the imperative engine below. The overlay is inert (and costs nothing)
  //on every platform that has a genuine haptic engine.
  //@see src/capabilities/haptic-tick.ts
  const attachHaptic = useHapticTick(
    !isDisabled && resolveButtonHaptic(haptic) !== null,
  )

  //one host node, two owners: the imperative handle above and the transducer.
  //Compose rather than pick — dropping either silently breaks focus() or haptics.
  const setButtonRef = useCallback(
    (el: HTMLButtonElement | null) => {
      buttonRef.current = el
      attachHaptic(el)
    },
    [attachHaptic],
  )

  const gestureEngineHandlers = useGestureEngine({
    disabled: isDisabled,
    pressOutset: BUTTON_PRESS_OUTSET_PX,
    //haptic on contact (native engine / web pulse); the tap fires on release
    onPressDown: useCallback(() => {
      const weight = resolveButtonHaptic(haptic)
      if (weight) haptics.impact(weight)
    }, [haptic]),
    onPressUp: useCallback(
      (e: GestureEvent) => {
        onClick?.(e as unknown as React.MouseEvent<HTMLButtonElement>)
      },
      [onClick],
    ),
  })

  return (
    <ButtonContext.Provider value={{ isDisabled, hasFixedWidth }}>
      <button
        ref={setButtonRef}
        type="button"
        disabled={disabled}
        aria-disabled={disabled || undefined}
        {...props}
        {...gestureEngineHandlers}
        //The interaction utility is LOCKED, the look is not. `clickable` carries
        //the `touch-action` longhand that keeps `pointercancel` alive on iOS
        //(WebKit 240917) — a consumer `touch-none` silently stranding the gesture
        //state machine is exactly the class of bug nativ exists to absorb. And a
        //DISABLED button must not be tappable no matter what className says.
        //Layout and surface stay overridable: restyling a button is the point.
        className={mergeStyles({
          base: [BUTTON_ROOT_LAYOUT_CLASS, BUTTON_ROOT_SURFACE_CLASS],
          className,
          locked: disabled
            ? BUTTON_ROOT_NON_INTERACTION_CLASS
            : BUTTON_ROOT_INTERACTION_CLASS,
        })}
      >
        <ButtonContentRow
          buttonRef={buttonRef}
          hasFixedWidth={hasFixedWidth}
          reducedMotion={reducedMotion}
        >
          {children}
        </ButtonContentRow>
      </button>
    </ButtonContext.Provider>
  )
})

Button.displayName = "Button"

/* =============================================================================
 * COMPOUND EXPORT
 * ============================================================================= */

const ButtonCompound = Object.assign(Button, {
  Leading: ButtonLeading,
  Trailing: ButtonTrailing,
  Text: ButtonText,
})

export { ButtonCompound as Button }

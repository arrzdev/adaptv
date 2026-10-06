import type {
  ComponentProps,
  CSSProperties,
  ReactNode,
  RefObject,
} from "react"
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
import type { ImpactWeight } from "#adaptv/capabilities/haptics"
import { haptics } from "#adaptv/capabilities/haptics"
import { usePressCore } from "#adaptv/components/press-core"
import { useAnimatedStyle } from "#adaptv/hooks/use-animated-style"
import type {
  GestureEvent,
  OmitGestureEngineHandlers,
} from "#adaptv/hooks/use-gesture-engine"
import { useHapticTick } from "#adaptv/hooks/use-haptic-tick"
import { useReducedMotion } from "#adaptv/hooks/use-reduced-motion"
import { composeStyles } from "#adaptv/utils/styles"

// Buttons are small touch targets, so widen the reentrant press region well past
// the engine's default margin — a normal thumb-roll on release (~35px, measured on
// device) must still read as "pressed" and commit the tap. Safe to be generous:
// pointer-capture keeps the gesture on this button, so a large region can't leak
// taps to neighbours — you only lose the tap by deliberately sliding far off.
const BUTTON_PRESS_OUTSET_PX = 48

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

//LOCKED on the slots, inline (docs/decisions/styling.md §2.0): the content row tweens
//to a MEASURED width, so a slot that shrinks or stops being an inline flex row changes
//what `scrollWidth` reports and the animation lands on the wrong size. Everything
//cosmetic about a slot — alignment, the svg display fix — is a default rule in
//styles/button.css.
const BUTTON_SLOT_LOCKED_STYLE: CSSProperties = Object.freeze({
  display: "inline-flex",
  flexShrink: 0,
  alignItems: "center",
})
//LOCKED, inline: these two ARE the width mode. `flex-shrink: 0` is what makes an
//intrinsic-width button size to its label; `min-width: 0` is what lets the label
//truncate inside a fixed one. Swapping either by hand desyncs the label from the
//root's measured width.
const BUTTON_TEXT_INTRINSIC_LOCKED_STYLE: CSSProperties = Object.freeze({
  display: "inline-flex",
  flexShrink: 0,
  alignItems: "center",
})
const BUTTON_TEXT_FIXED_LOCKED_STYLE: CSSProperties = Object.freeze({
  display: "inline-flex",
  minWidth: 0,
  alignItems: "center",
})
//The root's look, the content rows and the slot defaults are rules in
//styles/button.css, keyed on `data-adaptv` + `data-part`. Only the root carries
//`data-adaptv="button"`; each sub-part has its own `button-<part>` scope, so
//`[data-adaptv="button"]` still names exactly one element. The ⚠︎ note on why there is
//no pre-allocated transparent border lives there with the root's rule.

/**
 * A {@link Fab}'s default width is fixed — `fab.css` sizes its root — so its width
 * mode is "fixed" until the consumer's `className` names a width of its own, unprefixed
 * (`w-*` / `size-*`); then that class decides, as for any Button. A prefixed one
 * (`sm:w-auto`) leaves the default in force below its breakpoint, so it is still fixed.
 */
function fabHasFixedWidth(className?: string): boolean {
  const ownWidth = (className ?? "")
    .split(/\s+/)
    .some((token) => /^(?:w|size)-/.test(token))
  return ownWidth ? buttonHasFixedWidth(className) : true
}

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

const BUTTON_MOTION_TRANSITION = {
  duration: 0.2,
  ease: [0, 0, 0.2, 1] as const,
}
const BUTTON_MOTION_INSTANT = { duration: 0 }

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
    <span
      aria-hidden
      data-adaptv="button-leading"
      data-part="leading"
      className={className || undefined}
      style={BUTTON_SLOT_LOCKED_STYLE}
    >
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
    <span
      aria-hidden
      data-adaptv="button-trailing"
      data-part="trailing"
      className={className || undefined}
      style={BUTTON_SLOT_LOCKED_STYLE}
    >
      {children}
    </span>
  )
}

ButtonTrailing.displayName = "Button.Trailing"

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
      data-adaptv="button-label"
      data-part="label"
      className={className || undefined}
      //nothing neutral to override here — the label's only intrinsic styling IS the
      //width mode, and that is the root's `w-*` decision, not the label's
      style={
        hasFixedWidth
          ? BUTTON_TEXT_FIXED_LOCKED_STYLE
          : BUTTON_TEXT_INTRINSIC_LOCKED_STYLE
      }
    >
      {children}
    </span>
  )
}

ButtonText.displayName = "Button.Text"

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
  const shellRef = useRef<HTMLSpanElement>(null)
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

  //Imperative, not a motion component: the row wraps the app's label and slots,
  //and a motion component there would re-render the app's own motion elements
  //with every Button render and override the app's `LazyMotion`. A width it has
  //not measured yet (0) is no inline width at all, which is `auto`.
  //→ docs/decisions/animation.md §3.1
  useAnimatedStyle(
    shellRef,
    contentWidth > 0 ? { width: contentWidth } : {},
    {
      width: widthTransitionEnabled
        ? BUTTON_MOTION_TRANSITION
        : BUTTON_MOTION_INSTANT,
    },
  )

  //the row's look is styles/button.css (`content`, and the clipping `content-shell`
  //the width tween runs on); no class of adaptv's reaches either span
  if (hasFixedWidth || reducedMotion) {
    return (
      <span
        data-adaptv="button-content"
        data-part="content"
        ref={measureRef}
      >
        {children}
      </span>
    )
  }

  return (
    <span
      ref={shellRef}
      data-adaptv="button-content-shell"
      data-part="content-shell"
    >
      <span
        ref={measureRef}
        data-adaptv="button-content"
        data-part="content"
      >
        {children}
      </span>
    </span>
  )
}

ButtonContentRow.displayName = "ButtonContentRow"

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
 * **Baseline styles**: neutral gray, `w-fit`, `inline-flex`, and deliberately **no
 * pre-allocated border**. Under `box-sizing: border-box` a border that appears later
 * eats the content box and shifts the label, but reserving a transparent 1px one only
 * cancels that for a border of exactly 1px — see the ⚠︎ note on the root's rule in
 * `styles/button.css` for why it was tried and reverted. For toggled emphasis
 * (`className={selected ? "outline-orange-500" : ""}`) reach for `outline`, which never
 * participates in layout at any width and follows `border-radius`.
 * Provide variants via `className` — no internal variant logic. With intrinsic width, the content
 * row tweens width when slots mount or unmount; with a fixed width on the root
 * (`w-full`, `w-64`, …), size does not animate.
 *
 * **Styling hooks** — pass `className` to the root `<button>`:
 *
 * | Attribute | When | Example |
 * |-----------|------|---------|
 * | `data-pressed` | pointer is down within the press region; reentrant (drops when the finger drags off, returns when it slides back in) and pointer-only — keyboard activation never sets it | `active:scale-95` |
 *
 * Press feedback rides `data-pressed`, not native `:active` — but you still write
 * plain `active:`, because adaptv repoints that variant at the attribute on any
 * gesture-engine element (`origin-center`, instant in, ~200ms ease-out release).
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
  { className, style, children, disabled, onClick, haptic, ...props },
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
  //a composing Fab stamps its own scope over `button`, and with it a fixed default
  //width the consumer's className may or may not replace (fabHasFixedWidth)
  const scope = (props as { "data-adaptv"?: unknown })["data-adaptv"]
  const hasFixedWidth =
    scope === "fab"
      ? fabHasFixedWidth(className)
      : buttonHasFixedWidth(className)

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

  //the same press implementation Pressable ships — engine + the locked interaction
  //style. Button adds what a press target alone does not have: semantics, haptics,
  //slots. → src/components/press-core.ts
  const {
    handlers: gestureEngineHandlers,
    lockedStyle: pressLockedStyle,
  } = usePressCore({
    disabled: isDisabled,
    pressOutset: BUTTON_PRESS_OUTSET_PX,
    //haptic on contact (native engine / web pulse); the tap fires on release
    onPressDown: useCallback(() => {
      const weight = resolveButtonHaptic(haptic)
      if (weight) haptics.impact(weight)
    }, [haptic]),
    onPress: useCallback(
      (e: GestureEvent) => {
        onClick?.(e as unknown as React.MouseEvent<HTMLButtonElement>)
      },
      [onClick],
    ),
  })

  const merged = composeStyles({
    className,
    style,
    lockedStyle: pressLockedStyle,
  })

  return (
    <ButtonContext.Provider value={{ isDisabled, hasFixedWidth }}>
      <button
        ref={setButtonRef}
        type="button"
        disabled={disabled}
        aria-disabled={disabled || undefined}
        //the component the CONSUMER wrote; a composing primitive (Fab) overrides it
        //by passing its own, which is why this sits ahead of the `{...props}` spread
        data-adaptv="button"
        data-part="root"
        {...props}
        {...gestureEngineHandlers}
        //The interaction style is LOCKED, the look is not — `pressLockedStyle` is the
        //press core's inline `touch-action` longhand (`PRESS_TARGET_LOCKED_STYLE`, or
        //`PRESS_TARGET_DISABLED_LOCKED_STYLE` when disabled), and why it cannot be
        //overridden is documented there. Layout, surface and cursor are default rules
        //in styles/button.css (the cursor keyed on `:disabled`), so `className` is the
        //consumer's alone and restyling a button is the point.
        className={merged.className || undefined}
        style={merged.style}
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

const ButtonCompound = Object.assign(Button, {
  Leading: ButtonLeading,
  Trailing: ButtonTrailing,
  Text: ButtonText,
})

export { ButtonCompound as Button }

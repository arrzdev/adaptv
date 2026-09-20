import type { CSSProperties } from "react"
import { forwardRef, useEffect, useRef, useState } from "react"
import type { ButtonHandle, ButtonProps } from "#adaptv/components/button"
import { Button } from "#adaptv/components/button"
import { useKeyboard } from "#adaptv/hooks/use-keyboard"
import { mergeStyles } from "#adaptv/utils/styles"

/** Which screen corner {@link Fab} sits in. `end`/`start` are inline-relative, so RTL is right by construction. */
export type FabPlacement = "end" | "center" | "start"

/**
 * Props for {@link Fab}. Everything {@link Button} takes — `haptic`, `disabled`,
 * `onClick`, `className`, `style`, the slot children — plus the four knobs below.
 *
 * `hidden` is NOT the native attribute of the same name. The native one is `display:
 * none` — instant, and it takes the exit motion with it — so it is dropped from the
 * base props and redefined as the animated, still-mounted state.
 */
export interface FabProps extends Omit<ButtonProps, "hidden"> {
  /** Screen corner. Default `"end"` (bottom-trailing). */
  placement?: FabPlacement
  /**
   * Lift by the live keyboard height so the button stays reachable while a field is
   * focused. Default `true`. `false` drops the keyboard term from `bottom` entirely
   * and stops observing the keyboard.
   */
  avoidKeyboard?: boolean
  /**
   * Distance from the safe edges, in Tailwind spacing units (`calc(var(--spacing) *
   * gap)`, so it follows the consumer's `--spacing` theme value). Default `4`.
   */
  gap?: number
  /**
   * Slide the button down below the bottom safe edge and make it inert —
   * `aria-hidden`, `tabIndex -1`, `pointer-events: none` — while keeping it mounted
   * so the motion plays both ways. Default `false`.
   */
  hidden?: boolean
}

//the neutral look of a floating button; every token is a consumer's to override.
//`h-14 w-14`, NOT `size-14`: tailwind-merge's `size` group beats `w`/`h`, but a later
//`w-auto` does not remove an earlier `size-14` — both reach the DOM and Tailwind's
//print order decides (docs/decisions/styling.md §5.5). Splitting the two longhands
//is what lets the extended form's `w-auto` win through the `w` group it already owns.
const FAB_BASE_CLASS = "h-14 w-14 rounded-full shadow-lg z-40"

//LOCKED: the hide/show motion IS the behaviour, not a look. `translate` is the only
//property that moves, and `motion-reduce:` retires the transition for a user who
//asked for no motion — the button still hides, it just does not slide.
const FAB_LOCKED_CLASS =
  "transition-[translate] duration-200 ease-out motion-reduce:transition-none"

export type FabPositionOptions = {
  placement: FabPlacement
  avoidKeyboard: boolean
  gap: number
  hidden: boolean
  /**
   * How much the LAYOUT viewport has already shrunk for the keyboard, in px (default `0`).
   * The Android WebView resizes for the keyboard; iOS with the OS resize off does not. See
   * {@link useLayoutViewportShrink}.
   */
  keyboardShrink?: number
}

/**
 * The fixed placement of a {@link Fab}, as the inline style it ships. Exported for the
 * same reason `textClampStyle` (text.tsx) is: it is a pure function the tests need to read
 * directly — happy-dom's CSS parser drops a `bottom` that composes `var()` inside
 * `calc()`, and React's `style.translate` never reaches its attribute there — and a
 * consumer anchoring their own fixed element gets the exact safe-edge expression.
 *
 * Every value composes the global contract variables rather than reading `env()`:
 * `--adaptv-inset-*` (`styles/safe-area.css`, the one place `env()` may appear) and
 * `--adaptv-keyboard-height` (`styles/keyboard.css`, resting `0px`, live from
 * `useKeyboard`). Both are always defined, so no `calc()` here needs a fallback.
 */
export function fabPositionStyle({
  placement,
  avoidKeyboard,
  gap,
  hidden,
  keyboardShrink = 0,
}: FabPositionOptions): CSSProperties {
  const gapValue = `calc(var(--spacing) * ${gap})`
  //the keyboard term is a VARIABLE and not a number: the value changes at the OS's
  //animation rate, and composing it in `calc()` lets the cascade move the button on
  //every keyboard frame without a render (docs/decisions/styling.md §3.2).
  //
  //`max()`, NOT a sum. The OS keyboard covers the home indicator, so its height already
  //spans the bottom safe inset; adding the inset on top parks the button inset + gap
  //above the keyboard (50pt instead of 16pt on an iPhone 17 Pro simulator — measured
  //before this line was `max()`). Whichever obstruction is taller is the edge to clear,
  //which is the same rule AvoidKeyboard applies to its reservation.
  //
  //The keyboard term is the OVERLAP, not the OS height. The variable reports what the OS
  //raised; on a target whose layout viewport shrinks by that amount (the Android WebView,
  //measured 923 → 587 for a 336px keyboard) `bottom: 0` is already the keyboard's top
  //edge, and lifting by the full variable parks the button a keyboard's height above it.
  //Subtracting the measured shrink leaves exactly the part the viewport did not absorb:
  //0 on Android, the whole keyboard on iOS, and never below the inset thanks to `max()`.
  const keyboardTerm =
    keyboardShrink > 0
      ? `var(--adaptv-keyboard-height) - ${keyboardShrink}px`
      : "var(--adaptv-keyboard-height)"
  const bottom = avoidKeyboard
    ? `calc(max(var(--adaptv-inset-bottom), ${keyboardTerm}) + ${gapValue})`
    : `calc(var(--adaptv-inset-bottom) + ${gapValue})`
  //hidden: clear the button's own height plus everything below it (the gap, the safe
  //inset, the keyboard) so it is fully off-screen whatever the bottom edge holds
  const exit = `calc(100% + ${bottom})`

  const style: CSSProperties = { position: "fixed", bottom }

  if (placement === "center") {
    style.insetInlineStart = "50%"
    //`-50%` is the centring, and it has to survive the exit or the button drifts
    //sideways as it leaves
    style.translate = hidden ? `-50% ${exit}` : "-50% 0"
  } else {
    //the side inset pairs the same way `pe-safe`/`ps-safe` do (styles/safe-area.css)
    if (placement === "end") {
      style.insetInlineEnd = `calc(var(--adaptv-inset-right) + ${gapValue})`
    } else {
      style.insetInlineStart = `calc(var(--adaptv-inset-left) + ${gapValue})`
    }
    style.translate = hidden ? `0 ${exit}` : "0 0"
  }

  if (hidden) style.pointerEvents = "none"
  return style
}

/**
 * How far the LAYOUT viewport has shrunk since the keyboard opened, in px. `0` while
 * `active` is false, and the resting height is re-read on every resize until then.
 *
 * `--adaptv-keyboard-height` is the OS keyboard's height, and whether that height
 * OVERLAPS the page depends on the target: iOS keeps the web view's frame (the OS resize
 * is off, `docs/design/behaviors.md §4`), so the keyboard covers the bottom of the layout
 * viewport and a fixed control has to lift by all of it; the Android WebView resizes for
 * the keyboard, so the layout viewport ends where the keyboard begins and `bottom: 0` is
 * already clear. `AvoidKeyboard` measures its own box against the obstruction and never
 * sees this; a control positioned by the cascade has to subtract it. One state update per
 * resize while the keyboard is up — the frames in between still flow through the variable.
 *
 * The rest height is `innerHeight` while the keyboard is closed, so a FAB mounted with a
 * keyboard already up reads a shrink of `0` until that keyboard closes once.
 */
export function useLayoutViewportShrink(active: boolean): number {
  const restHeightRef = useRef(0)
  const [shrink, setShrink] = useState(0)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!active) {
      setShrink(0)
      const rememberRest = () => {
        restHeightRef.current = window.innerHeight
      }
      rememberRest()
      window.addEventListener("resize", rememberRest)
      return () => window.removeEventListener("resize", rememberRest)
    }
    const measure = () => {
      const rest = restHeightRef.current
      setShrink(rest > 0 ? Math.max(0, rest - window.innerHeight) : 0)
    }
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [active])

  return shrink
}

/**
 * A floating action button: a {@link Button} fixed to a screen corner, above
 * everything the page scrolls. It clears the two-quirk bar
 * (`docs/roadmap/component-gaps.md`) with three rules it owns on every target:
 *
 * | Rule | What it does |
 * |------|--------------|
 * | **Safe area** | Sits above the home indicator / navigation bar and inside the side inset, through `--adaptv-inset-*` — the contract that reads right on Android WebViews where `env()` does not |
 * | **Keyboard** | Lifts to the part of the live keyboard height that overlaps the layout viewport. On iOS the OS webview resize is off (`docs/design/behaviors.md §4`), so a fixed bottom control stays UNDER the keyboard unless it lifts by all of it; the Android WebView shrinks by the keyboard, so the overlap there is 0 and the button rides the viewport's edge. The keyboard covers the home indicator, so the bottom edge is `max(inset, overlap)` plus the gap, never their sum |
 * | **Hide/show motion** | `hidden` slides it below the bottom edge on `translate` and makes it inert, honouring `prefers-reduced-motion` |
 *
 * **The keyboard term is a CSS variable, not a number.** `useKeyboard` publishes
 * `--adaptv-keyboard-height` on `<html>` at the OS's animation rate, and the button's
 * `bottom` composes it in `calc()` — so the lift tracks the keyboard frame by frame in
 * the cascade. What React sees is the open flag, mirrored as `data-keyboard-open`, and
 * the layout viewport's own shrink ({@link useLayoutViewportShrink}), which it subtracts
 * so a target that already resized for the keyboard does not lift twice. The FAB observes the keyboard itself
 * (the hook is refcounted, so any number of observers share one publication), which is
 * why the variable is live even when nothing else on the page uses the hook.
 *
 * **Tiers.** Position is the inline-style tier (`docs/decisions/styling.md §2.1`), and
 * it is the component's: `position`, `bottom`, the inline inset, `translate` and the
 * inert `pointer-events` are `lockedStyle`, so a consumer `style` is forwarded but cannot
 * un-anchor the button. A different anchor is a different component — write your own
 * fixed element (`fabPositionStyle` gives the safe-edge expressions). The look is base
 * and fully overridable: `h-14 w-14 rounded-full shadow-lg z-40` on top of `Button`'s
 * neutral surface. The extended form is the same component with `Button.Text` children
 * and `className="w-auto px-5"` — there is no variant prop. The motion classes are
 * `locked`.
 *
 * | Attribute | When |
 * |-----------|------|
 * | `data-adaptv="fab"` | always — target every FAB from global CSS with no imports |
 * | `data-placement="end\|center\|start"` | always |
 * | `data-hidden` | `hidden` (boolean presence) |
 * | `data-keyboard-open` | the keyboard is up and `avoidKeyboard` is on (boolean presence) |
 * | `data-pressed` | inherited from {@link Button} |
 *
 * @example
 * ```tsx
 * <Fab aria-label="New task" haptic onClick={create}><Plus /></Fab>
 *
 * // extended, centred, and tucked away while the list scrolls down
 * <Fab placement="center" className="w-auto px-5" hidden={scrolledDown}>
 *   <Button.Leading className="pe-2"><Plus /></Button.Leading>
 *   <Button.Text>New task</Button.Text>
 * </Fab>
 * ```
 */
export const Fab = forwardRef<ButtonHandle, FabProps>(function Fab(
  {
    placement = "end",
    avoidKeyboard = true,
    gap = 4,
    hidden = false,
    className,
    style,
    tabIndex,
    "aria-hidden": ariaHidden,
    ...props
  },
  ref,
) {
  //`isEnabled: false` unsubscribes AND drops this observer from the refcount, so a
  //FAB that opted out never stamps "closed" over a keyboard someone else is watching
  const { isOpen: isKeyboardOpen } = useKeyboard({
    isEnabled: avoidKeyboard,
  })
  const keyboardShrink = useLayoutViewportShrink(
    avoidKeyboard && isKeyboardOpen,
  )

  const merged = mergeStyles({
    base: FAB_BASE_CLASS,
    className,
    locked: FAB_LOCKED_CLASS,
    style,
    lockedStyle: fabPositionStyle({
      placement,
      avoidKeyboard,
      gap,
      hidden,
      keyboardShrink,
    }),
  })

  return (
    <Button
      ref={ref}
      {...props}
      //`fab`, not the `button` it is built on: composition is an implementation
      //detail and must not leak into a styling hook
      data-adaptv="fab"
      data-placement={placement}
      //boolean-PRESENCE, never `="false"` (§3.1)
      data-hidden={hidden ? "" : undefined}
      data-keyboard-open={isKeyboardOpen ? "" : undefined}
      //inert while hidden: out of the accessibility tree and the tab order, and the
      //inline `pointer-events: none` above keeps a tap on the empty corner from landing
      aria-hidden={hidden ? true : ariaHidden}
      tabIndex={hidden ? -1 : tabIndex}
      className={merged.className}
      style={merged.style}
    />
  )
})

Fab.displayName = "Fab"

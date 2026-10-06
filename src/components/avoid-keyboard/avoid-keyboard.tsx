import type { CSSProperties, HTMLAttributes } from "react"
import { forwardRef, useRef } from "react"
import type { AvoidKeyboardBehavior } from "#adaptv/components/avoid-keyboard/use-keyboard-avoidance"
import { useKeyboardAvoidance } from "#adaptv/components/avoid-keyboard/use-keyboard-avoidance"
import { useMergedRef } from "#adaptv/hooks/use-merged-ref"
import { mergeStyles } from "#adaptv/utils/styles"

export interface AvoidKeyboardProps
  extends HTMLAttributes<HTMLDivElement> {
  /** How to reserve room for the keyboard. Default `"padding"`. */
  behavior?: AvoidKeyboardBehavior
  /** Scroll the focused descendant input above the keyboard. Default `true`. */
  scrollIntoView?: boolean
  /** Gap (px) kept between the input's bottom and the keyboard line. Default `24`. */
  scrollBuffer?: number
  /** Run the avoidance; `false` renders a plain `<div>`. Default `true`. */
  isEnabled?: boolean
}

/**
 * Keyboard-avoiding wrapper — the web counterpart of React Native's `KeyboardAvoidingView`.
 * Reserves room for the on-screen keyboard on the chosen box property and scrolls the focused
 * descendant input into view above it. Built for the frozen-viewport regime: hold
 * `freezeViewport` app-wide (see `RoutingShell`) so the layout height stays put, then wrap the
 * scrolling region of a full-screen form in `<AvoidKeyboard>`.
 *
 * ⚠︎ This element should BE the scroller, not sit outside one. The reservation lands here, so
 * with a separate scroller inside, `padding-bottom` shrinks that scroller instead of extending
 * its content and the focused field never clears the keyboard. Give this element the scroll
 * classes directly (`overflow-y-auto overflow-x-hidden overscroll-y-contain` plus
 * `touch-pan-x touch-pan-y touch-pinch-zoom`) — the same set `<ScrollView>` emits, and see its
 * `scrollClass` comment for why each one is load-bearing.
 *
 * - **`behavior="padding"`** (default) — reserves `padding-bottom`; be / contain the scroller.
 * - **`behavior="margin"`** — reserves `margin-bottom`; lifts a bottom-docked bar.
 *
 * It reserves room for whatever sits at the bottom — the **keyboard** when open, or the
 * **home-indicator safe area** when this element reaches the screen bottom — whichever is larger
 * (they never stack, since the keyboard already covers the safe area). That's added on top of the
 * element's resting inset, so give this element only your **design gap** (e.g. `pb-2`) and **not**
 * `pb-safe` / `py-safe-offset-*` on the bottom — the wrapper supplies the safe inset itself. That
 * keeps a single full-bleed scroller working (content and edge gradients still reach the screen
 * edge) with no outer wrapper. The top inset (notch) is never covered, so keep that on the element
 * (e.g. `pt-safe-offset-*`).
 *
 * Reservation is applied **instantly** (keyboard-initiated, never animated); the scroll-into-view
 * eases (`smooth`, or `auto` under `prefers-reduced-motion`). Inside a `<Drawer>` you don't need
 * this; the drawer handles its own avoidance.
 *
 * **Styling hooks** — `className` lands on the root `<div>`:
 *
 * | Hook | When | Example |
 * |------|------|---------|
 * | `data-keyboard-open` | present (valueless) while the keyboard is up | `data-keyboard-open:pb-4` |
 * | `--adaptv-keyboard-height` | live keyboard height (`0px` closed) | `h-[calc(100%-var(--adaptv-keyboard-height))]` |
 *
 * Both are also stamped on `<html>` by {@link useKeyboard}, so global chrome outside
 * this subtree can react too; the copies here are element-scoped for the common case.
 *
 * @example
 * ```tsx
 * <AvoidKeyboard className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-y-contain touch-pan-x touch-pan-y touch-pinch-zoom pb-2 pt-safe-offset-2">
 *   <FormFields />
 * </AvoidKeyboard>
 * ```
 */
export const AvoidKeyboard = forwardRef<
  HTMLDivElement,
  AvoidKeyboardProps
>(function AvoidKeyboard(
  {
    behavior = "padding",
    scrollIntoView = true,
    scrollBuffer,
    isEnabled = true,
    className,
    style,
    children,
    ...props
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const setRefs = useMergedRef(containerRef, ref)

  const { isKeyboardOpen, keyboardHeight, space } = useKeyboardAvoidance({
    containerRef,
    behavior,
    scrollIntoView,
    scrollBuffer,
    isEnabled,
  })

  //`space` is the full inline inset to apply while there's an obstruction, or 0 to leave the
  //element's own padding/margin untouched (no shadowing) when there's nothing to reserve
  const spacingStyle: CSSProperties | undefined =
    space > 0
      ? behavior === "margin"
        ? { marginBottom: space }
        : { paddingBottom: space }
      : undefined

  //The keyboard height is a MEASURED SCALAR, so it is a custom property and not a data
  //attribute (§3.2): the value space is continuous, and the whole point of publishing it
  //is that a consumer can compose it inside `calc()` — which an attribute cannot do.
  //
  //Both inline declarations are `lockedStyle`, and the reservation is the reason: the
  //`behavior` PROP picked `paddingBottom` vs `marginBottom`, and the value is the live
  //obstruction measured this frame. A consumer's inline `paddingBottom` landing on top
  //of it does not restyle the component, it un-reserves the space and puts the focused
  //field back under the keyboard — the one failure this component exists to prevent.
  //Padding as a CLASS is untouched and still the right way to pad this element.
  const keyboardLockedStyle = {
    ...spacingStyle,
    "--adaptv-keyboard-height": `${keyboardHeight}px`,
  } as CSSProperties

  //no default look, so no `data-adaptv` and no layer rule: the avoidance is entirely
  //inline + an attribute, and `className` is the consumer's alone
  const merged = mergeStyles({
    className,
    style,
    lockedStyle: keyboardLockedStyle,
  })

  return (
    <div
      ref={setRefs}
      className={merged.className || undefined}
      style={merged.style}
      //boolean-PRESENCE, never `="false"` (§3.1) — that is what makes v4's bare
      //`data-keyboard-open:pb-4` work instead of `data-[keyboard-open=true]:pb-4`
      data-keyboard-open={isKeyboardOpen ? "" : undefined}
      {...props}
    >
      {children}
    </div>
  )
})

AvoidKeyboard.displayName = "AvoidKeyboard"

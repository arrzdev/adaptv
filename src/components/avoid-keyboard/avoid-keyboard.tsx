import type { CSSProperties, HTMLAttributes, Ref } from "react"
import { forwardRef, useCallback, useRef } from "react"
import type { AvoidKeyboardBehavior } from "#adaptv/components/avoid-keyboard/use-keyboard-avoidance"
import { useKeyboardAvoidance } from "#adaptv/components/avoid-keyboard/use-keyboard-avoidance"
import { cn } from "#adaptv/utils/cn"

/* =============================================================================
 * TYPES
 * ============================================================================= */

export interface AvoidKeyboardProps
  extends HTMLAttributes<HTMLDivElement> {
  /** How to reserve room for the keyboard. Default `"padding"`. */
  behavior?: AvoidKeyboardBehavior
  /** Scroll the focused descendant input above the keyboard. Default `true`. */
  scrollIntoView?: boolean
  /** Gap (px) kept between the input's bottom and the keyboard line. Default `24`. */
  scrollBuffer?: number
  /** Disable all behavior (renders a plain `<div>`). Default `true`. */
  isEnabled?: boolean
}

/* =============================================================================
 * ROOT
 * ============================================================================= */

/**
 * Keyboard-avoiding wrapper — the web counterpart of React Native's `KeyboardAvoidingView`.
 * Reserves room for the on-screen keyboard on the chosen box property and scrolls the focused
 * descendant input into view above it. Built for the frozen-viewport regime: hold
 * `freezeViewport` app-wide (see `RoutingShell`) so the layout height stays put, then wrap the
 * `scrollable-y` region of a full-screen form in `<AvoidKeyboard>`.
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
 * | Attribute | When | Example |
 * |-----------|------|---------|
 * | `data-keyboard-open` | `"true"` while the keyboard is up | `data-[keyboard-open=true]:…` |
 * | `data-keyboard-height` | live keyboard height in px (`0` closed) | — |
 *
 * @example
 * ```tsx
 * <AvoidKeyboard className="flex min-h-0 flex-1 flex-col scrollable-y pb-2 pt-safe-offset-2">
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

  return (
    <div
      ref={setRefs}
      className={cn(className)}
      style={spacingStyle ? { ...style, ...spacingStyle } : style}
      data-keyboard-open={isKeyboardOpen}
      data-keyboard-height={keyboardHeight}
      {...props}
    >
      {children}
    </div>
  )
})

AvoidKeyboard.displayName = "AvoidKeyboard"

/* =============================================================================
 * REF MERGE
 * ============================================================================= */

/** Assign a DOM node to both an internal `RefObject` and a forwarded `ref`. */
function useMergedRef<T>(
  localRef: { current: T | null },
  forwardedRef: Ref<T>,
) {
  return useCallback(
    (node: T | null) => {
      localRef.current = node
      if (typeof forwardedRef === "function") forwardedRef(node)
      else if (forwardedRef) forwardedRef.current = node
    },
    [localRef, forwardedRef],
  )
}

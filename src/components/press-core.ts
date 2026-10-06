/**
 * The one press implementation — shared by {@link Button} and {@link Pressable}.
 *
 * `useGestureEngine` is the state machine; this is the *press-target contract* built
 * on it, and the reason it is a module rather than two copies of four lines:
 *
 * - **The locked interaction style is a correctness decision, not styling.**
 *   Live and disabled targets carry the SAME touch pass-through: see
 *   {@link TOUCH_PASSTHROUGH_STYLE} for why no `className` may defeat it, and
 *   {@link PRESS_TARGET_DISABLED_LOCKED_STYLE} for why a disabled one is not
 *   `touch-action: none`. Two components deciding that separately is how one of them
 *   drifts. The CURSOR is not here: it is a look, a default rule in each primitive's
 *   stylesheet, so it stays the consumer's to change.
 * - **Activation is the engine's, never the browser's.** The engine swallows the
 *   trailing native click, so a press target's callback is `onPress` and a stray
 *   `onClick` on the same node would silently never fire. Handing back the whole
 *   handler bag keeps that single-owner rule intact at every call site.
 *
 * Deliberately NOT here: haptics (Button's `haptic` prop mounts an iOS-web transducer
 * on its own host node and composes it with its imperative handle — that is Button's
 * business), semantics, and slots.
 */

import type { CSSProperties } from "react"
import type {
  GestureEvent,
  GestureHandlers,
} from "#adaptv/hooks/use-gesture-engine"
import { useGestureEngine } from "#adaptv/hooks/use-gesture-engine"

/**
 * LOCKED, as inline style (docs/decisions/styling.md §2.0). `touch-action: pan-x pan-y
 * pinch-zoom` is the longhand that keeps `pointercancel` alive on iOS (WebKit 240917):
 * without it the engine never learns a scroll took over and strands its state machine,
 * so no `className` may defeat it. Inline style is the one author tier above an
 * unlayered consumer class, which is why the lock lives here and not in the layer.
 */
export const TOUCH_PASSTHROUGH_STYLE: CSSProperties = Object.freeze({
  touchAction: "pan-x pan-y pinch-zoom",
})
/** @see TOUCH_PASSTHROUGH_STYLE — the same longhand, named for the press-target use. */
export const PRESS_TARGET_LOCKED_STYLE = TOUCH_PASSTHROUGH_STYLE
/**
 * LOCKED, disabled: an inert control's label is not selectable, and it keeps the SAME
 * touch pass-through as a live one. The cursor is not here: it is a look, so it is a
 * default rule in each primitive's stylesheet, keyed on its disabled attribute.
 *
 * This used to be `touch-action: none`, on the reasoning that a disabled target "cannot
 * be tapped whatever `className` says". Measured, that bought nothing and cost a lot:
 * `touch-action` does not control tappability at all — the engine already refuses every
 * gesture when `disabled`, and a real `<button disabled>` blocks native activation. What
 * `touch-action: none` DOES do is stop the browser treating the gesture as a scroll,
 * which turned every disabled control into a dead zone: thumb down on a greyed-out field,
 * swipe, and the page does not move. `playground/e2e/disabled-scroll.spec.ts` is the
 * measurement.
 */
export const PRESS_TARGET_DISABLED_LOCKED_STYLE: CSSProperties =
  Object.freeze({
    ...TOUCH_PASSTHROUGH_STYLE,
    WebkitUserSelect: "none",
    userSelect: "none",
  })

export type UsePressCoreOptions = {
  /** Drop every gesture and render the target as non-interactive. */
  disabled?: boolean
  /**
   * Margin (px) around the element frame within which the press stays armed.
   * Defaults to the engine's pointer-adaptive budget.
   */
  pressOutset?: number
  /** Pointer/keyboard went down on the target (the moment of contact). */
  onPressDown?: (e: GestureEvent) => void
  /** Released inside the press region — the activation. */
  onPress?: (e: GestureEvent) => void
}

export type PressCore = {
  /** Spread onto the host node. Owns activation; do not add an `onClick` beside it. */
  handlers: GestureHandlers
  /** The `lockedStyle` tier for {@link mergeStyles} — inline, wins over `className` and `style`. */
  lockedStyle: CSSProperties
}

/** Wire a node to the press engine and say which structural inline style it must carry. */
export function usePressCore({
  disabled = false,
  pressOutset,
  onPressDown,
  onPress,
}: UsePressCoreOptions): PressCore {
  const handlers = useGestureEngine({
    disabled,
    pressOutset,
    onPressDown,
    onPressUp: onPress,
  })

  return {
    handlers,
    lockedStyle: disabled
      ? PRESS_TARGET_DISABLED_LOCKED_STYLE
      : PRESS_TARGET_LOCKED_STYLE,
  }
}

/**
 * The one press implementation — shared by {@link Button} and {@link Pressable}.
 *
 * `useGestureEngine` is the state machine; this is the *press-target contract* built
 * on it, and the reason it is a module rather than two copies of four lines:
 *
 * - **The locked interaction class is a correctness decision, not styling.**
 *   Live and disabled targets carry the SAME touch pass-through: see
 *   {@link TOUCH_PASSTHROUGH_CLASS} for why no `className` may defeat it, and
 *   {@link PRESS_TARGET_DISABLED_LOCKED_CLASS} for why a disabled one is not
 *   `touch-none`. Two components deciding that separately is how one of them drifts.
 *   The CURSOR that goes with each is a separate constant, in the base tier, so it
 *   stays the consumer's to change.
 * - **Activation is the engine's, never the browser's.** The engine swallows the
 *   trailing native click, so a press target's callback is `onPress` and a stray
 *   `onClick` on the same node would silently never fire. Handing back the whole
 *   handler bag keeps that single-owner rule intact at every call site.
 *
 * Deliberately NOT here: haptics (Button's `haptic` prop mounts an iOS-web transducer
 * on its own host node and composes it with its imperative handle — that is Button's
 * business), semantics, and slots.
 */
import type {
  GestureEvent,
  GestureHandlers,
} from "#adaptv/hooks/use-gesture-engine"
import { useGestureEngine } from "#adaptv/hooks/use-gesture-engine"

/*
 * Two tiers, not one class — and that split is the whole point.
 *
 * These used to be single utilities, `clickable` / `non-clickable`, each bundling the
 * `touch-action` longhand together with a `cursor`. Because the bundle was applied as
 * `locked`, the cursor was locked too: a consumer who wanted `cursor-wait` on a
 * pending button could not have it. Worse, `cn()` did not even know the two fought, so
 * BOTH classes were emitted and the winner was decided by which one Tailwind happened
 * to print last — accidentally the consumer's, and silently the other way round the
 * day that order changes.
 *
 * `touch-action` is correctness (see below); a cursor is a look. They belong in
 * different tiers, so they are different constants.
 */

/**
 * LOCKED. `touch-action: pan-x pan-y pinch-zoom`, spelled as the three composable
 * Tailwind utilities — they each set one `--tw-*` var and share one `touch-action`
 * declaration, so together they produce exactly the longhand that keeps `pointercancel`
 * alive on iOS (WebKit 240917). Without it the engine never learns a scroll took over
 * and strands its state machine, so no `className` may defeat it.
 */
export const TOUCH_PASSTHROUGH_CLASS =
  "touch-pan-x touch-pan-y touch-pinch-zoom"
/** @see TOUCH_PASSTHROUGH_CLASS — the same longhand, named for the press-target use. */
export const PRESS_TARGET_LOCKED_CLASS = TOUCH_PASSTHROUGH_CLASS
/** BASE. The consumer's own `cursor-*` beats this through tailwind-merge's own group. */
export const PRESS_TARGET_CURSOR_CLASS = "cursor-pointer"

/**
 * LOCKED, disabled. `select-none` so an inert control's label is not selectable, and
 * the SAME touch pass-through as a live one.
 *
 * This used to be `touch-none`, on the reasoning that a disabled target "cannot be
 * tapped whatever `className` says". Measured, that bought nothing and cost a lot:
 * `touch-action` does not control tappability at all — the engine already refuses every
 * gesture when `disabled`, and a real `<button disabled>` blocks native activation — so
 * no `className` could have re-enabled it in the first place. What `touch-action: none`
 * DOES do is stop the browser treating the gesture as a scroll, which turned every
 * disabled control into a dead zone: thumb down on a greyed-out field, swipe, and the
 * page does not move. On a form with a few disabled inputs that is most of the screen.
 * `playground/e2e/disabled-scroll.spec.ts` is the measurement.
 */
export const PRESS_TARGET_DISABLED_LOCKED_CLASS = `select-none ${TOUCH_PASSTHROUGH_CLASS}`
/** BASE, disabled — overridable for the same reason as the live cursor. */
export const PRESS_TARGET_DISABLED_CURSOR_CLASS = "cursor-not-allowed"

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
  /** The `locked` layer for {@link mergeStyles} — structural, wins over `className`. */
  locked: string
  /** The `base` layer — the cursor, which a consumer's `cursor-*` must be able to beat. */
  base: string
}

/** Wire a node to the press engine and say which structural class it must carry. */
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
    locked: disabled
      ? PRESS_TARGET_DISABLED_LOCKED_CLASS
      : PRESS_TARGET_LOCKED_CLASS,
    base: disabled
      ? PRESS_TARGET_DISABLED_CURSOR_CLASS
      : PRESS_TARGET_CURSOR_CLASS,
  }
}

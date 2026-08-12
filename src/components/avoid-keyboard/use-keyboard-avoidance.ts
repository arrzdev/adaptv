import type { RefObject } from "react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { preMuteCaret } from "#adaptv/hooks/use-caret-repaint"
import { useInsets } from "#adaptv/hooks/use-insets"
import {
  useKeyboard,
  willOpenVirtualKeyboard,
} from "#adaptv/hooks/use-keyboard"
import { useReducedMotion } from "#adaptv/hooks/use-reduced-motion"

/* =============================================================================
 * TYPES
 * ============================================================================= */

/** Which box property reserves room for the keyboard. */
export type AvoidKeyboardBehavior = "padding" | "margin"

/** Default gap (px) kept between the focused input's bottom and the keyboard. */
export const DEFAULT_AVOID_KEYBOARD_SCROLL_BUFFER = 24

export type UseKeyboardAvoidanceOptions = {
  /** Wrapper whose subtree is searched for the focused input and measured for overlap. */
  containerRef: RefObject<HTMLElement | null>
  /** Box property used to reserve room. Default `"padding"`. */
  behavior?: AvoidKeyboardBehavior
  /** Scroll the focused descendant input above the keyboard. Default `true`. */
  scrollIntoView?: boolean
  /** Gap (px) kept between the input's bottom and the keyboard line. */
  scrollBuffer?: number
  /** Disable all behavior (reports closed, reserves nothing). Default `true`. */
  isEnabled?: boolean
}

export type KeyboardAvoidanceState = {
  /** `true` while a text field in the subtree holds the keyboard open. */
  isKeyboardOpen: boolean
  /** Live keyboard height in px (0 when closed). */
  keyboardHeight: number
  /** Inline inset (px) to apply below the wrapper now; `0` leaves its own padding/margin. */
  space: number
  /** The resolved reserve strategy. */
  behavior: AvoidKeyboardBehavior
}

/* =============================================================================
 * PURE GEOMETRY (DOM-free, unit-tested)
 * ============================================================================= */

/**
 * px of the wrapper hidden behind the keyboard. With `virtualKeyboard.overlaysContent` held
 * (see {@link useFreezeViewport}) the layout height stays `== window.innerHeight`, so the
 * keyboard's top edge sits at `viewportHeight - keyboardHeight`. Coords are layout-viewport
 * relative.
 */
export function resolveAvoidanceSpace({
  containerBottom,
  viewportHeight,
  keyboardHeight,
}: {
  containerBottom: number
  viewportHeight: number
  keyboardHeight: number
}): number {
  if (keyboardHeight <= 0) return 0
  const keyboardTop = viewportHeight - keyboardHeight
  return Math.max(0, containerBottom - keyboardTop)
}

/**
 * The inline inset to apply below the element, or `0` to leave its own padding/margin alone.
 *
 * When there is a bottom obstruction — the keyboard (`overlap`) or the home-indicator safe area
 * (`safeInsetBottom`), whichever is larger — we reserve `restingInset + obstruction`, re-including
 * the resting gap since the inline value replaces the class one. The two never stack: the keyboard
 * covers the safe area, so a base safe inset is not double-counted when the keyboard is up. With no
 * obstruction we return `0`, so the element's own `padding`/`margin` applies untouched (no inline
 * override shadowing it). This lets a single full-bleed scroller reserve correctly in both states.
 */
export function resolveReservedSpace({
  restingInset,
  safeInsetBottom,
  overlap,
}: {
  restingInset: number
  safeInsetBottom: number
  overlap: number
}): number {
  const obstruction = Math.max(safeInsetBottom, overlap)
  return obstruction > 0 ? restingInset + obstruction : 0
}

/**
 * `scrollTop` that brings `input` into the visible band — between the scroller's safe top
 * (`scrollerTop + topInset`, so a revealed field clears the notch / status bar rather than
 * landing behind it) and the keyboard line (the keyboard's top edge, or the scroller's own
 * bottom when that sits higher, minus `buffer`). Scrolls **either direction**: up when the
 * field dips below the keyboard, down when it sits above the safe top (field switches /
 * programmatic focus). Clamped so it never lifts the field's top past the safe top, nor pushes
 * its bottom past the keyboard line. Returns the current `scrollTop` unchanged when in view.
 */
export function computeScrollIntoViewTop({
  scrollTop,
  scrollerTop,
  scrollerBottom,
  keyboardTop,
  topInset,
  inputTop,
  inputBottom,
  buffer,
}: {
  scrollTop: number
  scrollerTop: number
  scrollerBottom: number
  keyboardTop: number
  /** px below the scroller's top that is safe-area-occluded (notch / status bar). */
  topInset: number
  inputTop: number
  inputBottom: number
  buffer: number
}): number {
  const bottomLine = Math.min(scrollerBottom, keyboardTop) - buffer
  const topLine = scrollerTop + topInset

  //below the keyboard → scroll up, but don't lift the field's top past the safe top
  if (inputBottom > bottomLine) {
    const delta = inputBottom - bottomLine
    const maxDelta = inputTop - topLine
    return scrollTop + Math.max(0, Math.min(delta, maxDelta))
  }

  //above the safe top → scroll down, but don't push the field's bottom past the keyboard
  if (inputTop < topLine) {
    const delta = topLine - inputTop
    const maxDelta = bottomLine - inputBottom
    return scrollTop - Math.max(0, Math.min(delta, maxDelta))
  }

  return scrollTop
}

/* =============================================================================
 * DOM HELPERS
 * ============================================================================= */

function isScrollable(node: Element): boolean {
  if (!(node instanceof HTMLElement)) return false

  const style = window.getComputedStyle(node)
  if (
    !/(auto|scroll)/.test(
      style.overflow + style.overflowX + style.overflowY,
    )
  ) {
    return false
  }

  return (
    node.scrollHeight > node.clientHeight ||
    node.scrollWidth > node.clientWidth
  )
}

/** Nearest scrollable ancestor of `node`, bounded to within `container` (falls back to it). */
function getScrollParentWithin(
  node: Element,
  container: HTMLElement,
): HTMLElement {
  let current: Element | null = node.parentElement

  while (current) {
    if (isScrollable(current)) return current as HTMLElement
    if (current === container) break
    current = current.parentElement
  }

  return container
}

/** Scroll `input`'s nearest in-`container` scroller so the field clears the keyboard line. */
export function scrollFocusedInputIntoView(
  container: HTMLElement,
  input: HTMLElement,
  {
    buffer,
    behavior,
    keyboardTop,
  }: { buffer: number; behavior: ScrollBehavior; keyboardTop: number },
) {
  const scroller = getScrollParentWithin(input, container)
  const scrollerRect = scroller.getBoundingClientRect()
  const inputRect = input.getBoundingClientRect()

  const top = computeScrollIntoViewTop({
    scrollTop: scroller.scrollTop,
    scrollerTop: scrollerRect.top,
    scrollerBottom: scrollerRect.bottom,
    keyboardTop,
    //the scroller's top padding (e.g. `py-safe-offset-*`) encodes the safe-area inset
    topInset:
      Number.parseFloat(getComputedStyle(scroller).paddingTop) || 0,
    inputTop: inputRect.top,
    inputBottom: inputRect.bottom,
    buffer,
  })

  if (top === scroller.scrollTop) return
  //mute the caret before the scroll's first frame. A pre-mute rather than a bracket: this
  //scroll never says when it stopped, so the quiet window has to decide.
  preMuteCaret()
  scroller.scrollTo({ top, behavior })
}

/* =============================================================================
 * HOOK
 * ============================================================================= */

/**
 * Headless keyboard avoidance for a wrapper element. Observes the on-screen keyboard
 * ({@link useKeyboard}), reports how much room to reserve below `containerRef`, and —
 * when `scrollIntoView` — scrolls the focused descendant input clear of the keyboard
 * on focus and on keyboard open. Pair with {@link useFreezeViewport} (held app-wide),
 * which keeps the layout viewport height stable so the reserved space is exact.
 */
export function useKeyboardAvoidance({
  containerRef,
  behavior = "padding",
  scrollIntoView = true,
  scrollBuffer = DEFAULT_AVOID_KEYBOARD_SCROLL_BUFFER,
  isEnabled = true,
}: UseKeyboardAvoidanceOptions): KeyboardAvoidanceState {
  const keyboard = useKeyboard({ isEnabled })
  const reducedMotion = useReducedMotion()
  const [space, setSpace] = useState(0)
  //the element's resting padding/margin (its design gap from className/style), so the
  //obstruction reservation stacks on top of it instead of replacing it
  const baseSpaceRef = useRef(0)

  //capture the resting inset once (re-read only if the strategy flips). reading it on every
  //close would re-measure our own still-applied inline override and compound the reservation
  //each open/close cycle — so it is read here, where no override is in the DOM. tradeoff: a
  //resting inset that changes after mount (e.g. a responsive breakpoint) is not re-read.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const computed = getComputedStyle(container)
    baseSpaceRef.current =
      Number.parseFloat(
        behavior === "margin"
          ? computed.marginBottom
          : computed.paddingBottom,
      ) || 0
  }, [behavior, containerRef])

  //the home-indicator inset (stable per orientation, not per keyboard). `useInsets` owns
  //the measurement now — one probe technique, one set of contract vars, and it also watches
  //the Capacitor SystemBars injection that the local `resize`/`orientationchange` pair missed.
  const { bottom: safeInsetBottom } = useInsets()

  //reserve room for the bottom obstruction — the keyboard when open, or the home-indicator
  //safe area when this element reaches the screen bottom — whichever is larger, plus the gap
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!isEnabled || !container) {
      setSpace(0)
      return
    }

    const rect = container.getBoundingClientRect()
    const overlap =
      keyboard.isOpen && keyboard.height > 0
        ? resolveAvoidanceSpace({
            containerBottom: rect.bottom,
            viewportHeight: window.innerHeight,
            keyboardHeight: keyboard.height,
          })
        : 0

    //the safe inset only applies when this element actually sits against the screen bottom;
    //a mid-screen scroller has other content below it, not the home indicator
    const reachesScreenBottom = rect.bottom >= window.innerHeight - 1

    setSpace(
      resolveReservedSpace({
        restingInset: baseSpaceRef.current,
        safeInsetBottom: reachesScreenBottom ? safeInsetBottom : 0,
        overlap,
      }),
    )
  }, [
    containerRef,
    isEnabled,
    keyboard.height,
    keyboard.isOpen,
    safeInsetBottom,
  ])

  //scroll the focused input clear of the keyboard — on focus (field switch) and on open
  useEffect(() => {
    const container = containerRef.current
    if (!isEnabled || !scrollIntoView || !container) return

    const scrollBehavior: ScrollBehavior = reducedMotion
      ? "auto"
      : "smooth"
    let frame = 0

    function scrollClear(target: HTMLElement) {
      if (!container) return
      const owner = container
      cancelAnimationFrame(frame)
      //Two frames out, reading the keyboard line fresh from visualViewport. One frame is
      //too early on iOS — WebKit runs its own focus layout first and drops our scroll; and
      //the debounced keyboard.height can lag a field-switch (no open/close event to update
      //it), so derive the line from live geometry instead of the React state.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const vv = window.visualViewport
          const keyboardTop = vv
            ? vv.offsetTop + vv.height
            : window.innerHeight
          scrollFocusedInputIntoView(owner, target, {
            buffer: scrollBuffer,
            behavior: scrollBehavior,
            keyboardTop,
          })
        })
      })
    }

    function handleFocusIn(event: FocusEvent) {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        willOpenVirtualKeyboard(target) &&
        container?.contains(target)
      ) {
        scrollClear(target)
      }
    }

    container.addEventListener("focusin", handleFocusIn)

    //the keyboard finishing its open animation for the already-focused field
    if (keyboard.isOpen && keyboard.height > 0) {
      const focused = document.activeElement
      if (
        focused instanceof HTMLElement &&
        container.contains(focused) &&
        willOpenVirtualKeyboard(focused)
      ) {
        scrollClear(focused)
      }
    }

    return () => {
      container.removeEventListener("focusin", handleFocusIn)
      cancelAnimationFrame(frame)
    }
  }, [
    containerRef,
    isEnabled,
    keyboard.height,
    keyboard.isOpen,
    reducedMotion,
    scrollBuffer,
    scrollIntoView,
  ])

  return {
    isKeyboardOpen: isEnabled && keyboard.isOpen,
    keyboardHeight: isEnabled ? keyboard.height : 0,
    space,
    behavior,
  }
}

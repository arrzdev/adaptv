import type { RefObject } from "react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  CARET_SETTLE_MS,
  preMuteCaret,
} from "#adaptv/hooks/use-caret-repaint"
import { useInsets } from "#adaptv/hooks/use-insets"
import {
  useKeyboard,
  willOpenVirtualKeyboard,
} from "#adaptv/hooks/use-keyboard"
import { useReducedMotion } from "#adaptv/hooks/use-reduced-motion"

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
  /** Gap (px) kept between the input's bottom and the keyboard line. Default `24` ({@link DEFAULT_AVOID_KEYBOARD_SCROLL_BUFFER}). */
  scrollBuffer?: number
  /** Run the avoidance; `false` reports closed and reserves nothing. Default `true`. */
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

/**
 * Scroll `input`'s nearest in-`container` scroller so the field clears the keyboard line.
 * Returns the scroller when it started a scroll, `null` when the field was already clear.
 */
export function scrollFocusedInputIntoView(
  container: HTMLElement,
  input: HTMLElement,
  {
    buffer,
    behavior,
    keyboardTop,
  }: { buffer: number; behavior: ScrollBehavior; keyboardTop: number },
): HTMLElement | null {
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

  if (top === scroller.scrollTop) return null
  //mute the caret before the scroll's first frame. A pre-mute rather than a bracket: this
  //scroll never says when it stopped, so the quiet window has to decide.
  preMuteCaret()
  scroller.scrollTo({ top, behavior })
  return scroller
}

//input that means a person has hold of the page. Any of it between an aim and the end of its
//scroll hands the scroller to them, and aiming again would drag it back out of their hands.
const USER_SCROLL_INTENT_EVENTS = [
  "touchstart",
  "pointerdown",
  "wheel",
] as const

/**
 * Call `onSettle` once, when the programmatic scroll just started on `scroller` comes to rest —
 * or never, if the user touches, clicks or wheels before it does. Returns a cancel.
 *
 * Until the first `scroll` event, the end is the caret patch's quiet window,
 * {@link CARET_SETTLE_MS}, counted from the aim itself, on every engine. A scroll that never
 * starts fires neither `scroll` nor `scrollend` (an aim past the end of a scroller already
 * clamped there, measured on both engines), and waiting for a `scrollend` that is not coming
 * would leave this armed until some later, unrelated scroll ended and aimed again then.
 *
 * Once the scroll has started, the end is `scrollend` where the engine has it. Where it does
 * not (older WebKit, which includes adaptv's iOS 15 floor), it is the same quiet window, pushed
 * out by every `scroll`. That fallback can mistake a stall for the end; a caller that re-aims
 * from fresh geometry then aims at the destination the scroll was already heading for.
 *
 * Nothing here is keyboard-specific: any surface that aims a smooth scroll and wants a second
 * look at where it landed can take it.
 */
export function onProgrammaticScrollSettled(
  scroller: HTMLElement,
  onSettle: () => void,
): () => void {
  const intent = { capture: true, passive: true } as const
  const hasScrollEnd = "onscrollend" in window
  let timer: ReturnType<typeof setTimeout> | null = null
  let done = false

  function cancel() {
    if (done) return
    done = true
    if (timer !== null) clearTimeout(timer)
    scroller.removeEventListener("scrollend", settle)
    scroller.removeEventListener("scroll", handleScroll)
    for (const type of USER_SCROLL_INTENT_EVENTS) {
      window.removeEventListener(type, cancel, intent)
    }
  }

  function settle() {
    if (done) return
    cancel()
    onSettle()
  }

  function restartQuietWindow() {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(settle, CARET_SETTLE_MS)
  }

  function handleScroll() {
    if (!hasScrollEnd) {
      restartQuietWindow()
      return
    }
    //the scroll has started, so a `scrollend` is coming: it owns the settle from here
    if (timer !== null) clearTimeout(timer)
    timer = null
    scroller.removeEventListener("scroll", handleScroll)
  }

  for (const type of USER_SCROLL_INTENT_EVENTS) {
    window.addEventListener(type, cancel, intent)
  }
  if (hasScrollEnd) scroller.addEventListener("scrollend", settle)
  scroller.addEventListener("scroll", handleScroll, { passive: true })
  restartQuietWindow()
  return cancel
}

/**
 * Headless keyboard avoidance for a wrapper element. Observes the on-screen keyboard
 * ({@link useKeyboard}), reports how much room to reserve below `containerRef`, and —
 * when `scrollIntoView` — scrolls the focused descendant input clear of the keyboard
 * on focus and on keyboard open, looking once more when that scroll ends in case content
 * arrived above the field meanwhile. Pair with {@link useFreezeViewport} (held app-wide),
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
    let cancelReaim = () => {}

    function aim(owner: HTMLElement, target: HTMLElement) {
      //the keyboard line is read fresh from visualViewport on every aim: the debounced
      //keyboard.height can lag a field-switch (no open/close event to update it)
      const vv = window.visualViewport
      const keyboardTop = vv
        ? vv.offsetTop + vv.height
        : window.innerHeight
      return scrollFocusedInputIntoView(owner, target, {
        buffer: scrollBuffer,
        behavior: scrollBehavior,
        keyboardTop,
      })
    }

    function scrollClear(target: HTMLElement) {
      if (!container) return
      const owner = container
      cancelAnimationFrame(frame)
      cancelReaim()
      //Two frames out. One frame is too early on iOS — WebKit runs its own focus layout
      //first and drops our scroll.
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          const scroller = aim(owner, target)
          //An aim picks an absolute scrollTop from the geometry of the frame it ran in. A
          //smooth scroll then spends 200-450ms getting there, and content that lands above
          //the field meanwhile (a validation message, suggestions, an image without
          //dimensions) moves the field and not the destination: it arrives short, under the
          //keyboard. So look once more when the scroll ends and aim again from what is on
          //screen then. Once: the second aim arms nothing, or a feed that keeps growing
          //would chain aims forever. Not at all under reduced motion — an instant scroll
          //has no flight for content to land in.
          if (!scroller || scrollBehavior !== "smooth") return
          const stop = onProgrammaticScrollSettled(scroller, () => {
            release()
            if (
              document.activeElement === target &&
              owner.contains(target)
            ) {
              aim(owner, target)
            }
          })
          function release() {
            stop()
            target.removeEventListener("focusout", release)
            if (cancelReaim === release) cancelReaim = () => {}
          }
          //a blur leaves nothing to aim for, so stop listening now rather than at scroll end
          target.addEventListener("focusout", release)
          cancelReaim = release
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
      cancelReaim()
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

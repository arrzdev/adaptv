import type { RefObject } from "react"
import { useEffect, useRef } from "react"
import { beginCaretHold } from "#adaptv/hooks/use-caret-repaint"
import {
  useKeyboard,
  willOpenVirtualKeyboard,
} from "#adaptv/hooks/use-keyboard"

/**
 * Headroom (px) the drawer can still rise before its top hits the max-height cap:
 * `cap - currentContentHeight`. Viewport-independent, so it stays correct regardless
 * of when the visual viewport reports the keyboard-shrunk height. Falls back to the
 * room above the drawer when no cap is set.
 */
export function measureHeightAvailableUntilMaxHeightCap(
  contentEl: HTMLElement,
): number {
  const contentHeight = contentEl.getBoundingClientRect().height
  const maxHeightPx = Number.parseFloat(
    getComputedStyle(contentEl).maxHeight,
  )

  if (Number.isFinite(maxHeightPx) && maxHeightPx > 0) {
    return Math.max(0, maxHeightPx - contentHeight)
  }

  const rect = contentEl.getBoundingClientRect()
  const viewportTop = window.visualViewport?.offsetTop ?? 0
  return Math.max(0, rect.top - viewportTop)
}

/**
 * Lift the panel up (negative) to clear the keyboard, without shrinking content.
 * Capped by how far the drawer can rise before hitting the max-height cap, and by the
 * hidden excess backing the lift. When the drawer is already at the cap there is no
 * lift — tall/multi-input drawers rely on scroll-into-view instead.
 */
export function resolveDrawerKeyboardLift(
  keyboardHeight: number,
  excessHeight: number,
  heightAvailableUntilMaxHeightCap: number,
): number {
  if (keyboardHeight <= 0) return 0
  const lift = Math.min(
    keyboardHeight,
    Math.max(0, heightAvailableUntilMaxHeightCap),
    excessHeight,
  )
  return -lift
}

export function scrollDrawerInputIntoView(
  scroller: HTMLElement,
  focusedElement: HTMLElement,
  container?: HTMLElement,
) {
  const inputRect = focusedElement.getBoundingClientRect()
  const containerRect = (container ?? scroller).getBoundingClientRect()
  const scrollTarget = Math.max(
    inputRect.top -
      containerRect.top +
      scroller.scrollTop -
      inputRect.height,
    0,
  )

  //mute the caret before the smooth scroll's first frame; releasing immediately is safe —
  //the scroll's own events keep it muted until the movement settles
  const releaseCaretHold = beginCaretHold()
  scroller.scrollTo({ top: scrollTarget, behavior: "smooth" })
  releaseCaretHold()
}

type UseDrawerKeyboardAvoidanceOptions = {
  containerRef: RefObject<HTMLElement | null>
  scrollerRef: RefObject<HTMLElement | null>
  isEnabled: boolean
  onWillOpenKeyboard: () => void | Promise<void>
}

/** Drawer-internal keyboard avoidance: snap-open on focus + scroll the field into view. */
export function useDrawerKeyboardAvoidance({
  containerRef,
  scrollerRef,
  isEnabled,
  onWillOpenKeyboard,
}: UseDrawerKeyboardAvoidanceOptions) {
  const keyboard = useKeyboard({ isEnabled })

  const onWillOpenKeyboardRef = useRef(onWillOpenKeyboard)
  onWillOpenKeyboardRef.current = onWillOpenKeyboard

  useEffect(() => {
    if (!isEnabled) return

    //abort flag: a snap resolved after the drawer disables/closes must not run, or it
    //would animate toward open and fight the in-flight close transform.
    let cancelled = false

    async function handleFocusIn(event: FocusEvent) {
      const container = containerRef.current
      if (
        !(event.target instanceof HTMLElement) ||
        !willOpenVirtualKeyboard(event.target) ||
        !container?.contains(event.target)
      ) {
        return
      }

      const snap = onWillOpenKeyboardRef.current()
      if (snap instanceof Promise) await snap
      //bail on any post-await follow-up if the drawer disabled/closed mid-snap
      if (cancelled) return
    }

    document.addEventListener("focusin", handleFocusIn)
    return () => {
      cancelled = true
      document.removeEventListener("focusin", handleFocusIn)
    }
  }, [containerRef, isEnabled])

  useEffect(() => {
    if (!isEnabled || !keyboard.isOpen) return

    const container = containerRef.current
    const scroller = scrollerRef.current
    const focused = document.activeElement

    if (
      !container ||
      !scroller ||
      !(focused instanceof HTMLElement) ||
      !container.contains(focused) ||
      !willOpenVirtualKeyboard(focused)
    ) {
      return
    }

    const frame = requestAnimationFrame(() => {
      scrollDrawerInputIntoView(scroller, focused, container)
    })

    return () => cancelAnimationFrame(frame)
  }, [containerRef, isEnabled, keyboard.isOpen, scrollerRef])

  return keyboard
}

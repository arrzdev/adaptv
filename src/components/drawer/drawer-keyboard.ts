import type { RefObject } from "react"
import { useEffect, useRef } from "react"
import { DRAWER_TRANSITIONS } from "#adaptv/components/drawer/drawer-constants"
import { preMuteCaret } from "#adaptv/hooks/use-caret-repaint"
import {
  useKeyboard,
  willOpenVirtualKeyboard,
} from "#adaptv/hooks/use-keyboard"

export type DrawerKeyboardRoom = {
  /** Empty space held BELOW the content stack, so handle/scroller/footer clear the keyboard. */
  room: number
  /** Box height allowed while that room is held — the growth that keeps the same amount of
   *  content visible, capped by the stylesheet's own cap. */
  maxHeight: number
  /** Floor to hold the box at while it eases DOWN, or `null` to release it. A cap cannot animate a
   *  shrink: once the content is shorter than the box, the content is the binding constraint and
   *  `max-height` is not touching anything. Only a floor can hold the box up while the content
   *  collapses underneath it. */
  minHeight?: number | null
}

/**
 * What the content box should look like for a keyboard of `keyboardHeight`.
 *
 * The sheet grows to what it needs and no more, so a keyboard is not something to move away
 * from — it is a slice of the bottom that stops being usable. Hold that slice as empty room
 * under the stack and let the box grow by the same amount to pay for it: the content that was
 * visible stays visible, and where the cap refuses the growth the scroller absorbs it and the
 * remainder stays reachable by scrolling.
 *
 * `keyboardHeight` 0 is the resting case and returns the box's own clamped height, which is
 * what the return animation aims at.
 */
export function resolveDrawerKeyboardRoom(
  keyboardHeight: number,
  naturalHeight: number,
  cap: number,
): DrawerKeyboardRoom {
  const room = Math.max(0, keyboardHeight)
  return { room, maxHeight: Math.min(naturalHeight + room, cap) }
}

/**
 * Whether the keyboard has already been paid for by the viewport itself — the case the room
 * mechanism must NOT run, because reserving `room` on top of a shrink double-counts: the sheet
 * grows by the keyboard's height a second time, holds a keyboard-sized blank band above the
 * keyboard, and its footer lands below the visible viewport.
 *
 * `useFreezeViewport` normally keeps the layout height whole while a drawer is up (iOS scroll-lock,
 * or Chromium's `virtualKeyboard.overlaysContent`), so the sheet answers the keyboard by holding
 * `room` below its content and growing into it. But `virtualKeyboard` is a secure-context-only API,
 * so over a plain-http `ip:port` origin (a LAN dev build) there is no freeze on Chromium: the
 * keyboard shrinks the visual viewport itself. Reserving room ON TOP of that shrink double-counts —
 * the sheet grows by the keyboard's height a second time and its top climbs off-screen behind the
 * URL bar. iOS still freezes (scroll-lock needs no API) and a native binary carrying the Keyboard
 * plugin reports an exact height without shrinking, so both stay on the room path; only VK-less
 * non-iOS Chromium falls here, and that includes a native Android binary WITHOUT the plugin, whose
 * WebView resizes itself like any other.
 */
export function viewportShrinksUnderKeyboard({
  isIOS,
  hasNativeKeyboard,
  hasVirtualKeyboardApi,
  keyboardHeight = 0,
  layoutShrink = 0,
  capHeld = false,
}: {
  isIOS: boolean
  hasNativeKeyboard: boolean
  hasVirtualKeyboardApi: boolean
  keyboardHeight?: number
  layoutShrink?: number
  capHeld?: boolean
}): boolean {
  if (capHeld) return true
  if (
    keyboardHeight > 0 &&
    layoutShrinkCoversKeyboard(keyboardHeight, layoutShrink)
  ) {
    return true
  }
  return !isIOS && !hasNativeKeyboard && !hasVirtualKeyboardApi
}

/** Sub-pixel slack between the plugin's reported height and the WebView's inset padding. */
const LAYOUT_SHRINK_TOLERANCE_PX = 1

function layoutShrinkCoversKeyboard(
  keyboardHeight: number,
  layoutShrink: number,
): boolean {
  return layoutShrink >= keyboardHeight - LAYOUT_SHRINK_TOLERANCE_PX
}

/**
 * The part of the keyboard the sheet still has to hold room for: its height minus what the layout
 * viewport already gave up. Whole on iOS (shrink 0), zero on the Android WebView (shrink equals the
 * height, and the cap path runs instead), the remainder anywhere a viewport shrinks by less than the
 * keyboard — an old WebView that keeps its nav-bar inset inside the reported height, say.
 */
export function unpaidKeyboardHeight(
  keyboardHeight: number,
  layoutShrink: number,
): number {
  return Math.max(0, keyboardHeight - Math.max(0, layoutShrink))
}

/**
 * The box's `max-height` on the {@link viewportShrinksUnderKeyboard} path: fit the LAYOUT viewport,
 * which is what shrank. It has already lost the keyboard, so the sheet holds no room — it just caps
 * at what is on screen (content taller than that scrolls inside), clamped by the stylesheet's own
 * cap. Not the visual viewport: while the IME animates, the Android WebView's `visualViewport`
 * passes through values far below the layout height (measured 250.67 with `innerHeight` already at
 * 587, settling to 587.05 a frame later), and a cap read from it pins the sheet at a fraction of the
 * screen with nothing to re-read it once the value settles. `null` while the keyboard is closed:
 * nothing to constrain, so the box rides the stylesheet cap and follows its own content.
 */
export function resolveShrunkViewportCap(
  keyboardOpen: boolean,
  layoutViewportHeight: number,
  cssCap: number,
): number | null {
  if (!keyboardOpen || layoutViewportHeight <= 0) return null
  return Math.min(cssCap, layoutViewportHeight)
}

/**
 * The stylesheet's cap as it resolves NOW, with the engine's inline override lifted for the read
 * and put back. The cap is written in viewport units (`100vh - inset-top` installed, `97dvh` in a
 * tab), so it changes when the viewport does: a value cached at rest (869 on a 923px viewport) is
 * wrong once the WebView has shrunk to 587, where the same rule resolves to 533. One extra style
 * resolution per keyboard event, never per frame.
 */
export function readDrawerStylesheetCap(contentEl: HTMLElement): number {
  const inline = contentEl.style.maxHeight
  contentEl.style.maxHeight = ""
  const parsed = Number.parseFloat(getComputedStyle(contentEl).maxHeight)
  contentEl.style.maxHeight = inline
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

/**
 * Whether focusing a field should PIN a `min-height` floor at the box's current height, ahead of
 * the keyboard.
 *
 * The flicker this closes: a wheel/date picker is open inside the drawer with NO keyboard yet — so
 * no room is held — and the user taps a text input. Two geometry changes then fire on DIFFERENT
 * frames: the picker collapses (content SHRINKS) on the focus frame, and the keyboard's height
 * arrives a frame or two later (room GROWS). With no room held the collapse cannot ride the
 * keyboard-room effect — that path early-returns at room 0 — so the box shrinks raw and the sheet's
 * top DROPS, then snaps back UP when the keyboard grows it. `focus` is the earliest signal the
 * keyboard is imminent; pinning a floor there holds the top across the gap, and the keyboard-room
 * effect's `heldFloor` path then EASES that floor to the final height in one motion.
 *
 * Only in that exact state — the sheet at content height with nothing engine-owned. If `room` is
 * already held (a field switch with the keyboard already up) the reaim path already floors the
 * collapse; if a floor or cap is already set the engine is mid-motion and must not be perturbed.
 * `enabled` folds in `open && avoidKeyboard` and a field that actually raises a keyboard (a
 * readonly/disabled input raises none, so a floor there would only ever have to retract).
 */
export function shouldPrimeKeyboardFloor({
  enabled,
  isClosing,
  roomHeld,
  floorHeld,
  capHeld,
}: {
  enabled: boolean
  isClosing: boolean
  roomHeld: boolean
  floorHeld: boolean
  capHeld: boolean
}): boolean {
  return enabled && !isClosing && !roomHeld && !floorHeld && !capHeld
}

/**
 * The height the content box would take with no cap and no room held — its own content's height.
 *
 * Summed from the box's CHILDREN, not derived from the box. The derived form (`box - room +
 * hidden`, where `hidden` is the scroller's `scrollHeight - clientHeight`) subtracts two numbers
 * that update on different frames: `clientHeight` moves every frame while the box animates,
 * `scrollHeight` does not, so at the moment the box crosses from uncapped to capped the pair
 * disagree for one observation and the result dips. That dip reads as a content shrink that never
 * happened — harmless when it only rewrites the same cap, actively wrong for anything that pins a
 * height off it. Every term below is stable under our own animation: the fixed-size siblings do
 * not move, and a scroller's `scrollHeight` is its content's height regardless of the box around it.
 */
export function measureDrawerContentNaturalHeight(
  contentEl: HTMLElement,
  scrollerEl: HTMLElement | null,
  appliedRoom: number,
): number {
  if (!scrollerEl) {
    return Math.max(
      0,
      contentEl.getBoundingClientRect().height - appliedRoom,
    )
  }
  let total = 0
  for (const child of contentEl.children) {
    total +=
      child === scrollerEl
        ? scrollerEl.scrollHeight
        : child.getBoundingClientRect().height
  }
  return Math.max(0, total)
}

/** The room currently painted on the box — the live interpolated value mid-transition. */
export function readDrawerKeyboardRoom(contentEl: HTMLElement): number {
  const raw = Number.parseFloat(getComputedStyle(contentEl).paddingBottom)
  return Number.isFinite(raw) ? raw : 0
}

export function writeDrawerKeyboardRoom(
  contentEl: HTMLElement,
  { room, maxHeight, minHeight }: DrawerKeyboardRoom,
  transition: string,
) {
  contentEl.style.transition = transition
  contentEl.style.paddingBottom = `${room}px`
  contentEl.style.maxHeight = `${maxHeight}px`
  if (minHeight !== undefined) {
    contentEl.style.minHeight = minHeight === null ? "" : `${minHeight}px`
  }
}

/** Hand the box back to the stylesheet — no room, no engine-owned cap, no transition. */
export function clearDrawerKeyboardRoom(contentEl: HTMLElement) {
  contentEl.style.transition = ""
  contentEl.style.paddingBottom = ""
  contentEl.style.maxHeight = ""
  contentEl.style.minHeight = ""
}

/**
 * Bring a focused field into view — and do NOTHING when it is already there.
 *
 * This used to align the field to the top of the scroller unconditionally, which is not the same
 * thing. A field sitting 40px down (its label, the shell's padding) at `scrollTop: 0` is perfectly
 * visible, yet aligning it scrolled 40px anyway: the label slid under the drag handle and the
 * field's own top edge went with it. That is the "why did it scroll a little" — it was never
 * avoiding an obstacle, just obeying an instruction to put the field at the top.
 *
 * Scroll only when the field is actually outside the comfortable window, and then by the smallest
 * amount that fixes it.
 */
export function scrollDrawerInputIntoView(
  scroller: HTMLElement,
  focusedElement: HTMLElement,
) {
  const MARGIN = 12
  const inputRect = focusedElement.getBoundingClientRect()
  const scrollerRect = scroller.getBoundingClientRect()

  //field position in the scroller's own content coordinates
  const inputTop = inputRect.top - scrollerRect.top + scroller.scrollTop
  const inputBottom = inputTop + inputRect.height
  const viewTop = scroller.scrollTop
  const viewBottom = viewTop + scroller.clientHeight

  const above = inputTop < viewTop + MARGIN
  const below = inputBottom > viewBottom - MARGIN
  if (!above && !below) return

  //nudge to whichever edge it fell off, never further
  const target = above
    ? inputTop - MARGIN
    : inputBottom - scroller.clientHeight + MARGIN
  const clamped = Math.max(
    0,
    Math.min(target, scroller.scrollHeight - scroller.clientHeight),
  )
  if (Math.abs(clamped - scroller.scrollTop) < 1) return

  //mute the caret before the smooth scroll's first frame. A pre-mute rather than a bracket:
  //a smooth scroll never says when it stopped, so the quiet window has to decide — its own
  //scroll events keep the caret muted until the movement settles.
  preMuteCaret()
  scroller.scrollTo({ top: clamped, behavior: "smooth" })
}

type UseDrawerKeyboardAvoidanceOptions = {
  containerRef: RefObject<HTMLElement | null>
  scrollerRef: RefObject<HTMLElement | null>
  isEnabled: boolean
  /** Fired on `focusin` for a keyboard-opening field inside the drawer — the earliest the sheet
   *  knows a keyboard is imminent. Receives the focused field so the engine can prime a height
   *  floor ahead of the picker collapse (see `shouldPrimeKeyboardFloor`). */
  onWillOpenKeyboard: (field: HTMLElement) => void | Promise<void>
}

/** Drawer-internal keyboard avoidance: snap-open on focus + scroll the field into view. */
export function useDrawerKeyboardAvoidance({
  containerRef,
  scrollerRef,
  isEnabled,
  onWillOpenKeyboard,
}: UseDrawerKeyboardAvoidanceOptions) {
  //predict the lift from the learned height cache: the sheet starts moving on the same frame as the
  //focus tap, and the real visualViewport measurement then confirms or corrects it. A cold cache
  //(first ever open of this field shape) simply falls back to the reactive path — no behaviour
  //change until a height has been learned.
  const keyboard = useKeyboard({ isEnabled, predictFromCache: true })

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

      const snap = onWillOpenKeyboardRef.current(event.target)
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

    // Twice: once now so the field is heading into view immediately, and once after the sheet has
    // finished resizing. The first pass aims at geometry that is still moving — the box grows for
    // the length of the transition — so on its own it lands the field a little too high and the
    // sheet's edge clips it.
    const frame = requestAnimationFrame(() => {
      scrollDrawerInputIntoView(scroller, focused)
    })
    const settled = setTimeout(
      () => {
        scrollDrawerInputIntoView(scroller, focused)
      },
      DRAWER_TRANSITIONS.DURATION * 1000 + 40,
    )

    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(settled)
    }
  }, [containerRef, isEnabled, keyboard.isOpen, scrollerRef])

  return keyboard
}

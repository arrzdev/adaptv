import { useLayoutEffect } from "react"
import {
  getVirtualKeyboardApi,
  willOpenVirtualKeyboard,
} from "#nativ/hooks/use-keyboard"
import { isIOS } from "#nativ/utils/platform"

/*
 * Freezes the layout viewport while an overlay (drawer, chat composer, …) is up so the
 * on-screen keyboard pads only the overlay's own scroller instead of shoving the page.
 * Two refcounted globals so nested/stacked users coexist:
 *   1. scroll lock  — pins the document (iOS-specific touch handling on Safari)
 *   2. vk overlay   — sets virtualKeyboard.overlaysContent so the layout height holds
 */

//touch travel (px) past which a touch is a scroll, not a tap — beyond this we must
//not hijack the gesture into focusing the field it happens to lift off over.
const TAP_MOVE_SLOP_PX = 10

//touches starting this close to a screen edge are OS edge-swipe (back/forward)
//candidates; the vertical scroll lock leaves them alone so the gesture survives
const EDGE_SWIPE_ZONE_PX = 24

//offscreen nudge to coax WebKit into raising the keyboard without a visible jump.
//viewport-relative (one full viewport + a margin) so it always clears the screen,
//even on tall viewports a fixed magic offset could fall short of.
const OFFSCREEN_NUDGE_MARGIN_PX = 200

function offscreenNudgeTransform() {
  const viewportHeight =
    window.visualViewport?.height ?? window.innerHeight
  return `translateY(-${Math.ceil(viewportHeight) + OFFSCREEN_NUDGE_MARGIN_PX}px)`
}

let scrollLockCount = 0
let restoreScrollLock: (() => void) | null = null

let virtualKeyboardOverlayUsers = 0
let initialVirtualKeyboardOverlaysContent: boolean | null = null

//---- Helpers ----------------

function setStyle(element: HTMLElement, property: string, value: string) {
  const previous = element.style.getPropertyValue(property)
  element.style.setProperty(property, value)
  return () => {
    if (previous) element.style.setProperty(property, previous)
    else element.style.removeProperty(property)
  }
}

function chainRestorers(...restorers: Array<(() => void) | undefined>) {
  return () => {
    for (const restore of restorers) restore?.()
  }
}

function isScrollable(node: Element, checkOverflow: boolean) {
  if (!(node instanceof HTMLElement)) return false

  const style = window.getComputedStyle(node)
  let scrollable = /(auto|scroll)/.test(
    style.overflow + style.overflowX + style.overflowY,
  )

  if (scrollable && checkOverflow) {
    scrollable =
      node.scrollHeight !== node.clientHeight ||
      node.scrollWidth !== node.clientWidth
  }

  return scrollable
}

function getScrollParent(node: Element, checkOverflow: boolean) {
  let current: Element | null = node

  if (
    current instanceof HTMLElement &&
    isScrollable(current, checkOverflow)
  ) {
    current = current.parentElement
  }

  while (current && !isScrollable(current, checkOverflow)) {
    current = current.parentElement
  }

  return current ?? document.scrollingElement ?? document.documentElement
}

function lockScrollStandard() {
  return chainRestorers(
    setStyle(
      document.documentElement,
      "padding-right",
      `${window.innerWidth - document.documentElement.clientWidth}px`,
    ),
    setStyle(document.documentElement, "overflow", "hidden"),
  )
}

//react-modal-sheet: lock window scroll on iOS so keyboard only pads the overlay scroller
function lockScrollMobileSafari() {
  let scrollable: Element | undefined
  let touchMoved = false
  let touchStartX = 0
  let touchStartY = 0
  let edgeSwipe = false

  function onTouchStart(event: TouchEvent) {
    const touch = event.changedTouches[0]
    touchMoved = false
    touchStartX = touch?.clientX ?? 0
    touchStartY = touch?.clientY ?? 0

    const target = event.composedPath()[0]
    scrollable = getScrollParent(target as Element, true)

    //a touch born in the left/right edge strip is a horizontal OS edge-swipe
    //candidate — flag it so onTouchMove won't pin it (see the carve there)
    edgeSwipe =
      touchStartX <= EDGE_SWIPE_ZONE_PX ||
      touchStartX >= window.innerWidth - EDGE_SWIPE_ZONE_PX
  }

  function onTouchMove(event: TouchEvent) {
    //flag a real drag before any early return so touchend can tell scroll from tap
    const moveTouch = event.changedTouches[0]
    if (
      moveTouch &&
      (Math.abs(moveTouch.clientX - touchStartX) > TAP_MOVE_SLOP_PX ||
        Math.abs(moveTouch.clientY - touchStartY) > TAP_MOVE_SLOP_PX)
    ) {
      touchMoved = true
    }

    if (!scrollable) return

    //a touch over a non-scrollable region resolves to document/body — pin it so the
    //page can't scroll/shift. a real inner scroller is left alone to scroll +
    //rubber-band natively; overscroll-behavior:contain on the scroll utilities
    //keeps that bounce from bleeding to the page (replacing the old
    //boundary-preventDefault that killed pull-to-overscroll at rest)
    if (
      scrollable === document.documentElement ||
      scrollable === document.body
    ) {
      //the freeze lock is a vertical patch — never eat a horizontal OS edge-swipe.
      //away from the edges, pin as before. in standalone the swipe is inert anyway
      //(memory history = no entry to navigate to); a browser tab navigates normally
      if (!edgeSwipe) event.preventDefault()
    }
  }

  function onTouchEnd(event: TouchEvent) {
    //a scroll that happens to release over a field must not focus it / raise the keyboard
    if (touchMoved) return

    const target = event.composedPath()[0]
    if (
      target instanceof HTMLElement &&
      willOpenVirtualKeyboard(target) &&
      target !== document.activeElement
    ) {
      event.preventDefault()
      target.style.transform = offscreenNudgeTransform()
      target.focus()
      requestAnimationFrame(() => {
        target.style.transform = ""
      })
    }
  }

  //raise the keyboard without a visible jump by nudging the field off-screen and back.
  //no scroll-into-view here — that's opt-in, owned per-surface by AvoidKeyboard / Drawer.
  function onFocus(event: FocusEvent) {
    const target = event.composedPath()[0]
    if (
      !(target instanceof HTMLElement) ||
      !willOpenVirtualKeyboard(target)
    ) {
      return
    }

    target.style.transform = offscreenNudgeTransform()
    requestAnimationFrame(() => {
      target.style.transform = ""
    })
  }

  function onWindowScroll() {
    window.scrollTo(0, 0)
  }

  const scrollX = window.pageXOffset
  const scrollY = window.pageYOffset

  const restoreStyles = chainRestorers(
    setStyle(
      document.documentElement,
      "padding-right",
      `${window.innerWidth - document.documentElement.clientWidth}px`,
    ),
    setStyle(document.documentElement, "overflow", "hidden"),
    setStyle(document.body, "margin-top", `-${scrollY}px`),
  )

  window.scrollTo(0, 0)

  document.addEventListener("touchstart", onTouchStart, {
    passive: false,
    capture: true,
  })
  document.addEventListener("touchmove", onTouchMove, {
    passive: false,
    capture: true,
  })
  document.addEventListener("touchend", onTouchEnd, {
    passive: false,
    capture: true,
  })
  document.addEventListener("focus", onFocus, true)
  window.addEventListener("scroll", onWindowScroll)

  return () => {
    restoreStyles()
    document.removeEventListener("touchstart", onTouchStart, true)
    document.removeEventListener("touchmove", onTouchMove, true)
    document.removeEventListener("touchend", onTouchEnd, true)
    document.removeEventListener("focus", onFocus, true)
    window.removeEventListener("scroll", onWindowScroll)
    window.scrollTo(scrollX, scrollY)
  }
}

function enableScrollLock() {
  scrollLockCount++
  if (scrollLockCount !== 1) return

  restoreScrollLock = isIOS()
    ? lockScrollMobileSafari()
    : lockScrollStandard()
}

function disableScrollLock() {
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount !== 0) return

  restoreScrollLock?.()
  restoreScrollLock = null
}

//---- virtualKeyboard overlay ----------------

/** Imperatively opt the document into `virtualKeyboard.overlaysContent`; returns a release fn. */
function acquireVirtualKeyboardOverlay() {
  const vk = getVirtualKeyboardApi()
  if (!vk) return () => {}

  if (virtualKeyboardOverlayUsers === 0) {
    initialVirtualKeyboardOverlaysContent = vk.overlaysContent
    vk.overlaysContent = true
  }

  virtualKeyboardOverlayUsers++

  return () => {
    virtualKeyboardOverlayUsers = Math.max(
      0,
      virtualKeyboardOverlayUsers - 1,
    )

    if (virtualKeyboardOverlayUsers === 0) {
      vk.overlaysContent = initialVirtualKeyboardOverlaysContent ?? false
      initialVirtualKeyboardOverlaysContent = null
    }
  }
}

//---- Hook ----------------

/**
 * Freeze the layout viewport so the keyboard / url bar can't shift the page,
 * while `isEnabled`. Applies *every* strategy this browser supports, layered
 * (they stack; each is refcounted and self-no-ops where unavailable):
 *   - document scroll-lock — pins the page, all browsers (does the work on iOS)
 *   - virtualKeyboard overlay — Chromium only; keeps layout height when the
 *     keyboard opens, so it overlays instead of resizing. No-op on iOS/WebKit.
 *
 * Refcounted, so callers stack: hold it app-wide for a globally locked viewport,
 * and an opening drawer just reinforces the same lock (and stands alone if the
 * app never locked globally). Pair with {@link useKeyboard} to drive
 * keyboard-aware layout yourself.
 */
export function useFreezeViewport(isEnabled = true) {
  useLayoutEffect(() => {
    if (!isEnabled) return
    enableScrollLock()
    const releaseOverlay = acquireVirtualKeyboardOverlay()
    return () => {
      releaseOverlay()
      disableScrollLock()
    }
  }, [isEnabled])
}

import { useMotionValue } from "motion/react"
import type {
  CSSProperties,
  ReactNode,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import {
  DEFAULT_DRAWER_TRANSITION,
  DRAWER_CLOSE_TRANSITION,
  DRAWER_SHRINK_TRANSITION,
  dampenDrawerPull,
  resolveDrawerDragRelease,
} from "#nativ/components/drawer/drawer-constants"
import {
  measureHeightAvailableUntilMaxHeightCap,
  resolveDrawerKeyboardLift,
  useDrawerKeyboardAvoidance,
} from "#nativ/components/drawer/drawer-keyboard"
import type { DrawerMotionAnimation } from "#nativ/components/drawer/drawer-motion"
import {
  animateDrawerKeyboardOffset,
  animateDrawerY,
  applyDrawerPanelTransition,
  clearDrawerPanelTransition,
  readPanelTranslateY,
  stopDrawerBackdropAnimation,
  stopDrawerKeyboardOffsetAnimation,
  transitionDrawerBackdropOpacity,
  willAnimateDrawerKeyboardOffset,
} from "#nativ/components/drawer/drawer-motion"
import { useFreezeViewport } from "#nativ/hooks/use-freeze-viewport"
import { dismissVirtualKeyboard } from "#nativ/hooks/use-keyboard"
import { clamp } from "#nativ/utils/clamp"
import { cn } from "#nativ/utils/cn"

//Unmount as soon as the close settles (the snappy close ends with the panel off-screen, so
//there's no last frame to wait for). Keeping the panel mounted past that left the overlay
//blocking the page while nothing was visible.
const DRAWER_EXIT_UNMOUNT_DELAY_MS = 0

//Closing from a keyboard lift, over-translate the slide by this much so the consumer restoring its
//bottom padding as the keyboard dismisses stays hidden without a mid-close re-aim (covers safe-area
//insets). It lands off-screen, so it's invisible. Gated to keyboard closes — plain closes don't grow.
const DRAWER_CLOSE_OVERTRAVEL_PX = 64

// A visual viewport this many px shorter than the layout viewport means the on-screen
// keyboard is covering the bottom (well below any browser-chrome delta, well under a
// keyboard's height). While it covers, we freeze the panel's `excessHeight` anchor —
// see updateMetrics.
const KEYBOARD_COVERAGE_PX = 120

// The hidden panel tail below the fold (`bottom: -excess` + an equal spacer) only exists to
// back the keyboard lift, which never exceeds the keyboard's own height — and iOS keyboards
// top out around ~45% of the viewport including the accessory bar. Reserving a FULL viewport
// (the old behavior) made the panel's rasterized GPU layer 2-3× its visible pixels, inflating
// every promote/demote re-raster. A too-small reserve degrades gracefully: the uncovered
// remainder becomes `shortfall`, which the keyboard-scroll-space path already absorbs.
const DRAWER_EXCESS_HEIGHT_CAP_FRACTION = 0.55

//shell stacking: edge fades z-20, drawer z-50/51, splash z-100
const DRAWER_BACKDROP_Z = "z-[50]"
const DRAWER_PANEL_Z = "z-[51]"

// Cap the visible content. Installed PWA: full viewport minus the top safe area so the
// panel never grows under the notch. Browser tab: 97dvh — leaves a sliver up top and
// dodges browser chrome (safe-area-inset-top is 0 in a tab anyway). The keyboard lift
// clamps against this same cap. (Viewport math is Tier-1's job — not a cosmetic.)
const DRAWER_CONTENT_LAYOUT_CLASS = cn(
  "flex min-h-0 shrink-0 flex-col",
  "app:max-h-[calc(100vh-env(safe-area-inset-top))] web:max-h-[97dvh]",
)

const OVERLAY_DURATION = DEFAULT_DRAWER_TRANSITION.duration

// Consumers swap content padding on keyboard state (e.g. dropping the bottom safe-area inset while
// the keyboard covers it). Left instant, that padding jump resizes the content box mid-animation
// and breaks the "one continuous motion". Transitioning it on the SAME curve/duration as the panel
// makes the padding ride along with the lift atomically. Disabled while the panel is closing — a
// padding transition there would fire the content ResizeObserver every frame and re-aim the close.
const CONTENT_PADDING_TRANSITION = (() => {
  const [a, b, c, d] = DEFAULT_DRAWER_TRANSITION.bezier
  return `padding ${DEFAULT_DRAWER_TRANSITION.duration}s cubic-bezier(${a}, ${b}, ${c}, ${d})`
})()

type DrawerMetrics = {
  excessHeight: number
  contentHeight: number
  closedY: number
}

function measureExcessHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight
}

function measureDrawerMetrics(
  contentEl: HTMLElement | null,
  panelEl: HTMLElement | null,
  excessHeight: number,
): DrawerMetrics | null {
  if (!contentEl || excessHeight <= 0) return null

  const contentHeight = contentEl.getBoundingClientRect().height
  if (contentHeight <= 0) return null

  // Closed Y = the panel's on-screen height (everything above the hidden excess),
  // i.e. content height PLUS any consumer bottom padding (e.g. safe-area). Translating
  // by just the content height would leave that padding band peeking at the bottom edge.
  const panelHeight = panelEl?.getBoundingClientRect().height ?? 0
  const closedY = Math.max(contentHeight, panelHeight - excessHeight)

  return { excessHeight, contentHeight, closedY }
}

function isDrawerYClosed(yValue: number, closedY: number) {
  return Math.abs(yValue - closedY) < 1
}

//---- Context ----------------

/**
 * Behavior + refs the engine controls; the compound parts (Overlay / Content / Handle)
 * render the DOM and pull these so styling stays 100% in the consumer's `className`.
 */
export type DrawerEngineContextValue = {
  open: boolean
  backdropRef: RefObject<HTMLButtonElement | null>
  panelRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLDivElement | null>
  scrollerRef: RefObject<HTMLDivElement | null>
  backdropPosition: string
  backdropZ: string
  panelPosition: string
  panelZ: string
  panelStyle: CSSProperties
  contentLayoutClass: string
  backdropState: "open" | "closed"
  overlayDuration: number
  /** `true` while a programmatic panel animation (open / close / keyboard lift) is in flight.
   *  Parts use it to defer repaint-triggering work (e.g. the edge-fade mask) off the animation
   *  window; subscribe below for the flush moment. */
  isPanelAnimatingRef: RefObject<boolean>
  /** Notifies when a panel animation settles (the moment `isPanelAnimatingRef` flips false).
   *  Returns an unsubscribe. */
  subscribePanelSettle: (listener: () => void) => () => void
  /** CSS `transition` for the content scroller so keyboard-driven padding swaps animate with the
   *  panel (`"none"` while closing). */
  contentPaddingTransition: string
  excessHeight: number
  keyboardScrollSpace: number
  /** `true` while the on-screen keyboard is up for a field inside this drawer. */
  isKeyboardOpen: boolean
  isDragDisabled: boolean
  onBackdropClick: () => void
  onHandlePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onHandlePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onHandlePointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  onHandlePointerCancel: () => void
}

const DrawerEngineContext = createContext<DrawerEngineContextValue | null>(
  null,
)

export function useDrawerEngineContext() {
  const ctx = useContext(DrawerEngineContext)
  if (!ctx) {
    throw new Error("Drawer parts must be rendered within <Drawer>.")
  }
  return ctx
}

//---- Engine ----------------

export type DrawerEngineProps = {
  open: boolean
  /** User requested close (backdrop tap / drag dismiss). */
  onRequestClose: () => void
  /** Fired when the open or close animation settles. */
  onSettle?: (open: boolean) => void
  /** Lift content by spending hidden excess when the virtual keyboard opens. */
  avoidKeyboard?: boolean
  /**
   * Blur focused elements OUTSIDE this drawer on open to clear ghost focus. Fields inside
   * the panel (e.g. an [autofocus] input) are never blurred, so this is safe to leave on
   * even when the drawer autofocuses a field.
   */
  blurInputs?: boolean
  /**
   * Suppress the user's drag-to-move/dismiss gesture (drag handle + whole-sheet touch drag)
   * while `true`. Programmatic open/close and the keyboard-avoidance lift are unaffected — only
   * finger-driven sheet motion is locked out. Safe to toggle live (e.g. while a destructive hold
   * button inside the panel is held) so a small finger drift can't drag the sheet.
   */
  disableDrag?: boolean
  /** Notified when the on-screen keyboard opens/closes for a field inside the drawer. */
  onKeyboardOpenChange?: (isOpen: boolean) => void
  /** The drawer composition — Overlay + Content parts that self-wire via context. */
  children?: ReactNode
}

export function DrawerEngine({
  open,
  onRequestClose,
  onSettle,
  avoidKeyboard = true,
  blurInputs = true,
  disableDrag = false,
  onKeyboardOpenChange,
  children,
}: DrawerEngineProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const backdropRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const metricsRef = useRef<DrawerMetrics | null>(null)
  const y = useMotionValue(0)
  const keyboardOffset = useMotionValue(0)
  const keyboardLiftAnimationRef = useRef<DrawerMotionAnimation | null>(
    null,
  )
  const onRequestCloseRef = useRef(onRequestClose)
  const onSettleRef = useRef(onSettle)
  const onKeyboardOpenChangeRef = useRef(onKeyboardOpenChange)
  const skipCloseAnimationRef = useRef(true)
  const isGestureClosingRef = useRef(false)
  const pointerStartRef = useRef(0)
  const dragStartTimeRef = useRef<number | null>(null)
  // Gesture state is refs + imperative dataset writes, NOT React state: a re-render at drag
  // commit / gesture-close start (when the animation is starting) is exactly the main-thread
  // work that delays the first frame on iOS.
  const isPointerDraggingRef = useRef(false)
  // Panel-animation window (open / close / keyboard lift). Run-id token so a stale settle
  // can't clear the flag after an interrupt already started the next animation.
  const isPanelAnimatingRef = useRef(false)
  const panelAnimationRunRef = useRef(0)
  const panelSettleListenersRef = useRef(new Set<() => void>())
  // Whole-sheet touch drag (mirrors SwiftUI/vaul). Refs let the native listeners attach once per
  // mount yet read fresh state; the action callbacks are funneled through a ref for the same reason.
  const touchStartYRef = useRef(0)
  const touchStartXRef = useRef(0)
  const touchScrollerRef = useRef<HTMLElement | null>(null)
  //true when the gesture BEGAN with its scrollable content already at the top —
  //only such a gesture may become a sheet dismiss (see shouldDragSheet)
  const touchStartAtTopRef = useRef(true)
  const isTouchDragCommittedRef = useRef(false)
  //true once a gesture resolves as predominantly horizontal (e.g. swiping a carousel inside the
  //sheet) — locks the sheet drag out for the rest of that touch so a curved flick can't grab it.
  const isTouchHorizontalRef = useRef(false)
  const isTouchActiveRef = useRef(false)
  const openRef = useRef(open)
  //mirrors the disableDrag prop for the once-attached native touch listeners to read live
  const dragDisabledRef = useRef(disableDrag)
  const keyboardOpenRef = useRef(false)
  const dragActionsRef = useRef<{
    closeFromDrag: (dragOffsetY: number, dragVelocity: number) => void
    snapOpen: () => void
    getMetrics: () => DrawerMetrics | null
  } | null>(null)
  const [excessHeight, setExcessHeight] = useState(0)
  //mirrors excessHeight so updateMetrics can freeze the anchor while the keyboard is up
  const excessHeightRef = useRef(0)
  // Extra scroll range (px) appended below the content so fields left behind the
  // keyboard — when the lift is clamped at the max-height cap — can still scroll up.
  const [keyboardScrollSpace, setKeyboardScrollSpace] = useState(0)
  const keyboardScrollSpaceRef = useRef(0)
  const isClosingRef = useRef(false)
  const closeRunRef = useRef(0)
  const closeTargetRef = useRef(0)
  //true when the close started from a keyboard lift, so driveCloseToTarget over-translates
  const closingFromLiftRef = useRef(false)

  const [mounted, setMounted] = useState(open)
  //true for an open that mounts the panel fresh (vs a reopen that interrupts a close while the
  //panel is still mounted). Drives whether the open animation snaps to the hidden position or
  //resumes from the panel's current visual position.
  const freshOpenRef = useRef(false)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(
    null,
  )
  const unmountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )

  onRequestCloseRef.current = onRequestClose
  onSettleRef.current = onSettle
  onKeyboardOpenChangeRef.current = onKeyboardOpenChange
  openRef.current = open
  dragDisabledRef.current = disableDrag

  //track the in-flight panel animation window so parts (the edge-fade mask) can defer
  //repaint-triggering work off the animation and flush once on settle
  const beginPanelAnimation = useCallback(() => {
    panelAnimationRunRef.current++
    isPanelAnimatingRef.current = true
    return panelAnimationRunRef.current
  }, [])

  const endPanelAnimation = useCallback((runId: number) => {
    if (panelAnimationRunRef.current !== runId) return
    isPanelAnimatingRef.current = false
    for (const listener of panelSettleListenersRef.current) listener()
  }, [])

  const subscribePanelSettle = useCallback((listener: () => void) => {
    panelSettleListenersRef.current.add(listener)
    return () => {
      panelSettleListenersRef.current.delete(listener)
    }
  }, [])

  //data-state / data-dragging mirror gesture phases the engine deliberately does NOT re-render
  //for (a render at drag commit delays the gesture's first frame); the overlay's JSX writes the
  //same values on natural (open-driven) re-renders. Set the gesture refs BEFORE calling this.
  const syncBackdropGestureAttributes = useCallback(
    (state?: "open" | "closed") => {
      const backdrop = backdropRef.current
      if (!backdrop) return
      if (state) backdrop.dataset.state = state
      backdrop.dataset.dragging =
        isPointerDraggingRef.current || isGestureClosingRef.current
          ? "true"
          : "false"
    },
    [],
  )

  //live drag lockout for the once-created handlers — the render-level isDragDisabled can't see
  //the gesture-closing phase (a ref, no re-render)
  const isDragLockedOut = useCallback(() => {
    return (
      dragDisabledRef.current ||
      keyboardOpenRef.current ||
      !openRef.current ||
      isGestureClosingRef.current
    )
  }, [])

  //Reinforce the (possibly app-wide) viewport lock while open, so the keyboard pads only the
  //drawer's own scroller. Keyed on `open` (not `mounted`): the lock installs the iOS
  //keyboard-raise listeners, so it must be active in the same commit the field autofocuses.
  //Tying it to `mounted` (which flips a render later) raced the keyboard and corrupted the
  //viewport. `avoidKeyboard` gates the content *lift* below, not this lock.
  useFreezeViewport(open)

  useLayoutEffect(() => {
    if (open) {
      if (unmountTimerRef.current) {
        clearTimeout(unmountTimerRef.current)
        unmountTimerRef.current = null
      }
      setMounted((prevMounted) => {
        //fresh only when the panel wasn't already mounted; a reopen mid-close keeps it mounted
        if (!prevMounted) freshOpenRef.current = true
        return true
      })
    }
  }, [open])

  useEffect(() => {
    return () => {
      if (unmountTimerRef.current) clearTimeout(unmountTimerRef.current)
    }
  }, [])

  useEffect(() => {
    setPortalTarget(document.body)
  }, [])

  const handleExitComplete = useCallback(() => {
    //the close run (however it was driven) is over; flush deferred repaint work
    endPanelAnimation(panelAnimationRunRef.current)
    onSettleRef.current?.(false)
    if (unmountTimerRef.current) clearTimeout(unmountTimerRef.current)

    unmountTimerRef.current = setTimeout(() => {
      setMounted(false)
      unmountTimerRef.current = null
    }, DRAWER_EXIT_UNMOUNT_DELAY_MS)
  }, [endPanelAnimation])

  // Re-assert autofocus on open. React's `autoFocus` only fires when the field first mounts,
  // but a fast close -> reopen reuses the still-mounted panel (DRAWER_EXIT_UNMOUNT_DELAY_MS),
  // so the same field instance is kept and autoFocus never re-fires — the reopened drawer comes
  // up with nothing focused and no keyboard. Focus the consumer's [data-autofocus] field here
  // when it's present but unfocused; on a genuine fresh mount React's autoFocus already did it,
  // and this no-ops (target not yet committed, or already the active element).
  useEffect(() => {
    if (!open) return
    const target =
      panelRef.current?.querySelector<HTMLElement>("[data-autofocus]")
    if (!target || document.activeElement === target) return
    target.focus()
  }, [open])

  // Clear ghost focus only from elements OUTSIDE this drawer on open. Panel-scoped, so a
  // field inside the panel (e.g. an autofocus input) is never blurred — the blur patch and
  // the drawer's own autofocus coexist, and the consumer never has to toggle blurInputs off.
  // (Autofocus itself is owned by the focused field via React's `autoFocus`, which fires when
  // the field mounts in the portal — not here, where the panel may not be committed yet.)
  useEffect(() => {
    if (!open || !blurInputs) return

    const active = document.activeElement
    if (
      active instanceof HTMLElement &&
      !panelRef.current?.contains(active)
    ) {
      active.blur()
    }
  }, [open, blurInputs])

  const snapOpenForKeyboard = useCallback(async () => {
    if (y.get() <= 1) return

    const runId = beginPanelAnimation()
    await animateDrawerY(y, panelRef.current, 0, DEFAULT_DRAWER_TRANSITION)
    endPanelAnimation(runId)
  }, [y, beginPanelAnimation, endPanelAnimation])

  const keyboard = useDrawerKeyboardAvoidance({
    containerRef: panelRef,
    scrollerRef,
    isEnabled: open && avoidKeyboard,
    onWillOpenKeyboard: snapOpenForKeyboard,
  })
  keyboardOpenRef.current = keyboard.isOpen

  //surface keyboard-open state to consumers (e.g. an app wrapper toggling padding) so
  //they don't each mount a parallel keyboard observer fighting the same events.
  useEffect(() => {
    onKeyboardOpenChangeRef.current?.(keyboard.isOpen)
  }, [keyboard.isOpen])

  const applyPanelTransform = useCallback(
    (
      gestureY: number,
      liftOffset: number,
      drivesBackdropOpacity: boolean,
    ) => {
      const panel = panelRef.current
      const backdrop = backdropRef.current
      const contentHeight = metricsRef.current?.contentHeight ?? 1

      if (panel) {
        panel.style.transform = `translate3d(0, ${gestureY + liftOffset}px, 0)`
      }

      if (!backdrop) return

      //vaul: inline overlay opacity only while dragging; open/close use JS transitions
      if (drivesBackdropOpacity && contentHeight > 0) {
        stopDrawerBackdropAnimation(backdrop)
        backdrop.style.transition = "none"
        backdrop.style.opacity = String(
          clamp(1 - gestureY / contentHeight, 0, 1),
        )
      }
    },
    [],
  )

  // Render-level lockout only covers the reactive inputs; the gesture-closing phase (a ref,
  // no re-render) is guarded inside the pointer/touch handlers themselves.
  const isDragDisabled = disableDrag || keyboard.isOpen || !open

  const backdropState: "open" | "closed" = open ? "open" : "closed"

  // `commitExcess` controls whether the measured excess is written to state (which moves the
  // panel's `bottom: -excessHeight` anchor). During a close we measure but DON'T commit — the
  // keyboard dismissing grows the viewport, and shifting the anchor mid-slide makes the close
  // lurch. The geometry is frozen at the close-start value instead.
  //
  // Same discipline for the keyboard LIFT: while the on-screen keyboard covers the bottom, the
  // visual viewport is short, so `measureExcessHeight` shrinks. But `excessHeight` only backs the
  // panel tail hidden below the fold — it cancels out of the content's on-screen position
  // (`bottom: -excess` + an equal spacer), so committing the shrunk value moves NOTHING visible
  // while mutating `bottom` + the spacer on the layer that's mid-lift, forcing a GPU re-raster
  // (the on-screen stutter). Freeze the anchor at its pre-keyboard baseline and let the transform
  // clear the keyboard. Always take a first baseline so `excess` is never left at 0.
  const updateMetrics = useCallback((commitExcess = true) => {
    const measured = measureExcessHeight()
    // The coverage check needs the RAW measurement (capping it would always read as covered);
    // the cap applies only to the committed reserve.
    const keyboardCovering =
      window.innerHeight - measured > KEYBOARD_COVERAGE_PX
    const nextExcess =
      keyboardCovering && excessHeightRef.current > 0
        ? excessHeightRef.current
        : Math.ceil(measured * DRAWER_EXCESS_HEIGHT_CAP_FRACTION)

    if (commitExcess) {
      excessHeightRef.current = nextExcess
      setExcessHeight(nextExcess)
    }

    const metrics = measureDrawerMetrics(
      contentRef.current,
      panelRef.current,
      nextExcess,
    )
    if (metrics) metricsRef.current = metrics
    return metrics
  }, [])

  // Drive the close toward the measured hidden position. Called once when the close starts, then
  // again on mid-close viewport/content shifts. Measures WITHOUT committing excess (no anchor
  // shift, see `updateMetrics`), and only ever re-aims FURTHER DOWN: the keyboard dismissing grows
  // the viewport and shrinks `closedY`, but the original keyboard-up target already over-translates
  // the panel off-screen, so chasing the shrinking value just stutters. A larger `closedY` (rare —
  // the consumer's content grew) still re-aims so the panel never settles short of off-screen.
  const driveCloseToTarget = useCallback(() => {
    const metrics = updateMetrics(false) ?? metricsRef.current
    if (!metrics) return

    if (
      isClosingRef.current &&
      Number.isFinite(closeTargetRef.current) &&
      metrics.closedY <= closeTargetRef.current + 0.5
    ) {
      return
    }

    // Closing from a keyboard lift, over-translate by the safe-area margin so the consumer
    // restoring its bottom padding as the keyboard dismisses stays hidden without a re-aim (which
    // would restart the CSS transition mid-slide — the visible stutter). The guard above compares
    // the raw `closedY` against this over-travelled target, so that padding growth no longer re-aims.
    const overtravel = closingFromLiftRef.current
      ? DRAWER_CLOSE_OVERTRAVEL_PX
      : 0
    const target = metrics.closedY + overtravel

    closeTargetRef.current = target
    const runId = ++closeRunRef.current

    void Promise.resolve(
      animateDrawerY(y, panelRef.current, target, DRAWER_CLOSE_TRANSITION),
    ).then(() => {
      if (closeRunRef.current !== runId || !isClosingRef.current) return
      isClosingRef.current = false
      handleExitComplete()
    })
  }, [updateMetrics, y, handleExitComplete])

  // Invalidate an in-flight close (reopen / interrupt) so its pending settle can't fire.
  const cancelActiveClose = useCallback(() => {
    if (!isClosingRef.current) return
    closeRunRef.current++
    isClosingRef.current = false
  }, [])

  useLayoutEffect(() => {
    if (!mounted) return
    //no initial measure here — the open/close animation effect below measures in the same
    //commit; a second updateMetrics() was ~4 redundant layout reads per open

    function handleResize() {
      // While closing, route through driveCloseToTarget (frozen anchor, re-aim further-down only)
      // so the keyboard dismissing can't lurch the slide; otherwise commit the new metrics.
      if (isClosingRef.current) {
        driveCloseToTarget()
        return
      }
      updateMetrics()
    }

    window.addEventListener("resize", handleResize)
    window.visualViewport?.addEventListener("resize", handleResize)

    // Content-height changes don't always come with a viewport resize (a consumer swapping
    // its bottom padding on keyboard state is a pure re-render), so observe the content box
    // directly — otherwise an in-flight close could settle before that growth lands.
    const contentObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(handleResize)
        : null
    if (contentObserver && contentRef.current) {
      contentObserver.observe(contentRef.current)
    }

    return () => {
      window.removeEventListener("resize", handleResize)
      window.visualViewport?.removeEventListener("resize", handleResize)
      contentObserver?.disconnect()
    }
  }, [updateMetrics, mounted, driveCloseToTarget])

  //vaul: drive transform directly; overlay opacity inline only while dragging. All-refs so the
  //subscriptions attach once per mount instead of detaching at every gesture commit.
  useEffect(() => {
    if (!mounted) return

    function syncPanelTransform() {
      const drives =
        isPointerDraggingRef.current || isGestureClosingRef.current
      applyPanelTransform(y.get(), keyboardOffset.get(), drives)
    }

    const unsubY = y.on("change", syncPanelTransform)
    const unsubLift = keyboardOffset.on("change", syncPanelTransform)

    syncPanelTransform()

    return () => {
      unsubY()
      unsubLift()
    }
  }, [applyPanelTransform, keyboardOffset, y, mounted])

  useEffect(() => {
    const panel = panelRef.current

    if (!open || !avoidKeyboard) {
      stopDrawerKeyboardOffsetAnimation(keyboardLiftAnimationRef)
      if (panel) panel.style.willChange = ""

      // Closing: stay inert, ignore keyboard changes. The keyboard dismissing flips
      // `keyboard.isOpen`/`height` and re-runs this effect, but snapping the lift, unpinning the
      // scroller, or dropping the scroll space here reflows the content and re-aims the close —
      // exactly the jank we're fixing. The close already carries the panel off-screen (lift folded
      // into `y` on close-start); the fresh mount on reopen rebuilds this geometry.
      if (isClosingRef.current) return

      keyboardOffset.set(0)
      keyboardScrollSpaceRef.current = 0
      setKeyboardScrollSpace(0)
      if (scrollerRef.current) scrollerRef.current.style.maxHeight = ""
      return
    }

    // Plain open with no lift in play: nothing to animate or undo. Skip the measurement block
    // (~5 layout/style reads that would land mid-open-animation) entirely — the open effect
    // below takes its own fresh metrics.
    if (
      !keyboard.isOpen &&
      keyboardOffset.get() === 0 &&
      keyboardScrollSpaceRef.current === 0
    ) {
      return
    }

    const metrics = updateMetrics() ?? metricsRef.current
    if (!metrics) return

    const contentEl = contentRef.current
    const heightAvailableUntilMaxHeightCap = contentEl
      ? measureHeightAvailableUntilMaxHeightCap(contentEl)
      : 0

    // Lift target = the LIVE reported keyboard height — nothing cached, seeded, or guessed.
    // The canonical observer (useKeyboard) only commits STABLE heights: iOS's transient
    // mid-field-switch geometry never lands here, and a genuine height change (the QuickType
    // bar appearing/disappearing) arrives as one settled update → one smooth re-aim tracking
    // exactly what the keyboard occupies right now.
    const liftHeight =
      keyboard.isOpen && keyboard.height > 0 ? keyboard.height : 0

    // Pin the scroller to its natural content height (scrollHeight minus the spacer already
    // applied) so the appended spacer becomes pure scroll range. Without this the spacer
    // would grow the content box up to the cap, and because the panel is bottom-anchored
    // that growth pushes the top up — stacking on the lift and bleeding past the cap.
    function applyKeyboardScrollSpace(value: number) {
      const scroller = scrollerRef.current
      if (scroller) {
        if (value > 0) {
          const naturalScrollerHeight =
            scroller.scrollHeight - keyboardScrollSpaceRef.current
          scroller.style.maxHeight = `${naturalScrollerHeight}px`
        } else {
          scroller.style.maxHeight = ""
        }
      }
      keyboardScrollSpaceRef.current = value
      setKeyboardScrollSpace(value)
    }

    const target =
      liftHeight > 0
        ? resolveDrawerKeyboardLift(
            liftHeight,
            metrics.excessHeight,
            heightAvailableUntilMaxHeightCap,
          )
        : 0

    // Shortfall = keyboard height the lift couldn't cover (clamped at the cap). This much
    // content is left behind the keyboard and needs extra scroll range.
    const shortfall =
      liftHeight > 0 ? Math.max(0, liftHeight - Math.abs(target)) : 0

    // Clear any prior scroll space now, but defer *applying* new space until the lift
    // settles — the spacer/pin are a synchronous layout change and would snap if landed on
    // the same frame as the transform. They only add below-the-fold scroll range, so
    // applying them after the animation is visually invisible.
    if (shortfall === 0) applyKeyboardScrollSpace(0)

    if (panel) {
      panel.style.willChange = target !== 0 ? "transform" : ""
    }

    let cancelled = false

    // Grow (lift increasing) rides the open curve; shrink (lift returning toward rest) gets its
    // own slightly quicker settle. Compared by magnitude since the lift offset is <= 0 (upward).
    const isGrowingLift =
      Math.abs(target) >= Math.abs(keyboardOffset.get())
    let liftTransition = isGrowingLift
      ? DEFAULT_DRAWER_TRANSITION
      : DRAWER_SHRINK_TRANSITION

    // Grow-CORRECTION arriving MID-FLIGHT (an upward re-aim while the lift is still animating —
    // e.g. the raise's first read caught the keyboard mid-slide and the settled height landed
    // ~74ms later): restarting the full-duration curve for the remaining travel appends a
    // visible slow tail to the raise. Re-aim over a duration proportional to the REMAINING
    // travel (read live off the panel transform) at the lift's natural rate, so the correction
    // blends into the ongoing motion as one continuous raise. Gated to the in-flight window:
    // a correction landing on a SETTLED panel (QuickType bar change on a field switch) keeps
    // the normal full transition — proportional there compresses a short travel into the
    // clamp floor and reads as a snap.
    if (
      isGrowingLift &&
      keyboardOffset.get() !== 0 &&
      liftHeight > 0 &&
      isPanelAnimatingRef.current
    ) {
      //y is committed (0 while open); live transform = in-flight y + lift contribution
      const liveTranslateY = readPanelTranslateY(panel)
      const remainingTravel = Math.abs(liveTranslateY - (y.get() + target))
      const naturalRatePxPerSec =
        liftHeight / DEFAULT_DRAWER_TRANSITION.duration
      const proportionalDuration = clamp(
        remainingTravel / naturalRatePxPerSec,
        0.12,
        DEFAULT_DRAWER_TRANSITION.duration,
      )
      liftTransition = {
        ...DEFAULT_DRAWER_TRANSITION,
        duration: proportionalDuration,
      }
    }

    //don't begin a run for the epsilon no-op (a stable height report re-landing on the
    //same target) — it would end-and-flush while the real lift is still mid-flight
    const runId = willAnimateDrawerKeyboardOffset(keyboardOffset, target)
      ? beginPanelAnimation()
      : null
    void animateDrawerKeyboardOffset(
      keyboardOffset,
      panel,
      target,
      liftTransition,
      { activeAnimation: keyboardLiftAnimationRef },
    ).finally(() => {
      if (runId !== null) endPanelAnimation(runId)
      if (cancelled) return
      if (shortfall > 0) applyKeyboardScrollSpace(shortfall)
    })

    return () => {
      cancelled = true
      stopDrawerKeyboardOffsetAnimation(keyboardLiftAnimationRef)
    }
  }, [
    avoidKeyboard,
    keyboard.isOpen,
    keyboard.height,
    keyboardOffset,
    y,
    open,
    updateMetrics,
    beginPanelAnimation,
    endPanelAnimation,
  ])

  useEffect(() => {
    return () => {
      stopDrawerKeyboardOffsetAnimation(keyboardLiftAnimationRef)
    }
  }, [])

  useLayoutEffect(() => {
    if (open) return
    stopDrawerKeyboardOffsetAnimation(keyboardLiftAnimationRef)
    const panel = panelRef.current

    // Closing with the keyboard up: fold the live lift into `y` so the close runs on a single
    // motion value. Transition cleared first, so the panel doesn't move (combined transform is
    // preserved) — but from here `keyboardOffset` stays 0 and `y` alone slides the panel off-screen
    // as one continuous motion the keyboard dismissing can't tug a rival animation onto.
    const lift = keyboardOffset.get()
    closingFromLiftRef.current = lift !== 0
    if (lift !== 0) {
      clearDrawerPanelTransition(panel)
      keyboardOffset.set(0)
      y.set(y.get() + lift)
    }

    if (panel) panel.style.willChange = ""
  }, [keyboardOffset, y, open])

  useLayoutEffect(() => {
    if (!mounted) return
    const panel = panelRef.current
    if (!panel) return

    let cancelled = false

    function runAnimation() {
      if (cancelled) return

      const metrics = updateMetrics() ?? metricsRef.current
      if (!metrics) {
        requestAnimationFrame(runAnimation)
        return
      }

      if (open) {
        isGestureClosingRef.current = false
        skipCloseAnimationRef.current = false

        // Fresh mount snaps to the hidden position then animates up. A reopen mid-close keeps the
        // panel mounted, so we continue the upward tween from its current *rendered* position
        // instead of snapping to fully-closed first (that snap-then-slide is the close→reopen
        // flash). Read the live transform BEFORE clearing the CSS transition — `transition: none`
        // snaps the element to its committed (close-target) value.
        const fresh = freshOpenRef.current
        freshOpenRef.current = false

        const resumeFrom = fresh
          ? null
          : readPanelTranslateY(panelRef.current)

        applyDrawerPanelTransition(
          panelRef.current,
          DEFAULT_DRAWER_TRANSITION,
          false,
        )
        if (fresh) {
          y.set(metrics.closedY)
          // Start the backdrop hidden so it fades in. A freshly mounted <button> defaults to
          // opacity 1, which made the dim overlay flash in at full strength on open.
          const backdrop = backdropRef.current
          if (backdrop) {
            stopDrawerBackdropAnimation(backdrop)
            backdrop.style.transition = "none"
            backdrop.style.opacity = "0"
          }
        } else if (resumeFrom !== null) {
          // Freeze at the live position (transition just cleared, so this is instant) — the
          // animate-to-0 below then starts here, not from the close target. `y` excludes the
          // keyboard lift, which the rendered transform includes.
          y.set(resumeFrom - keyboardOffset.get())
        }

        const runId = beginPanelAnimation()

        function startOpenMotion(startFromPaintedState: boolean) {
          if (cancelled) return
          void transitionDrawerBackdropOpacity(
            backdropRef.current,
            1,
            DEFAULT_DRAWER_TRANSITION,
            OVERLAY_DURATION,
            { skipReflow: startFromPaintedState },
          )
          void Promise.resolve(
            animateDrawerY(
              y,
              panelRef.current,
              0,
              DEFAULT_DRAWER_TRANSITION,
            ),
          ).finally(() => {
            if (cancelled) return
            endPanelAnimation(runId)
            onSettleRef.current?.(true)
          })
        }

        if (fresh) {
          // Double-rAF: let the hidden start state (panel at closedY, backdrop at 0) PAINT in
          // frame 1, then start both transitions in frame 2 — the transition start values are
          // committed by the paint, so the forced full-document reflow inside
          // transitionDrawerBackdropOpacity (a synchronous layout on a freshly dirtied document,
          // right before the first animation frame) is skipped. One frame (~16ms) of latency,
          // imperceptible at 380ms.
          requestAnimationFrame(() => {
            if (cancelled) return
            requestAnimationFrame(() => startOpenMotion(true))
          })
        } else {
          // Interrupt/resume: the live position was just frozen and must be committed before the
          // new transition starts — keep the single rAF + forced reflow.
          requestAnimationFrame(() => startOpenMotion(false))
        }
        return
      }

      if (skipCloseAnimationRef.current) {
        y.set(metrics.closedY)
        //nothing animates on this path; clear any leftover animation window
        endPanelAnimation(panelAnimationRunRef.current)
        const backdrop = backdropRef.current
        if (backdrop) {
          stopDrawerBackdropAnimation(backdrop)
          backdrop.style.transition = "none"
          backdrop.style.opacity = "0"
        }
        return
      }

      if (isGestureClosingRef.current) return

      if (isDrawerYClosed(y.get(), metrics.closedY)) {
        handleExitComplete()
        return
      }

      isClosingRef.current = true
      closeTargetRef.current = Number.NaN
      beginPanelAnimation()
      void transitionDrawerBackdropOpacity(
        backdropRef.current,
        0,
        DRAWER_CLOSE_TRANSITION,
        DRAWER_CLOSE_TRANSITION.duration,
      )
      driveCloseToTarget()
    }

    runAnimation()

    return () => {
      cancelled = true
      cancelActiveClose()
    }
  }, [
    open,
    updateMetrics,
    y,
    keyboardOffset,
    handleExitComplete,
    mounted,
    driveCloseToTarget,
    cancelActiveClose,
    beginPanelAnimation,
    endPanelAnimation,
  ])

  const getMetrics = useCallback(() => {
    return updateMetrics() ?? metricsRef.current
  }, [updateMetrics])

  const animateToClosed = useCallback(
    (dragVelocity?: number) => {
      const metrics = getMetrics()
      if (!metrics) return Promise.resolve()

      return Promise.resolve(
        animateDrawerY(
          y,
          panelRef.current,
          metrics.closedY,
          DRAWER_CLOSE_TRANSITION,
          { dragVelocity },
        ),
      )
    },
    [getMetrics, y],
  )

  const requestClose = useCallback(() => {
    if (!openRef.current || isGestureClosingRef.current) return
    onRequestCloseRef.current()
  }, [])

  const closeFromDrag = useCallback(
    (dragOffsetY: number, dragVelocity: number) => {
      if (!openRef.current || isGestureClosingRef.current) return

      const metrics = getMetrics()
      if (!metrics) {
        onRequestCloseRef.current()
        return
      }

      //vaul: finish the close transform locally, then sync controlled open state
      isGestureClosingRef.current = true
      syncBackdropGestureAttributes("closed")
      y.set(Math.max(0, dragOffsetY))

      //the run ends in handleExitComplete once the close effect confirms the settled position
      beginPanelAnimation()
      void animateToClosed(dragVelocity).then(() => {
        isGestureClosingRef.current = false
        syncBackdropGestureAttributes()
        onRequestCloseRef.current()
      })
    },
    [
      getMetrics,
      y,
      animateToClosed,
      syncBackdropGestureAttributes,
      beginPanelAnimation,
    ],
  )

  const snapOpen = useCallback(() => {
    const backdrop = backdropRef.current
    if (backdrop) {
      void transitionDrawerBackdropOpacity(
        backdrop,
        1,
        DEFAULT_DRAWER_TRANSITION,
        OVERLAY_DURATION,
      )
    }

    const runId = beginPanelAnimation()
    void Promise.resolve(
      animateDrawerY(y, panelRef.current, 0, DEFAULT_DRAWER_TRANSITION),
    ).finally(() => endPanelAnimation(runId))
  }, [y, beginPanelAnimation, endPanelAnimation])

  const handleBackdropClick = useCallback(() => {
    const backdrop = backdropRef.current
    if (backdrop && openRef.current) {
      void transitionDrawerBackdropOpacity(
        backdrop,
        0,
        DRAWER_CLOSE_TRANSITION,
        DRAWER_CLOSE_TRANSITION.duration,
      )
    }
    requestClose()
  }, [requestClose])

  const resetHandlePointerDrag = useCallback(() => {
    isPointerDraggingRef.current = false
    syncBackdropGestureAttributes()
    dragStartTimeRef.current = null
  }, [syncBackdropGestureAttributes])

  const handleHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // Touch is handled by the whole-sheet native listener (with nested-scroll arbitration); the
      // handle's pointer path is mouse-only so the two never both drive the drag.
      if (event.pointerType !== "mouse") return
      if (isDragLockedOut()) return

      applyDrawerPanelTransition(
        panelRef.current,
        DEFAULT_DRAWER_TRANSITION,
        false,
      )
      if (backdropRef.current) {
        stopDrawerBackdropAnimation(backdropRef.current)
        backdropRef.current.style.transition = "none"
      }
      pointerStartRef.current = event.clientY
      dragStartTimeRef.current = Date.now()
      isPointerDraggingRef.current = true
      syncBackdropGestureAttributes()
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    [isDragLockedOut, syncBackdropGestureAttributes],
  )

  const handleHandlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "mouse") return
      if (!isPointerDraggingRef.current || isDragLockedOut()) return

      const draggedDown = event.clientY - pointerStartRef.current

      if (draggedDown < 0) {
        y.set(-dampenDrawerPull(-draggedDown))
        return
      }

      y.set(draggedDown)
    },
    [y, isDragLockedOut],
  )

  const handleHandlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "mouse") return
      if (!isPointerDraggingRef.current) return

      const dragStartTime = dragStartTimeRef.current
      const draggedDown = event.clientY - pointerStartRef.current
      const wasDraggingUp = draggedDown < 0
      resetHandlePointerDrag()

      if (dragStartTime === null) return

      const metrics = getMetrics()
      if (!metrics) return

      //vaul: moved upwards — reset, don't close
      if (wasDraggingUp) {
        snapOpen()
        return
      }

      //close threshold measures against full close travel (closedY), not just content
      //height — tall bottom safe-area insets push closedY past contentHeight.
      const { shouldClose, velocityY } = resolveDrawerDragRelease(
        draggedDown,
        dragStartTime,
        metrics.closedY,
      )
      if (shouldClose) {
        closeFromDrag(draggedDown, velocityY)
        return
      }

      snapOpen()
    },
    [resetHandlePointerDrag, getMetrics, snapOpen, closeFromDrag],
  )

  // Latest drag actions for the native touch listeners (attached once per mount, below).
  dragActionsRef.current = { closeFromDrag, snapOpen, getMetrics }

  // Whole-sheet touch drag with nested-scroll arbitration (SwiftUI / vaul behavior). A drag
  // anywhere on the sheet can dismiss it, but a drag that starts inside scrolled content scrolls
  // first and only dismisses once that content is at the top. Native (non-passive) touch events are
  // required: a downward pan over a scroll container makes the browser cancel pointer events to
  // scroll, so we must preventDefault to take the gesture back. Mouse keeps the handle path.
  useEffect(() => {
    // `mounted` gates this so the listeners (re)attach when the panel element appears/changes.
    if (!mounted) return
    const panel = panelRef.current
    if (!panel) return

    const DRAG_THRESHOLD_PX = 4

    function findScrollableAncestor(
      from: EventTarget | null,
    ): HTMLElement | null {
      let element = from instanceof HTMLElement ? from : null
      while (element && element !== panel) {
        const overflowY = getComputedStyle(element).overflowY
        if (
          (overflowY === "auto" || overflowY === "scroll") &&
          element.scrollHeight > element.clientHeight
        ) {
          return element
        }
        element = element.parentElement
      }
      return null
    }

    // Should this drag move the sheet (vs. let the content scroll)? Down only takes over when
    // the scrollable content was at the top WHEN THE GESTURE STARTED (and still is) — a swipe
    // that scrolled the content to the top must NOT hand off to a dismiss mid-gesture; the user
    // lifts and swipes again, which is clearly intentional. Up always defers to the content
    // (single detent).
    function shouldDragSheet(
      target: EventTarget | null,
      draggingDown: boolean,
    ): boolean {
      if (isTouchDragCommittedRef.current) return true
      //user drag locked out by the consumer (e.g. a held destructive button in the panel)
      if (dragDisabledRef.current) return false
      if (window.getSelection()?.toString()) return false
      if (
        target instanceof HTMLElement &&
        target.closest("[data-drawer-no-drag]")
      ) {
        return false
      }
      const scroller = touchScrollerRef.current
      if (!scroller) return true
      if (!draggingDown) return false
      return touchStartAtTopRef.current && scroller.scrollTop <= 0
    }

    function commitSheetDrag(clientY: number) {
      isTouchDragCommittedRef.current = true
      isPointerDraggingRef.current = true
      syncBackdropGestureAttributes()
      applyDrawerPanelTransition(panel, DEFAULT_DRAWER_TRANSITION, false)
      if (backdropRef.current) {
        stopDrawerBackdropAnimation(backdropRef.current)
        backdropRef.current.style.transition = "none"
      }
      // Anchor the sheet at the current finger position so it doesn't jump by any scroll distance
      // already consumed before the takeover.
      pointerStartRef.current = clientY
      dragStartTimeRef.current = Date.now()
    }

    function onTouchStart(event: TouchEvent) {
      if (!openRef.current || isGestureClosingRef.current) return
      if (event.touches.length !== 1) return
      const touch = event.touches[0]
      isTouchActiveRef.current = true
      isTouchDragCommittedRef.current = false
      isTouchHorizontalRef.current = false
      touchStartYRef.current = touch.clientY
      touchStartXRef.current = touch.clientX
      pointerStartRef.current = touch.clientY
      touchScrollerRef.current = findScrollableAncestor(touch.target)
      touchStartAtTopRef.current =
        !touchScrollerRef.current ||
        touchScrollerRef.current.scrollTop <= 0
    }

    function onTouchMove(event: TouchEvent) {
      if (!isTouchActiveRef.current) return
      // A gesture already claimed as horizontal stays the content's (carousel) for its lifetime.
      if (isTouchHorizontalRef.current) return
      const touch = event.touches[0]
      if (!touch) return
      const deltaY = touch.clientY - touchStartYRef.current
      const deltaX = touch.clientX - touchStartXRef.current
      const draggingDown = deltaY > 0

      // Keyboard up: a downward overscroll PULL at the top of the content dismisses the keyboard
      // (SwiftUI scroll-dismisses-keyboard). Only when the scroller is already at the top — otherwise
      // a downward drag is the user scrolling content back up, and dismissing there would eat the
      // scroll and blur the field mid-content. Below the top we let native scroll run.
      if (keyboardOpenRef.current) {
        const scroller = touchScrollerRef.current
        const atScrollTop = !scroller || scroller.scrollTop <= 0
        if (
          draggingDown &&
          atScrollTop &&
          Math.abs(deltaY) > DRAG_THRESHOLD_PX
        ) {
          dismissVirtualKeyboard()
          isTouchActiveRef.current = false
        }
        return
      }

      if (!isTouchDragCommittedRef.current) {
        const absX = Math.abs(deltaX)
        const absY = Math.abs(deltaY)
        // Wait until the gesture clears the slop radius before resolving its axis — early frames are
        // too noisy to tell vertical from horizontal apart.
        if (Math.max(absX, absY) < DRAG_THRESHOLD_PX) return
        // Predominantly horizontal (past the 45° line) → it's a carousel/content swipe; lock the
        // sheet out so the rest of this touch (even if it curves vertical) never drags the drawer.
        if (absX > absY) {
          isTouchHorizontalRef.current = true
          return
        }
        // Vertical, but not (yet) ours — let native scroll run and re-check on the next move.
        // A gesture that started mid-scroll stays the content's for its whole lifetime
        // (touchStartAtTopRef) — reaching the top never converts it into a dismiss.
        if (!shouldDragSheet(touch.target, draggingDown)) return
        commitSheetDrag(touch.clientY)
      }

      event.preventDefault()
      const draggedDown = touch.clientY - pointerStartRef.current
      y.set(
        draggedDown < 0 ? -dampenDrawerPull(-draggedDown) : draggedDown,
      )
    }

    function endTouchDrag(clientY: number) {
      const committed = isTouchDragCommittedRef.current
      const dragStartTime = dragStartTimeRef.current
      isTouchActiveRef.current = false
      isTouchDragCommittedRef.current = false
      touchScrollerRef.current = null
      if (!committed) return

      isPointerDraggingRef.current = false
      syncBackdropGestureAttributes()
      dragStartTimeRef.current = null

      const actions = dragActionsRef.current
      const metrics = actions?.getMetrics()
      if (!actions || !metrics) {
        actions?.snapOpen()
        return
      }

      const draggedDown = clientY - pointerStartRef.current
      if (draggedDown < 0) {
        actions.snapOpen()
        return
      }

      const { shouldClose, velocityY } = resolveDrawerDragRelease(
        draggedDown,
        dragStartTime,
        metrics.closedY,
      )
      if (shouldClose) {
        actions.closeFromDrag(draggedDown, velocityY)
        return
      }
      actions.snapOpen()
    }

    function onTouchEnd(event: TouchEvent) {
      if (!isTouchActiveRef.current && !isTouchDragCommittedRef.current)
        return
      const touch = event.changedTouches[0]
      endTouchDrag(touch ? touch.clientY : pointerStartRef.current)
    }

    function onTouchCancel() {
      if (isTouchDragCommittedRef.current) {
        endTouchDrag(pointerStartRef.current)
        return
      }
      isTouchActiveRef.current = false
    }

    panel.addEventListener("touchstart", onTouchStart, { passive: true })
    panel.addEventListener("touchmove", onTouchMove, { passive: false })
    panel.addEventListener("touchend", onTouchEnd)
    panel.addEventListener("touchcancel", onTouchCancel)
    return () => {
      panel.removeEventListener("touchstart", onTouchStart)
      panel.removeEventListener("touchmove", onTouchMove)
      panel.removeEventListener("touchend", onTouchEnd)
      panel.removeEventListener("touchcancel", onTouchCancel)
    }
  }, [mounted, y, syncBackdropGestureAttributes])

  //memoized so gesture-phase work and unrelated engine renders don't re-render every consumer
  //(Overlay / Content) — all handlers above are stable useCallbacks reading refs
  const contextValue = useMemo<DrawerEngineContextValue>(
    () => ({
      open,
      backdropRef,
      panelRef,
      contentRef,
      scrollerRef,
      backdropPosition: "fixed",
      backdropZ: DRAWER_BACKDROP_Z,
      panelPosition: "fixed",
      panelZ: DRAWER_PANEL_Z,
      panelStyle: { bottom: excessHeight > 0 ? -excessHeight : 0 },
      contentLayoutClass: DRAWER_CONTENT_LAYOUT_CLASS,
      backdropState,
      overlayDuration: OVERLAY_DURATION,
      contentPaddingTransition: open ? CONTENT_PADDING_TRANSITION : "none",
      excessHeight,
      keyboardScrollSpace,
      isKeyboardOpen: keyboard.isOpen,
      isDragDisabled,
      isPanelAnimatingRef,
      subscribePanelSettle,
      onBackdropClick: handleBackdropClick,
      onHandlePointerDown: handleHandlePointerDown,
      onHandlePointerMove: handleHandlePointerMove,
      onHandlePointerUp: handleHandlePointerUp,
      onHandlePointerCancel: resetHandlePointerDrag,
    }),
    [
      open,
      excessHeight,
      keyboardScrollSpace,
      keyboard.isOpen,
      isDragDisabled,
      backdropState,
      subscribePanelSettle,
      handleBackdropClick,
      handleHandlePointerDown,
      handleHandlePointerMove,
      handleHandlePointerUp,
      resetHandlePointerDrag,
    ],
  )

  if (!mounted) return null

  const tree = (
    <DrawerEngineContext.Provider value={contextValue}>
      {children}
    </DrawerEngineContext.Provider>
  )

  if (portalTarget) {
    return createPortal(tree, portalTarget)
  }

  return tree
}

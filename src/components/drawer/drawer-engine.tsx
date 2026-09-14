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
import { hasNativeKeyboard } from "#adaptv/capabilities/keyboard"
import {
  clearDrawerChromeTint,
  setDrawerChromeTint,
} from "#adaptv/components/drawer/drawer-chrome-tint"
import type { DrawerTransition } from "#adaptv/components/drawer/drawer-constants"
import {
  DEFAULT_DRAWER_TRANSITION,
  DRAWER_CLOSE_TRANSITION,
  DRAWER_SHRINK_TRANSITION,
  dampenDrawerPull,
  resolveDrawerDragRelease,
} from "#adaptv/components/drawer/drawer-constants"
import {
  startDrawerFpsSample,
  stopDrawerFpsSample,
} from "#adaptv/components/drawer/drawer-fps"
import {
  clearDrawerKeyboardRoom,
  measureDrawerContentNaturalHeight,
  readDrawerKeyboardRoom,
  resolveDrawerKeyboardRoom,
  resolveShrunkViewportCap,
  shouldPrimeKeyboardFloor,
  useDrawerKeyboardAvoidance,
  viewportShrinksUnderKeyboard,
  writeDrawerKeyboardRoom,
} from "#adaptv/components/drawer/drawer-keyboard"
import {
  animateDrawerY,
  applyDrawerPanelTransition,
  clearDrawerPanelTransition,
  readPanelTranslateY,
  resumeDrawerTransition,
  samplePanelFlight,
  stopDrawerBackdropAnimation,
  transitionDrawerBackdropOpacity,
} from "#adaptv/components/drawer/drawer-motion"
import { useFreezeViewport } from "#adaptv/hooks/use-freeze-viewport"
import {
  GesturePriority,
  useGestureCapture,
} from "#adaptv/hooks/use-gesture-capture"
import {
  dismissVirtualKeyboard,
  getVirtualKeyboardApi,
} from "#adaptv/hooks/use-keyboard"
import { clamp } from "#adaptv/utils/clamp"
import { cn } from "#adaptv/utils/cn"
import { isIOS } from "#adaptv/utils/platform"

//Unmount as soon as the close settles (the snappy close ends with the panel off-screen, so
//there's no last frame to wait for). Keeping the panel mounted past that left the overlay
//blocking the page while nothing was visible.
const DRAWER_EXIT_UNMOUNT_DELAY_MS = 0

//px of extra slide on a close that starts with keyboard room held — `driveCloseToTarget` owns why.
//It lands off-screen, so it's invisible, and it is gated to keyboard closes: plain closes don't grow.
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

/**
 * The consumer's visible-height cap, as a custom property rather than a `max-height`.
 *
 * It has to be a variable, because inline `max-height` on the content box is NOT free: the
 * keyboard-room effect owns that property imperatively — it writes one to grow the box, clears
 * it to hand the box back, and reads `content.style.maxHeight !== ""` as the test for "is the
 * cap currently mine?". A consumer value sitting there inline answers that question wrong
 * forever: the stylesheet cap is never read (`cssCapRef` stays `Infinity`, so keyboard growth
 * is uncapped), `shouldPrimeKeyboardFloor` sees `capHeld` and never primes, and the first
 * release deletes the consumer's cap with nothing to restore it. Through a variable the CLASS
 * stays the cap, `getComputedStyle(content).maxHeight` resolves it, and the keyboard grows into
 * the consumer's own ceiling for free. (`styles.ts` limit 2 — a per-frame-written property is
 * won by a race, not by a precedence tier, so the clean channel is a variable.)
 *
 * Set on the PANEL (drawer.tsx) and inherited down, so the content box keeps having no consumer
 * style channel at all.
 */
export const DRAWER_CONTENT_MAX_HEIGHT_VAR = "--pwa-drawer-max-height"

// Cap the visible content. Installed PWA: full viewport minus the top safe area so the
// panel never grows under the notch. Browser tab: 97dvh — leaves a sliver up top and
// dodges browser chrome (the top inset is 0 in a tab anyway). (Viewport math is Tier-1's
// job — not a cosmetic.) `--adaptv-inset-top` is the contract var (styles/safe-area.css).
//
// The consumer's cap is the FIRST term of the `min()`, which is what makes it a request rather
// than an override: a sheet may be asked to stop higher up, never to grow past the platform
// ceiling. A drawer that reaches the screen edge is not a drawer, so that ceiling is adaptv's
// and stays adaptv's. Unset, the term is a whole viewport and the `min()` resolves to the
// platform cap unchanged — `100vh` is `lvh`, and both ceilings are strictly under it.
//
// Deliberately keyboard-blind: nothing here shrinks when the keyboard opens. The sheet answers
// a keyboard by GROWING into this cap and holding room under its content (see the keyboard-room
// effect), which is the same geometry with a far better motion than shrinking the cap and
// translating the panel up to compensate. While that room is held the engine owns `max-height`
// inline and this is the ceiling it grows toward.
// (exported for drawer-keyboard.test.ts — the cap only holds if Tailwind parses these
// `min()`/`calc()` values, which fails soft. Not in any barrel.)
export const DRAWER_CONTENT_LAYOUT_CLASS = cn(
  "flex min-h-0 shrink-0 flex-col",
  "app:max-h-[min(var(--pwa-drawer-max-height,100vh),calc(100vh-var(--adaptv-inset-top)))]",
  "web:max-h-[min(var(--pwa-drawer-max-height,100vh),97dvh)]",
)

const OVERLAY_DURATION = DEFAULT_DRAWER_TRANSITION.duration

function drawerCssTransition(
  property: string,
  config: DrawerTransition = DEFAULT_DRAWER_TRANSITION,
) {
  const [a, b, c, d] = config.bezier
  return `${property} ${config.duration}s cubic-bezier(${a}, ${b}, ${c}, ${d})`
}

// Consumers swap content padding on keyboard state (e.g. dropping the bottom safe-area inset while
// the keyboard covers it). Left instant, that padding jump resizes the content box mid-animation
// and breaks the "one continuous motion". Transitioning it on the SAME curve/duration as the panel
// makes the padding ride along with the lift atomically. Disabled while the panel is closing — a
// padding transition there would fire the content ResizeObserver every frame and re-aim the close.
const CONTENT_PADDING_TRANSITION = drawerCssTransition("padding")

//the prime step writes a value that changes nothing on screen; a transition there would spend
//the curve on an invisible change
const DRAWER_NO_TRANSITION = "none"

//transitionend is not reliable when a property lands on its current value, so the settle is
//driven by duration + this margin (mirrors drawer-motion's own fallback)
const DRAWER_SETTLE_FALLBACK_MS = 32

// A floor primed on focus (see `primeKeyboardFloor` + the keyboard-room effect's `heldFloor` path)
// is held this long waiting for the keyboard whose arrival the focus predicted. If none confirms —
// a hardware keyboard, a programmatic focus, a readonly field the gate missed — the floor eases back
// down and releases, so a focus that raises no keyboard never leaves the sheet stuck tall. Mirrors
// use-keyboard's KEYBOARD_PREDICT_CONFIRM_MS: the keyboard's own slide is ~250ms, so the window has
// to clear it or a genuine keyboard gets retracted mid-appearance and flickers back.
const DRAWER_KEYBOARD_FLOOR_CONFIRM_MS = 400

// Window after a keyboard GROW in which a further grow is re-aimed as a CONTINUATION rather than
// restarted — the grow-correction block in the keyboard-room effect owns why. Wide enough for iOS's
// ~280ms password-AutoFill-bar second step; a genuinely later grow (a field switch) falls outside it
// and animates normally.
const DRAWER_KEYBOARD_RAISE_CONTINUATION_MS = 500

// Floor for that re-aim's proportional duration — the bare 45px accessory-bar step computes to ~50ms,
// which reads as an abrupt SNAP; this holds it to a short-but-smooth step, still well under the
// ~380ms full curve.
const DRAWER_KEYBOARD_STEP_MIN_DURATION = 0.22

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
  //FLIP compensation for the box's growth: the layout lands in one step, this offset makes it
  //look like it has not moved yet, and animating IT to zero is the motion the user sees. A
  //transform is composited; the max-height it replaces reflowed the whole sheet every frame.
  const keyboardFlip = useMotionValue(0)
  const onRequestCloseRef = useRef(onRequestClose)
  const onSettleRef = useRef(onSettle)
  const onKeyboardOpenChangeRef = useRef(onKeyboardOpenChange)
  const skipCloseAnimationRef = useRef(true)
  const isGestureClosingRef = useRef(false)
  const pointerStartRef = useRef(0)
  const dragStartTimeRef = useRef<number | null>(null)

  //Shared gesture arbitration. `blocksScroll` because `touch-action` cannot be
  //changed mid-touch on iOS, so holding the scroller still is the only reliable
  //way to stop a scroll the drag took over from.
  const capture = useGestureCapture({
    priority: GesturePriority.DrawerDrag,
    blocksScroll: true,
    //Pre-empted (an edge swipe outranks a drawer drag) — snap back rather than
    //leaving the sheet mid-translate with no pointer left to finish it.
    //The rest of that touch is no longer ours either: clearing the touch flags makes
    //its later moves and its touchend no-ops until a new touchstart, instead of
    //dragging the snapped sheet back under the finger and deciding a close with
    //no start time. The refs are declared further down; this closure only runs on
    //a real pre-emption, long after render, so the forward references are safe.
    onLost: () => {
      isPointerDraggingRef.current = false
      isTouchDragCommittedRef.current = false
      isTouchActiveRef.current = false
      dragStartTimeRef.current = null
      syncBackdropGestureAttributes()
      dragActionsRef.current?.snapOpen()
    },
  })
  const captureRef = useRef(capture)
  captureRef.current = capture

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
  //room currently held under the content stack for the keyboard, and the stylesheet cap read
  //back while nothing of ours was overriding it (see the keyboard-room effect)
  const appliedRoomRef = useRef(0)
  const cssCapRef = useRef(Number.POSITIVE_INFINITY)
  //true while the box is capped to the visible viewport on the unfrozen web path (non-secure
  //Chromium), where the keyboard shrinks the viewport itself — see the keyboard-room effect
  const visibleCapAppliedRef = useRef(false)
  //the content's own height as of the last time the room target was resolved — the baseline a
  //content-size change is detected against (see reaimKeyboardRoom)
  const lastNaturalRef = useRef(0)
  //the box height one observation ago — the floor a shrink eases down FROM
  const lastBoxRef = useRef(0)
  //performance.now() of the last keyboard GROW — the NEW-grow toggle re-aims a further grow within
  //DRAWER_KEYBOARD_RAISE_CONTINUATION_MS (the iOS two-step accessory bar) as a continuation
  const lastKeyboardGrowTsRef = useRef(0)
  //pending retract of a focus-primed floor the keyboard never confirmed (see primeKeyboardFloor)
  const floorRetractTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null)
  const isClosingRef = useRef(false)
  const closeRunRef = useRef(0)
  const closeTargetRef = useRef(0)
  //true when the close started with keyboard room held, so driveCloseToTarget over-translates
  const closingWithKeyboardRoomRef = useRef(false)

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
  const beginPanelAnimation = useCallback((label = "drawer") => {
    panelAnimationRunRef.current++
    isPanelAnimatingRef.current = true
    //dev-only, off by default — records this animation's frame cadence (see drawer-fps.ts)
    startDrawerFpsSample(label)
    return panelAnimationRunRef.current
  }, [])

  const endPanelAnimation = useCallback((runId: number) => {
    if (panelAnimationRunRef.current !== runId) return
    isPanelAnimatingRef.current = false
    stopDrawerFpsSample()
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
      if (floorRetractTimerRef.current) {
        clearTimeout(floorRetractTimerRef.current)
      }
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

    const runId = beginPanelAnimation("keyboard-snap")
    await animateDrawerY(y, panelRef.current, 0, DEFAULT_DRAWER_TRANSITION)
    endPanelAnimation(runId)
  }, [y, beginPanelAnimation, endPanelAnimation])

  // Release a floor the keyboard never confirmed: ease the box from the floor back down to its own
  // (collapsed) content height and hand `min-height` back. The keyboard-room effect's `heldFloor`
  // path takes over any floor the keyboard DOES confirm (it eases + clears it on settle) and clears
  // this timer, so reaching here means no keyboard came — a FLIP-eased shrink, same discipline as
  // the reaim path, so a focus that raised nothing settles smoothly instead of dropping in one frame.
  const releaseKeyboardFloor = useCallback(() => {
    if (floorRetractTimerRef.current) {
      clearTimeout(floorRetractTimerRef.current)
      floorRetractTimerRef.current = null
    }
    const content = contentRef.current
    if (!content || content.style.minHeight === "") return
    //the keyboard-room effect owns the floor now — let its settle ease and clear it
    if (appliedRoomRef.current > 0) return

    const panelEl = panelRef.current
    const boxBefore = content.getBoundingClientRect().height
    content.style.minHeight = ""
    void content.offsetHeight
    const moved = content.getBoundingClientRect().height - boxBefore
    if (
      Math.abs(moved) > 0.5 &&
      panelEl &&
      !isPointerDraggingRef.current
    ) {
      clearDrawerPanelTransition(panelEl)
      keyboardFlip.set(moved)
      void content.offsetHeight
      applyDrawerPanelTransition(panelEl, DRAWER_SHRINK_TRANSITION, true)
      keyboardFlip.set(0)
    }
  }, [keyboardFlip])

  // Focus is the earliest signal a keyboard is imminent — earlier than any height measurement, and
  // on native the height only lands AFTER focus. If the sheet is at content height with no room held
  // (the classic being a wheel/date picker open with no keyboard yet), pin a `min-height` floor at
  // the box's current height now. The picker then collapses UNDER the floor — the sheet's top does
  // not drop — and when the keyboard's height lands the keyboard-room effect eases the floor to the
  // final height in one motion. See `shouldPrimeKeyboardFloor` for why only this state qualifies.
  const primeKeyboardFloor = useCallback(
    (field: HTMLElement) => {
      const content = contentRef.current
      if (!content) return
      const fieldRaisesKeyboard = !(
        (field instanceof HTMLInputElement ||
          field instanceof HTMLTextAreaElement) &&
        (field.readOnly || field.disabled)
      )
      if (
        !shouldPrimeKeyboardFloor({
          enabled: open && avoidKeyboard && fieldRaisesKeyboard,
          isClosing: isClosingRef.current,
          roomHeld: appliedRoomRef.current > 0,
          floorHeld: content.style.minHeight !== "",
          capHeld: content.style.maxHeight !== "",
        })
      ) {
        return
      }

      const boxHeight = content.getBoundingClientRect().height
      if (boxHeight <= 0) return
      content.style.minHeight = `${boxHeight}px`
      if (floorRetractTimerRef.current) {
        clearTimeout(floorRetractTimerRef.current)
      }
      floorRetractTimerRef.current = setTimeout(
        releaseKeyboardFloor,
        DRAWER_KEYBOARD_FLOOR_CONFIRM_MS,
      )
    },
    [open, avoidKeyboard, releaseKeyboardFloor],
  )

  // One focusin path: prime the floor synchronously (before the picker's collapse re-render lands),
  // then snap the sheet back open if a drag had left it partway down.
  const onFieldWillOpenKeyboard = useCallback(
    (field: HTMLElement) => {
      primeKeyboardFloor(field)
      return snapOpenForKeyboard()
    },
    [primeKeyboardFloor, snapOpenForKeyboard],
  )

  const keyboard = useDrawerKeyboardAvoidance({
    containerRef: panelRef,
    scrollerRef,
    isEnabled: open && avoidKeyboard,
    onWillOpenKeyboard: onFieldWillOpenKeyboard,
  })
  keyboardOpenRef.current = keyboard.isOpen

  //surface keyboard-open state to consumers (e.g. an app wrapper toggling padding) so
  //they don't each mount a parallel keyboard observer fighting the same events.
  useEffect(() => {
    onKeyboardOpenChangeRef.current?.(keyboard.isOpen)
  }, [keyboard.isOpen])

  const applyPanelTransform = useCallback(
    (gestureY: number, flip: number, drivesBackdropOpacity: boolean) => {
      const panel = panelRef.current
      const backdrop = backdropRef.current
      const contentHeight = metricsRef.current?.contentHeight ?? 1

      if (panel) {
        panel.style.transform = `translate3d(0, ${gestureY + flip}px, 0)`
      }

      if (!backdrop) return

      //vaul: inline overlay opacity only while dragging; open/close use JS transitions
      if (drivesBackdropOpacity && contentHeight > 0) {
        const opacity = clamp(1 - gestureY / contentHeight, 0, 1)
        stopDrawerBackdropAnimation(backdrop)
        backdrop.style.transition = "none"
        backdrop.style.opacity = String(opacity)
        //the toolbar tracks the finger with the dim — a scrim that lightens
        //while the chrome above it stays dark reads as two separate surfaces
        setDrawerChromeTint(backdrop, opacity)
      }
    },
    [],
  )

  // Render-level lockout only covers the reactive inputs; the gesture-closing phase (a ref,
  // no re-render) is guarded inside the pointer/touch handlers themselves.
  //
  // A raised keyboard does NOT lock the drag. Pulling a sheet down is the instinctive way out of
  // a form, and suppressing it while a field is focused means the gesture silently does nothing
  // exactly when the user most wants it — SwiftUI drags the sheet and the keyboard away together.
  const isDragDisabled = disableDrag || !open

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

  /**
   * Start a FLIP without discarding the slide already in flight.
   *
   * Every FLIP here begins by clearing the panel's transition, and `transition: none` makes the
   * element assume its COMMITTED transform — which, mid-animation, is the target, not where the
   * browser is currently painting it. So a FLIP that lands during the open slide teleports the
   * sheet straight to open: device-measured on an iPhone 16 Pro, painted at 605px and snapped to
   * 0 in a single frame when iOS's password AutoFill bar arrived 40ms into the open. That is the
   * "the drawer snaps into place instead of animating" report, and it is not specific to the
   * keyboard — anything that resizes the content mid-open reaches the same three lines.
   *
   * Freezing `y` at the painted position first makes clearing the transition invisible: the FLIP
   * then starts where the sheet actually is. Returns the target the slide was heading for (so the
   * caller can drive it home rather than leaving it stranded) together with the transition that
   * CONTINUES the interrupted one — see `resumeDrawerTransition`, without which the sheet lands
   * correctly but visibly slows down at the seam. `null` when nothing was in flight and the plain
   * FLIP is already correct.
   *
   * `growth` is the layout change this FLIP is about to compensate: it is what the sheet's
   * remaining travel GAINS, and the resumed duration has to account for it.
   *
   * The same freeze-at-the-live-position discipline the close→reopen path uses — see `resumeFrom`
   * in the open/close effect, and `readPanelTranslateY`'s own warning about `transition: none`.
   */
  const freezePanelForFlip = useCallback(
    (panelEl: HTMLElement, growth: number) => {
      const target = y.get()
      const flip = keyboardFlip.get()
      const liveY = readPanelTranslateY(panelEl)
      const drift = liveY - (target + flip)
      //the interrupted curve's own phase, while there is still a transition to read it from
      const flight = samplePanelFlight(panelEl)
      clearDrawerPanelTransition(panelEl)
      //nothing in flight: the committed value IS the painted one, so leave the FLIP alone
      if (Math.abs(drift) <= 0.5) return null
      y.set(liveY - flip)
      return {
        resumeTo: target,
        transition: resumeDrawerTransition(flight, drift, drift + growth),
      }
    },
    [y, keyboardFlip],
  )

  // The content changed size while room is held — the classic being a field focus that collapses
  // an expanded picker at the same instant the keyboard raises. Two geometry changes, but only the
  // keyboard's own effect re-aims the box, and the keyboard did not change here: the box is left
  // easing toward a target computed from a height that no longer exists, so it SNAPS to the new
  // one instead of easing to it.
  //
  // Safe against our own animation, which is why it can live on a ResizeObserver: natural height is
  // `box - room + hidden`, and those three move in lockstep while the box animates, so the value is
  // invariant unless the content genuinely changed. No priming either — `max-height` is already
  // engine-owned at this point, so the tween simply re-aims from wherever it is.
  const reaimKeyboardRoom = useCallback(() => {
    const content = contentRef.current
    if (!content || appliedRoomRef.current <= 0 || isClosingRef.current) {
      return
    }
    const natural = measureDrawerContentNaturalHeight(
      content,
      scrollerRef.current,
      appliedRoomRef.current,
    )
    const boxBefore = lastBoxRef.current
    lastBoxRef.current = content.getBoundingClientRect().height
    if (Math.abs(natural - lastNaturalRef.current) <= 2) return
    const shrinking = natural < lastNaturalRef.current
    lastNaturalRef.current = natural

    const target = resolveDrawerKeyboardRoom(
      appliedRoomRef.current,
      natural,
      cssCapRef.current,
    )

    // Shrinking needs a FLOOR, not a ceiling — see `minHeight` on DrawerKeyboardRoom. Pinning it at
    // the height the box had one observation ago holds the sheet up, and easing that floor down IS
    // the shrink. A ResizeObserver callback runs after layout but before paint, so the collapsed
    // frame is never drawn.
    //
    // This depends entirely on `natural` being exact: an earlier version read it as
    // `box - room + hidden`, which dips for one frame at the uncapped→capped boundary, and pinned
    // the floor at the wrong height in three scenarios that never shrank at all.
    // Same discipline as the keyboard effect: the layout lands in ONE step and a composited
    // transform carries the motion. Animating these properties here was the last reflow-per-frame
    // on the hot path — the scenarios that reach this code measured 24-35fps while everything else
    // sat at 55-60. The floor still pins first, so the collapsed frame is never painted.
    const boxWas = content.getBoundingClientRect().height
    if (shrinking && boxBefore > 0) {
      writeDrawerKeyboardRoom(
        content,
        { ...target, minHeight: boxBefore },
        DRAWER_NO_TRANSITION,
      )
      void content.offsetHeight
    }
    writeDrawerKeyboardRoom(
      content,
      { ...target, minHeight: shrinking ? target.maxHeight : null },
      DRAWER_NO_TRANSITION,
    )

    const panelEl = panelRef.current
    const moved = content.getBoundingClientRect().height - boxWas
    //same reason as the keyboard effect: a finger on the sheet owns the transform
    if (
      Math.abs(moved) > 0.5 &&
      panelEl &&
      !isPointerDraggingRef.current
    ) {
      const resumed = freezePanelForFlip(panelEl, moved)
      keyboardFlip.set(moved)
      void content.offsetHeight
      //carrying the slide's remaining travel too — continue that motion, not the shrink's
      applyDrawerPanelTransition(
        panelEl,
        resumed?.transition ?? DRAWER_SHRINK_TRANSITION,
        true,
      )
      keyboardFlip.set(0)
      if (resumed) y.set(resumed.resumeTo)
    }
  }, [keyboardFlip, freezePanelForFlip, y])

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
    const overtravel = closingWithKeyboardRoomRef.current
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
      reaimKeyboardRoom()
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
  }, [updateMetrics, mounted, driveCloseToTarget, reaimKeyboardRoom])

  //vaul: drive transform directly; overlay opacity inline only while dragging. All-refs so the
  //subscriptions attach once per mount instead of detaching at every gesture commit.
  useEffect(() => {
    if (!mounted) return

    function syncPanelTransform() {
      const drives =
        isPointerDraggingRef.current || isGestureClosingRef.current
      applyPanelTransform(y.get(), keyboardFlip.get(), drives)
    }

    const unsubY = y.on("change", syncPanelTransform)
    const unsubFlip = keyboardFlip.on("change", syncPanelTransform)
    syncPanelTransform()

    return () => {
      unsubY()
      unsubFlip()
    }
  }, [applyPanelTransform, y, keyboardFlip, mounted])

  // ---- keyboard room ------------------------------------------------------------------
  //
  // The sheet is infinitely tall (`bottom: -excess` + the matching spacer) and only ever grows
  // to what it needs. So the keyboard is not something to translate away from — it is a slice of
  // the bottom that stops being usable. Two things happen, together:
  //
  //   · the content box holds `room` = the keyboard's height BELOW its stack, so the handle,
  //     scroller and footer all sit clear of the keyboard;
  //   · the box is allowed to GROW by that much, so the same amount of content stays visible.
  //     Capped, and whatever the cap refuses comes out of the scroller — which is exactly what
  //     keeps the rest reachable by scrolling.
  //
  // Both are animated on one curve, and the cap is primed at the box's CURRENT height first, so
  // the growth starts where the sheet actually is. That priming is what makes the raise a single
  // ease: unprimed, the cap spends most of its travel in the slack above the content, where it
  // changes nothing, while the sheet's top has already arrived — measured on device as a 202px
  // jump in the first ~70ms of a 380ms motion, then a 280ms stall.
  useEffect(() => {
    const content = contentRef.current

    if (!open || !avoidKeyboard) {
      //a focus-primed floor is scoped to an open, keyboard-avoiding sheet; drop any pending retract
      if (floorRetractTimerRef.current) {
        clearTimeout(floorRetractTimerRef.current)
        floorRetractTimerRef.current = null
      }
      // Closing: stay inert. The keyboard dismisses while the sheet slides out, and giving the
      // room back mid-slide relays the box out, fires the content observer and re-aims the close.
      // The panel goes off-screen carrying whatever room it had; a fresh open rebuilds it.
      if (isClosingRef.current) return
      if (content) clearDrawerKeyboardRoom(content)
      appliedRoomRef.current = 0
      visibleCapAppliedRef.current = false
      return
    }

    if (!content) return

    // ── Unfrozen web keyboard path ──────────────────────────────────────────────────────────
    // Non-secure Chromium (no VirtualKeyboard API, not iOS, not native): `useFreezeViewport` could
    // NOT stop the keyboard resizing the VISUAL viewport, so it shrinks by the keyboard's own
    // height. The sheet then only has to FIT that shrunk viewport — reserving `room` ON TOP of the
    // shrink double-counts, growing the box by the keyboard's height a second time until its top
    // climbs off-screen behind the URL bar (the plain-http `ip:port` over-grow). Hold no room; cap
    // the box at the visible viewport (taller content scrolls inside). The frozen paths — iOS
    // scroll-lock, secure-Chromium `overlaysContent`, native `KeyboardResize.None` — keep the
    // viewport whole and fall through to the room mechanism below, untouched.
    if (
      viewportShrinksUnderKeyboard({
        isIOS: isIOS(),
        hasNativeKeyboard: hasNativeKeyboard(),
        hasVirtualKeyboardApi: getVirtualKeyboardApi() !== null,
      })
    ) {
      // Read the stylesheet cap only while nothing of ours overrides it, same as the room path.
      if (!content.style.maxHeight) {
        const parsed = Number.parseFloat(
          getComputedStyle(content).maxHeight,
        )
        cssCapRef.current = Number.isFinite(parsed)
          ? parsed
          : Number.POSITIVE_INFINITY
      }
      const cap = resolveShrunkViewportCap(
        keyboard.isOpen && keyboard.height > 0,
        measureExcessHeight(),
        cssCapRef.current,
      )
      if (cap === null && !visibleCapAppliedRef.current) return

      const boxBefore = content.getBoundingClientRect().height
      if (cap === null) {
        clearDrawerKeyboardRoom(content)
        visibleCapAppliedRef.current = false
      } else {
        //no room, no floor — the shrunk viewport already excludes the keyboard, so the box just caps
        writeDrawerKeyboardRoom(
          content,
          { room: 0, maxHeight: cap, minHeight: null },
          DRAWER_NO_TRANSITION,
        )
        visibleCapAppliedRef.current = true
      }
      void content.offsetHeight

      // The cap only moves the box for content taller than the viewport; when it does, carry it on
      // a composited FLIP like every other height change here (never while a finger owns the drag).
      const panelEl = panelRef.current
      const moved = content.getBoundingClientRect().height - boxBefore
      if (
        Math.abs(moved) > 0.5 &&
        panelEl &&
        !isPointerDraggingRef.current
      ) {
        clearDrawerPanelTransition(panelEl)
        keyboardFlip.set(moved)
        void content.offsetHeight
        applyDrawerPanelTransition(
          panelEl,
          cap === null
            ? DRAWER_SHRINK_TRANSITION
            : DEFAULT_DRAWER_TRANSITION,
          true,
        )
        keyboardFlip.set(0)
      }
      return
    }

    // The LIVE reported height — nothing cached, seeded or guessed. `useKeyboard` only commits
    // stable heights, so iOS's transient mid-field-switch geometry never reaches here.
    const room =
      keyboard.isOpen && keyboard.height > 0 ? keyboard.height : 0
    //nothing in play: skip the measurement block entirely rather than pay for reads that would
    //land mid-open-animation
    if (room === 0 && appliedRoomRef.current === 0) return

    //the keyboard confirmed — its own grow + settle now owns any floor primed on focus (the
    //heldFloor path below eases it and clears it), so stop the retract that would fire mid-motion
    if (room > 0 && floorRetractTimerRef.current) {
      clearTimeout(floorRetractTimerRef.current)
      floorRetractTimerRef.current = null
    }

    // The stylesheet's cap, read while nothing of ours overrides it — from here until the room
    // is handed back, `max-height` is engine-owned. (A rotation mid-keyboard keeps the stale
    // value until the keyboard closes; the sheet is pinned to the keyboard's geometry anyway.)
    if (!content.style.maxHeight) {
      const cssCap = Number.parseFloat(getComputedStyle(content).maxHeight)
      cssCapRef.current = Number.isFinite(cssCap)
        ? cssCap
        : Number.POSITIVE_INFINITY
    }

    const natural = measureDrawerContentNaturalHeight(
      content,
      scrollerRef.current,
      appliedRoomRef.current,
    )
    lastNaturalRef.current = natural
    lastBoxRef.current = content.getBoundingClientRect().height
    // The keyboard drives from here, but a floor left by an earlier content shrink must be EASED
    // to the new height, not dropped. Releasing it outright lets the box fall a whole room in one
    // frame — which is exactly what `dismiss` and `release after collapse` did once a floor could
    // exist. It is cleared for real on settle, where it is no longer holding anything up.
    const heldFloor = content.style.minHeight !== ""
    const target = {
      ...resolveDrawerKeyboardRoom(room, natural, cssCapRef.current),
      ...(heldFloor ? {} : { minHeight: null }),
    }

    // Returning to rest (room 0), with no floor to ease: do NOT clamp max-height to the
    // just-measured `natural`. On old Android WebViews the bottom safe-area inset restores a
    // frame or two AFTER the `keyboardWillHide` that fired this effect — the keyboard event and
    // the window-inset dispatch are two independent native signals (see native.mjs) — so
    // `natural` reads short here by exactly `--safe-area-inset-bottom`, and a cap pinned to it
    // holds the sheet that much too small until `settle` clears it: the sheet shrinks too far on
    // dismiss, then snaps up when the cap is released. At rest the content is the binding
    // constraint anyway, so ride the stylesheet cap and let the box follow its own content up as
    // the inset lands. (When the cap is unreadable — non-finite — keep the measured target.)
    if (room === 0 && !heldFloor && Number.isFinite(cssCapRef.current)) {
      target.maxHeight = cssCapRef.current
    }

    // Grow rides the open curve; giving the room back gets the quicker settle, same as the
    // sheet's own motions.
    const isGrowing = room >= appliedRoomRef.current
    let transition = isGrowing
      ? DEFAULT_DRAWER_TRANSITION
      : DRAWER_SHRINK_TRANSITION

    // A grow-CORRECTION to re-aim rather than restart. iOS reports a raise in two steps as a rule:
    // the first read catches the keyboard mid-slide and the settled height lands ~74ms later, and on
    // a password field the accessory bar is a SECOND step ~280ms later, by which time the first lift
    // has usually settled (`isPanelAnimatingRef` false). Restarting a full-duration curve for the
    // small remaining travel is the visible double-bump; re-aim over a duration proportional to what
    // is LEFT so it reads as one settling motion. `isRaiseContinuation` extends this across the settle
    // gap (see DRAWER_KEYBOARD_RAISE_CONTINUATION_MS); the mid-flight check covers iOS's fast two-step.
    const nowMs = performance.now()
    const isRaiseContinuation =
      nowMs - lastKeyboardGrowTsRef.current <
      DRAWER_KEYBOARD_RAISE_CONTINUATION_MS
    if (isGrowing) lastKeyboardGrowTsRef.current = nowMs
    if (
      isGrowing &&
      appliedRoomRef.current > 0 &&
      (isPanelAnimatingRef.current || isRaiseContinuation)
    ) {
      const liveRoom = readDrawerKeyboardRoom(content)
      const naturalRatePxPerSec = room / DEFAULT_DRAWER_TRANSITION.duration
      transition = {
        ...DEFAULT_DRAWER_TRANSITION,
        duration: clamp(
          Math.abs(room - liveRoom) / naturalRatePxPerSec,
          DRAWER_KEYBOARD_STEP_MIN_DURATION,
          DEFAULT_DRAWER_TRANSITION.duration,
        ),
      }
    }

    // Prime the cap at the box's current height (invisible — a cap equal to the height clamps
    // nothing) so the growth below is measured from here, then run both properties as one.
    if (!content.style.maxHeight) {
      writeDrawerKeyboardRoom(
        content,
        {
          room: appliedRoomRef.current,
          maxHeight: content.getBoundingClientRect().height,
        },
        DRAWER_NO_TRANSITION,
      )
      //commit the prime so the tween starts from it, not from where we were
      void content.offsetHeight
    }

    appliedRoomRef.current = room

    // FLIP. The box's height lands in ONE step — measured before and after — and the difference
    // becomes a transform that starts the sheet where it already was and eases to zero. Animating
    // `max-height` instead put a full sheet reflow on every frame, measured at 23-28fps with
    // 7-11 dropped frames; a transform is composited and costs the main thread nothing.
    //
    // The room lands instantly too. It is an INTERNAL change — the scroller shrinks under the box
    // — so no transform can fake it, and transitioning it was the last layout property left on the
    // hot path: every scenario that changed the room measured 24-29fps while every scenario that
    // did not measured 45-56fps. Applying it in the same step as the growth costs one reflow.
    //
    // In the common case this is invisible: when the box can grow by the whole keyboard height the
    // FLIP offset is exactly the room, so the stack's instant shift is compensated to the pixel and
    // the user sees one composited slide. Only a sheet already at its cap (which cannot grow) shows
    // the internal shift, and that case was never the slow one.
    const boxBefore = content.getBoundingClientRect().height
    writeDrawerKeyboardRoom(
      content,
      heldFloor ? { ...target, minHeight: target.maxHeight } : target,
      DRAWER_NO_TRANSITION,
    )
    const growth = content.getBoundingClientRect().height - boxBefore

    // NOT while a finger is down. A drag dismisses the keyboard itself, which lands here and would
    // put `transition: transform` back on the panel — so every subsequent `y.set()` from the finger
    // would be smoothed over 320ms and the sheet would appear frozen under the touch. The drag owns
    // the transform for as long as it lasts; the layout above has already landed, which is all this
    // path actually has to guarantee.
    const panelEl = panelRef.current
    if (
      Math.abs(growth) > 0.5 &&
      panelEl &&
      !isPointerDraggingRef.current
    ) {
      const resumed = freezePanelForFlip(panelEl, growth)
      // A step duration is proportional to the step's own small travel; once this FLIP is also
      // carrying the slide's remaining travel, that duration would cram hundreds of px into ~220ms.
      // Continue the motion the sheet was already making instead. Reassigned, not shadowed: the
      // settle below hands `max-height`/`min-height` back once the panel has landed, so it has to
      // wait out the duration actually applied.
      if (resumed) transition = resumed.transition
      keyboardFlip.set(growth)
      void content.offsetHeight
      applyDrawerPanelTransition(panelEl, transition, true)
      keyboardFlip.set(0)
      if (resumed) y.set(resumed.resumeTo)
    }

    const runId = beginPanelAnimation("keyboard")
    let cancelled = false
    const settleTimer = setTimeout(
      () => {
        endPanelAnimation(runId)
        if (cancelled) return
        //back at rest: hand `max-height` back to the stylesheet, so the box is free to grow with
        //its own content again (a picker opening, a field wrapping) instead of staying pinned.
        if (appliedRoomRef.current === 0) clearDrawerKeyboardRoom(content)
        //the floor has finished easing to the box's own height: releasing it now changes nothing
        else content.style.minHeight = ""
      },
      transition.duration * 1000 + DRAWER_SETTLE_FALLBACK_MS,
    )

    return () => {
      cancelled = true
      clearTimeout(settleTimer)
      endPanelAnimation(runId)
    }
  }, [
    avoidKeyboard,
    keyboard.isOpen,
    keyboard.height,
    keyboardFlip,
    open,
    beginPanelAnimation,
    endPanelAnimation,
    freezePanelForFlip,
    y,
  ])

  useLayoutEffect(() => {
    if (open) return
    //the sheet slides out carrying whatever keyboard room it held (the room effect goes inert
    //while closing) — the close only needs to know it is there, to over-travel past it
    closingWithKeyboardRoomRef.current = appliedRoomRef.current > 0
  }, [open])

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
          // animate-to-0 below then starts here, not from the close target.
          y.set(resumeFrom)
        }

        const runId = beginPanelAnimation("open")

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
        //nothing animates on this path, and the chrome must not be left dimmed
        clearDrawerChromeTint()
        return
      }

      if (isGestureClosingRef.current) return

      if (isDrawerYClosed(y.get(), metrics.closedY)) {
        handleExitComplete()
        return
      }

      isClosingRef.current = true
      closeTargetRef.current = Number.NaN
      beginPanelAnimation("close")
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
      beginPanelAnimation("drag-close")
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

    const runId = beginPanelAnimation("snap-open")
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

  //The end of the handle's mouse drag, from pointerup (before its close-or-snap decision, the
  //order endTouchDrag keeps) and from pointercancel. It gives the arbiter back as the touch drag's
  //end does: the handle claimed it at pointerdown, and a drawer left holding it made the next edge
  //swipe or row swipe fight a finished drag.
  //The cancel is wired for every pointer type, so a touch cancel on the handle must not free a
  //whole-sheet touch drag that is still live under the same finger.
  const resetHandlePointerDrag = useCallback(() => {
    isPointerDraggingRef.current = false
    syncBackdropGestureAttributes()
    dragStartTimeRef.current = null
    if (!isTouchDragCommittedRef.current) captureRef.current.release()
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
      //Claim the shared arbiter before taking the pointer. The handle drag
      //commits immediately (there is nothing else a handle press could mean), so
      //unlike the sheet path below there is no lock to wait for.
      if (!captureRef.current.request()) return
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
      //Take ownership of the whole transform: an in-flight FLIP is folded into `y` so the finger
      //drives ONE value. Leaving it split let the flip's own tween fight the drag and the sheet
      //sat still under the finger.
      const flip = keyboardFlip.get()
      if (flip !== 0) {
        keyboardFlip.set(0)
        y.set(y.get() + flip)
      }
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
      //
      //Claim the arbiter HERE, at the takeover — not at touchstart. A touch on
      //the sheet usually means scrolling its content; claiming on contact would
      //hold the pointer for every scroll and starve the other gestures.
      captureRef.current.request()
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

      // Keyboard up: a downward pull at the top of the content dismisses the keyboard — and then
      // FALLS THROUGH, so the sheet comes with it as one gesture (SwiftUI drags both away
      // together). Only at the top: below it a downward drag is the user scrolling content back
      // up, and dismissing there would eat the scroll and blur the field mid-content. This used
      // to swallow the gesture entirely, which left the sheet frozen under the finger.
      if (
        keyboardOpenRef.current &&
        draggingDown &&
        (touchScrollerRef.current?.scrollTop ?? 0) <= 0 &&
        Math.abs(deltaY) > DRAG_THRESHOLD_PX
      ) {
        dismissVirtualKeyboard()
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
      captureRef.current.release()

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
  }, [mounted, y, keyboardFlip, syncBackdropGestureAttributes])

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

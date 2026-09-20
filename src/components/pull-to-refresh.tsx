import type {
  MutableRefObject,
  PointerEvent,
  ReactNode,
  Ref,
  RefObject,
} from "react"
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { GestureAxis } from "#adaptv/components/pull-to-refresh-physics"
import {
  ACTIVATION_ROTATION_DEG,
  getPullVisuals,
  ICON_SIZE,
  PULL_MAX,
  PULL_THRESHOLD,
  resolveGestureAxis,
  SPINNER_APPEAR_OFFSET,
  STUCK_HEIGHT,
  STUCK_VERTICAL_PADDING,
} from "#adaptv/components/pull-to-refresh-physics"
import { isSwipeableGestureTarget } from "#adaptv/components/swipeable"
import { useAnimatedStyle } from "#adaptv/hooks/use-animated-style"
import { useReducedMotion } from "#adaptv/hooks/use-reduced-motion"
import { clamp } from "#adaptv/utils/clamp"
import { cn } from "#adaptv/utils/cn"
import { mergeStyles } from "#adaptv/utils/styles"

type RefreshPhase = "idle" | "pulling" | "refreshing" | "closing"

type CloseCause = "release" | "refresh"

/** Programmatic state from {@link usePullToRefresh} for Tier 2 branch paint. */
export type PullToRefreshContextValue = {
  isPulling: boolean
  isRefreshing: boolean
  /** True while the indicator animates closed after refresh or release. */
  isClosing: boolean
  /**
   * Mirrors the root `enabled` prop: false once new pulls are refused. A
   * refresh or close still under way reports through the other fields.
   */
  isEnabled: boolean
}

/**
 * Props for {@link PullToRefresh}.
 *
 * Wraps scrollable content and runs `onRefresh` when the user pulls past the
 * activation threshold at scroll top. Pass `scrollContainerRef` when an outer
 * element (not this root) is the scroll container.
 *
 * @example
 * ```tsx
 * const scrollRef = useRef<HTMLDivElement>(null)
 *
 * <PullToRefresh scrollContainerRef={scrollRef} onRefresh={reload}>
 *   <section ref={scrollRef} className="overflow-y-auto">
 *     …
 *   </section>
 * </PullToRefresh>
 * ```
 */
export interface PullToRefreshProps {
  /**
   * Async work invoked when pull passes the release threshold. The indicator
   * holds until the promise settles (and for at least `stuckMinMs`), then
   * closes. A rejection closes it too: the error goes to `reportError` (the
   * console where there is none), the way a throwing event listener's does,
   * and is not rethrown. Handle it inside `onRefresh` to show it in the app.
   */
  onRefresh: () => Promise<unknown>
  children: ReactNode
  /** Tier 2 layout utilities on the gesture root (scroll container when omitted). */
  className?: string
  /**
   * When false, new pulls are refused. A refresh or close already under way
   * still finishes (a pull still held is closed without refreshing), and then
   * the row renders children only — no pull gestures or indicator.
   */
  enabled?: boolean
  /** Minimum time (ms) to hold the refreshing snap before closing. */
  stuckMinMs?: number
  /** Page-level overflow element; when omitted, this root is the scroll container. */
  scrollContainerRef?: RefObject<HTMLElement | null>
}

//LOCKED: `relative` is the containing block the indicator track is absolutely
//positioned against — without it the spinner escapes to the nearest positioned
//ancestor and animates somewhere else entirely. `shrink-0 grow-0` is BASE: it is a
//flex-line default, and a consumer putting this in a `flex-1` column is a legitimate
//layout choice that does not break the gesture.
const PULL_TO_REFRESH_ROOT_LOCKED_CLASS = "relative"
const PULL_TO_REFRESH_ROOT_BASE_CLASS = "shrink-0 grow-0"
const PULL_TO_REFRESH_STATUS_LAYOUT_CLASS = "sr-only"
const PULL_TO_REFRESH_INDICATOR_TRACK_LAYOUT_CLASS =
  "pointer-events-none absolute inset-x-0 z-0 flex justify-center motion-reduce:transition-none"
const PULL_TO_REFRESH_INDICATOR_ROTATOR_LAYOUT_CLASS =
  "origin-center motion-reduce:transition-none"
const PULL_TO_REFRESH_INDICATOR_SURFACE_CLASS = "text-gray-950"
const PULL_TO_REFRESH_INDICATOR_SPIN_CLASS = "animate-spin"
const PULL_TO_REFRESH_CONTENT_MOTION_LAYOUT_CLASS =
  "relative z-0 motion-reduce:transition-none"
const PULL_TO_REFRESH_CONTENT_STATIC_LAYOUT_CLASS = "relative z-0"

/** A rejected `onRefresh`, reported the way a throwing event listener's error is. */
function reportRefreshError(error: unknown) {
  if (typeof reportError === "function") reportError(error)
  else console.error(error)
}

const PullToRefreshContext =
  createContext<PullToRefreshContextValue | null>(null)

/**
 * Reactive pull/refresh state for {@link PullToRefresh} trees.
 * Use in Tier 2 wrappers when chrome should track live gesture phase —
 * not `data-*` selectors.
 */
export function usePullToRefresh(): PullToRefreshContextValue {
  const ctx = useContext(PullToRefreshContext)
  if (!ctx) {
    throw new Error(
      "usePullToRefresh must be used within <PullToRefresh>.",
    )
  }
  return ctx
}

/* =============================================================================
 * LAYOUT
 *
 * Pull distances, indicator geometry, and gesture axis resolution. Prop-driven
 * sizes use rem only where SVG attributes cannot read CSS variables.
 * ============================================================================= */

const STUCK_MIN_MS = 750
const SPIN_DURATION = 0.75
/** Fallback when CSS variables are unavailable in SVG attribute context. */
const ICON_STROKE = 2
const ARC_COMPLETE_RATIO = 0.78
const SCROLL_TOP_THRESHOLD = 3

// The pull geometry (thresholds, activation curve, indicator projection) lives in
// pull-to-refresh-physics.ts, pure and unit-tested; this file drives it.

function setRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return
  if (typeof ref === "function") ref(value)
  else (ref as MutableRefObject<T | null>).current = value
}

function isFromSwipeable(target: EventTarget | null) {
  return isSwipeableGestureTarget(target)
}

const PULL_TO_REFRESH_MOTION_INSTANT = { duration: 0 } as const

/** Pull past threshold → dock at refreshing height (ease-out, not a stiff spring). */
const STUCK_SNAP_DURATION_MIN = 0.42
const STUCK_SNAP_DURATION_MAX = 0.56
const STUCK_SNAP_EASE = [0.22, 1, 0.36, 1] as const

function buildStuckSnapTransition(
  pullDistance: number,
  reducedMotion: boolean,
) {
  if (reducedMotion) return PULL_TO_REFRESH_MOTION_INSTANT
  const travel = clamp(
    pullDistance - STUCK_HEIGHT,
    0,
    PULL_MAX - STUCK_HEIGHT,
  )
  const range = PULL_MAX - STUCK_HEIGHT
  const ratio = range > 0 ? travel / range : 0
  return {
    type: "tween" as const,
    duration:
      STUCK_SNAP_DURATION_MIN +
      ratio * (STUCK_SNAP_DURATION_MAX - STUCK_SNAP_DURATION_MIN),
    ease: STUCK_SNAP_EASE,
  }
}

/** After refresh completes — no fling velocity, slightly longer ease-out. */
const SETTLE_CLOSE_EASE = {
  type: "tween" as const,
  duration: 0.38,
  ease: [0.23, 1, 0.32, 1] as const,
}

const RELEASE_VELOCITY_CAP_PX_S = 900
const RELEASE_VELOCITY_BLEND = 0.15
const RELEASE_CLOSE_SPRING = {
  type: "spring" as const,
  stiffness: 170,
  damping: 42,
  mass: 1,
  bounce: 0,
  restDelta: 0.5,
}

function buildReleaseCloseTransition(
  velocityPxPerS: number,
  reducedMotion: boolean,
) {
  if (reducedMotion) return PULL_TO_REFRESH_MOTION_INSTANT
  return {
    ...RELEASE_CLOSE_SPRING,
    velocity: clamp(
      velocityPxPerS * RELEASE_VELOCITY_BLEND,
      0,
      RELEASE_VELOCITY_CAP_PX_S,
    ),
  }
}

function buildCloseTransition(
  cause: CloseCause,
  releaseVelocityPxPerS: number,
  reducedMotion: boolean,
) {
  if (reducedMotion) return PULL_TO_REFRESH_MOTION_INSTANT
  return cause === "release"
    ? buildReleaseCloseTransition(releaseVelocityPxPerS, false)
    : SETTLE_CLOSE_EASE
}

type PullToRefreshMotionTransition =
  | typeof PULL_TO_REFRESH_MOTION_INSTANT
  | ReturnType<typeof buildStuckSnapTransition>
  | ReturnType<typeof buildReleaseCloseTransition>
  | typeof SETTLE_CLOSE_EASE

function buildSpinnerTrackTransition(
  transition: PullToRefreshMotionTransition,
) {
  return {
    opacity: transition,
    top: transition,
    scale: transition,
  }
}

function buildSpinnerRotateTransition(
  transition: PullToRefreshMotionTransition,
) {
  return { rotate: transition }
}

function PullIndicatorArc({
  arcProgress,
  spinning,
  reducedMotion,
}: {
  arcProgress: number
  spinning: boolean
  reducedMotion: boolean
}) {
  const radius = (ICON_SIZE - ICON_STROKE) / 2
  const circumference = 2 * Math.PI * radius
  const visibleLength = circumference * ARC_COMPLETE_RATIO * arcProgress
  const center = ICON_SIZE / 2

  return (
    <svg
      width={ICON_SIZE}
      height={ICON_SIZE}
      viewBox={`0 0 ${ICON_SIZE} ${ICON_SIZE}`}
      className={cn(
        PULL_TO_REFRESH_INDICATOR_SURFACE_CLASS,
        spinning && !reducedMotion && PULL_TO_REFRESH_INDICATOR_SPIN_CLASS,
      )}
      style={
        spinning && !reducedMotion
          ? { animationDuration: `${SPIN_DURATION}s` }
          : undefined
      }
      aria-hidden
    >
      <title>Pull to refresh</title>
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={ICON_STROKE}
        strokeLinecap="round"
        strokeDasharray={`${visibleLength} ${circumference}`}
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  )
}

/**
 * Scroll-top pull gesture that runs `onRefresh` and animates a neutral indicator.
 * Ref attaches to the scroll container (this root, or use `scrollContainerRef`).
 */
export const PullToRefresh = forwardRef<
  HTMLDivElement,
  PullToRefreshProps
>(function PullToRefresh(
  {
    onRefresh,
    children,
    className,
    enabled = true,
    stuckMinMs = STUCK_MIN_MS,
    scrollContainerRef,
  },
  ref,
) {
  const reducedMotion = useReducedMotion()
  const [phase, setPhase] = useState<RefreshPhase>("idle")
  const [pullOffset, setPullOffset] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const spinnerTrackRef = useRef<HTMLDivElement>(null)
  const spinnerRotatorRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const pullStartX = useRef(0)
  const pullStartY = useRef(0)
  const gestureAxis = useRef<GestureAxis>("pending")
  const gestureActive = useRef(false)
  const isPulling = useRef(false)
  const phaseRef = useRef(phase)
  const pullOffsetRef = useRef(pullOffset)
  const enabledRef = useRef(enabled)
  const refreshingStartedAtRef = useRef(0)
  //When a settled refresh may close: a time, not a timer, so a timer the app's
  //`<Activity>` cleared by hiding the row is armed again, for the time left,
  //when it shows the row again.
  const [holdUntil, setHoldUntil] = useState<number | null>(null)
  const closeCauseRef = useRef<CloseCause>("release")
  const releaseVelocityYRef = useRef(0)
  const lastPointerSampleRef = useRef({ y: 0, t: 0 })
  phaseRef.current = phase
  pullOffsetRef.current = pullOffset
  enabledRef.current = enabled

  const isDragging = phase === "pulling"
  const isRefreshing = phase === "refreshing"
  const isClosing = phase === "closing"

  //Every field is a function of the PHASE, which moves a few times per gesture;
  //the offset moves on every pointer frame. Built once per phase so a consumer
  //of `usePullToRefresh()` renders when its answer changes, not per frame.
  const contextValue = useMemo<PullToRefreshContextValue>(
    () => ({
      isPulling: isDragging,
      isRefreshing,
      isClosing,
      isEnabled: enabled,
    }),
    [isDragging, isRefreshing, isClosing, enabled],
  )

  const setScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el
      setRef(ref, el)
    },
    [ref],
  )

  const getScrollEl = useCallback(() => {
    return scrollContainerRef?.current ?? scrollRef.current
  }, [scrollContainerRef])

  const isAtScrollTop = useCallback(() => {
    const el = getScrollEl()
    if (!el) return false
    return el.scrollTop <= SCROLL_TOP_THRESHOLD
  }, [getScrollEl])

  const clearGesture = useCallback(() => {
    gestureActive.current = false
    gestureAxis.current = "pending"
    isPulling.current = false
    lastPointerSampleRef.current = { y: 0, t: 0 }
  }, [])

  const sampleReleaseVelocity = useCallback((clientY: number) => {
    const now = performance.now()
    const prev = lastPointerSampleRef.current
    if (prev.t > 0) {
      const dt = (now - prev.t) / 1000
      if (dt > 0.001 && dt < 0.12) {
        const instantV = (clientY - prev.y) / dt
        releaseVelocityYRef.current =
          releaseVelocityYRef.current * 0.65 + instantV * 0.35
      }
    }
    lastPointerSampleRef.current = { y: clientY, t: now }
  }, [])

  const abortPull = useCallback(() => {
    clearGesture()
    setPullOffset(0)
    setPhase((prev) => (prev === "pulling" ? "idle" : prev))
  }, [clearGesture])

  const applyPull = useCallback((delta: number) => {
    if (delta <= 0) return
    isPulling.current = true
    setPhase((prev) =>
      prev === "idle" || prev === "pulling" ? "pulling" : prev,
    )
    setPullOffset(Math.min(delta, PULL_MAX))
  }, [])

  const beginGesture = useCallback(
    (clientX: number, clientY: number) => {
      //`enabled={false}` refuses a new pull; what is already showing still ends
      if (!enabledRef.current) return false
      const p = phaseRef.current
      if (p === "refreshing") return false
      if (p === "closing") {
        setPullOffset(0)
        setPhase("idle")
      }
      releaseVelocityYRef.current = 0
      lastPointerSampleRef.current = { y: clientY, t: performance.now() }
      if (!isAtScrollTop()) return false
      gestureActive.current = true
      gestureAxis.current = "pending"
      pullStartX.current = clientX
      pullStartY.current = clientY
      return true
    },
    [isAtScrollTop],
  )

  const processPullMove = useCallback(
    (clientX: number, clientY: number) => {
      //defensive: the disable effect clears the gesture once it runs; this
      //covers the moves between that commit and the effect, which no test reaches
      if (!gestureActive.current || !enabledRef.current) return false
      const p = phaseRef.current
      if (p === "refreshing" || p === "closing") return false

      const dx = clientX - pullStartX.current
      const dy = clientY - pullStartY.current

      if (gestureAxis.current === "pending") {
        const axis = resolveGestureAxis(dx, dy)
        if (axis === "pending") return false
        if (axis === "horizontal") {
          clearGesture()
          return false
        }
        gestureAxis.current = "vertical"
      }

      if (!isAtScrollTop()) {
        abortPull()
        return false
      }

      if (dy <= 0) return false

      sampleReleaseVelocity(clientY)
      applyPull(dy)
      return true
    },
    [
      clearGesture,
      isAtScrollTop,
      abortPull,
      applyPull,
      sampleReleaseVelocity,
    ],
  )

  const runRefresh = useCallback(async () => {
    setPhase("refreshing")
    refreshingStartedAtRef.current = Date.now()
    //The app's rejection is the app's error, and nobody awaits this call (a
    //pointer release starts it), so rethrowing would only mint an unhandled
    //rejection of our own. It goes where a throwing event listener's goes, and
    //the row closes either way so the next pull can refresh. A `catch`, not a
    //truthiness check on the reason: a bare `reject()` is a rejection too.
    try {
      await onRefresh()
    } catch (error) {
      reportRefreshError(error)
    }
    const elapsed = Date.now() - refreshingStartedAtRef.current
    const wait = Math.max(0, stuckMinMs - elapsed)
    if (wait <= 0) {
      closeCauseRef.current = "refresh"
      setPhase("closing")
      return
    }
    setHoldUntil(Date.now() + wait)
  }, [onRefresh, stuckMinMs])

  useEffect(() => {
    if (holdUntil === null) return
    const timeout = setTimeout(
      () => {
        setHoldUntil(null)
        closeCauseRef.current = "refresh"
        setPhase("closing")
      },
      Math.max(0, holdUntil - Date.now()),
    )
    return () => clearTimeout(timeout)
  }, [holdUntil])

  const handlePullEnd = useCallback(() => {
    const offset = pullOffsetRef.current
    clearGesture()

    if (
      offset >= PULL_THRESHOLD &&
      phaseRef.current !== "refreshing" &&
      phaseRef.current !== "closing"
    ) {
      runRefresh()
      return
    }

    if (offset < SPINNER_APPEAR_OFFSET) {
      setPullOffset(0)
      setPhase("idle")
      return
    }

    closeCauseRef.current = "release"
    setPhase("closing")
  }, [clearGesture, runRefresh])

  //Turned off, the row lets go of any finger: a press that has not moved yet
  //would otherwise stay armed across the toggle and pull on the next hover. A
  //pull already under way closes what is showing, never refreshing: touch
  //listeners are already gone, so no release would come.
  useEffect(() => {
    if (enabled) return
    const wasPulling = phaseRef.current === "pulling"
    const offset = pullOffsetRef.current
    clearGesture()
    if (!wasPulling) return
    if (offset < SPINNER_APPEAR_OFFSET) {
      setPullOffset(0)
      setPhase("idle")
      return
    }
    closeCauseRef.current = "release"
    setPhase("closing")
  }, [enabled, clearGesture])

  const onCloseAnimationComplete = useCallback(() => {
    setPhase("idle")
    setPullOffset(0)
  }, [])

  const isAtScrollTopRef = useRef(isAtScrollTop)
  const beginGestureRef = useRef(beginGesture)
  const clearGestureRef = useRef(clearGesture)
  const handlePullEndRef = useRef(handlePullEnd)
  const applyPullRef = useRef(applyPull)
  const abortPullRef = useRef(abortPull)
  const processPullMoveRef = useRef(processPullMove)
  isAtScrollTopRef.current = isAtScrollTop
  beginGestureRef.current = beginGesture
  clearGestureRef.current = clearGesture
  handlePullEndRef.current = handlePullEnd
  applyPullRef.current = applyPull
  abortPullRef.current = abortPull
  processPullMoveRef.current = processPullMove

  useEffect(() => {
    if (!enabled) return

    let boundEl: HTMLElement | null = null
    let rafId = 0

    function onTouchStart(e: TouchEvent) {
      if (isFromSwipeable(e.target)) return
      const touch = e.touches[0]
      if (!beginGestureRef.current(touch.clientX, touch.clientY)) return
    }

    function onTouchMove(e: TouchEvent) {
      const touch = e.touches[0]
      if (processPullMoveRef.current(touch.clientX, touch.clientY)) {
        e.preventDefault()
      }
    }

    function onTouchEnd() {
      if (!gestureActive.current) return
      if (!isPulling.current) {
        clearGestureRef.current()
        return
      }
      handlePullEndRef.current()
    }

    function unbindTouch() {
      if (!boundEl) return
      boundEl.removeEventListener("touchstart", onTouchStart)
      boundEl.removeEventListener("touchmove", onTouchMove)
      boundEl.removeEventListener("touchend", onTouchEnd)
      boundEl.removeEventListener("touchcancel", onTouchEnd)
      boundEl = null
    }

    function bindTouch(el: HTMLElement) {
      if (boundEl === el) return
      unbindTouch()
      el.addEventListener("touchstart", onTouchStart, { passive: true })
      el.addEventListener("touchmove", onTouchMove, { passive: false })
      el.addEventListener("touchend", onTouchEnd, { passive: true })
      el.addEventListener("touchcancel", onTouchEnd, { passive: true })
      boundEl = el
    }

    function attach() {
      const el = scrollContainerRef?.current ?? scrollRef.current
      if (!el) {
        rafId = requestAnimationFrame(attach)
        return
      }
      bindTouch(el)
    }

    attach()
    return () => {
      cancelAnimationFrame(rafId)
      unbindTouch()
    }
  }, [enabled, scrollContainerRef])

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      if (isFromSwipeable(e.target)) return
      if (!beginGesture(e.clientX, e.clientY)) return
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    },
    [beginGesture],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      processPullMove(e.clientX, e.clientY)
    },
    [processPullMove],
  )

  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
      if (!gestureActive.current) return
      if (!isPulling.current) {
        clearGesture()
        return
      }
      handlePullEnd()
    },
    [clearGesture, handlePullEnd],
  )

  const pulling = getPullVisuals(pullOffset)
  const instant = PULL_TO_REFRESH_MOTION_INSTANT

  const contentY = isDragging
    ? pulling.contentY
    : isRefreshing
      ? STUCK_HEIGHT
      : 0

  const showSpinner = isDragging
    ? pulling.showSpinner
    : isRefreshing || isClosing

  const closeTransition = buildCloseTransition(
    closeCauseRef.current,
    releaseVelocityYRef.current,
    reducedMotion,
  )
  const stuckSnapTransition = buildStuckSnapTransition(
    pullOffset,
    reducedMotion,
  )

  const spinnerTransition = isDragging
    ? instant
    : isClosing
      ? closeTransition
      : isRefreshing
        ? stuckSnapTransition
        : instant

  const spinnerTrackTransition =
    buildSpinnerTrackTransition(spinnerTransition)
  const spinnerRotateTransition = buildSpinnerRotateTransition(
    isDragging ? instant : spinnerTransition,
  )
  const contentTransition = isDragging
    ? instant
    : isRefreshing
      ? stuckSnapTransition
      : closeTransition

  const spinnerTop = isDragging
    ? pulling.spinnerTop
    : isClosing
      ? 0
      : STUCK_VERTICAL_PADDING
  const spinnerOpacity = isDragging
    ? pulling.opacity
    : isRefreshing
      ? 1
      : 0
  const spinnerScale = isDragging ? pulling.scale : isClosing ? 0 : 1
  const spinnerRotate = isDragging
    ? pulling.rotation
    : isRefreshing || isClosing
      ? ACTIVATION_ROTATION_DEG
      : 0

  const liveStatus = isRefreshing
    ? "Refreshing"
    : isDragging && pullOffset >= PULL_THRESHOLD
      ? "Release to refresh"
      : ""

  // Avoid a persistent translateY layer while idle — iOS scroll can drop
  // composited descendants (e.g. swipeable row content) under that transform.
  const liftContent = phase !== "idle" || pullOffset > 0

  //Imperative, not motion components: the content layer wraps the app's whole
  //scroll content, and this component renders on every pointer frame of a pull.
  //A motion component there re-renders every app motion element inside on each
  //of those frames and overrides the app's own `LazyMotion`. The spinner goes
  //the same way so the component carries no motion context at all.
  //→ docs/decisions/animation.md §3.1
  //Off, the row still draws until it is idle: a refresh under way settles and
  //a close finishes, and only then do the gesture layers go.
  const attached = enabled || phase !== "idle"
  const liveSpinner = attached && showSpinner
  useAnimatedStyle(
    spinnerTrackRef,
    liveSpinner
      ? { top: spinnerTop, opacity: spinnerOpacity, scale: spinnerScale }
      : null,
    spinnerTrackTransition,
  )
  useAnimatedStyle(
    spinnerRotatorRef,
    liveSpinner ? { rotate: spinnerRotate } : null,
    spinnerRotateTransition,
  )
  //the close resolves here, and only here: a phase left in `closing` keeps the
  //content lifted until the next touch
  useAnimatedStyle(
    contentRef,
    attached && liftContent ? { y: contentY } : null,
    { y: contentTransition },
    isClosing ? onCloseAnimationComplete : undefined,
  )

  if (!attached) {
    return (
      <PullToRefreshContext.Provider value={contextValue}>
        <div
          ref={setScrollRef}
          className={mergeStyles({
            base: PULL_TO_REFRESH_ROOT_BASE_CLASS,
            className,
            locked: PULL_TO_REFRESH_ROOT_LOCKED_CLASS,
          })}
        >
          {children}
        </div>
      </PullToRefreshContext.Provider>
    )
  }

  return (
    <PullToRefreshContext.Provider value={contextValue}>
      <div
        data-adaptv="pull-to-refresh"
        ref={setScrollRef}
        className={mergeStyles({
          base: PULL_TO_REFRESH_ROOT_BASE_CLASS,
          className,
          locked: PULL_TO_REFRESH_ROOT_LOCKED_CLASS,
        })}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div
          aria-live="polite"
          className={PULL_TO_REFRESH_STATUS_LAYOUT_CLASS}
        >
          {liveStatus}
        </div>
        {showSpinner && (
          <div
            ref={spinnerTrackRef}
            className={PULL_TO_REFRESH_INDICATOR_TRACK_LAYOUT_CLASS}
          >
            <div
              ref={spinnerRotatorRef}
              className={PULL_TO_REFRESH_INDICATOR_ROTATOR_LAYOUT_CLASS}
            >
              <PullIndicatorArc
                arcProgress={isDragging ? pulling.arcProgress : 1}
                spinning={isRefreshing}
                reducedMotion={reducedMotion}
              />
            </div>
          </div>
        )}
        {/* One element whether lifted or not, so a pull never remounts the
            app's content; idle, it carries no transform at all. */}
        <div
          ref={contentRef}
          className={
            liftContent
              ? PULL_TO_REFRESH_CONTENT_MOTION_LAYOUT_CLASS
              : PULL_TO_REFRESH_CONTENT_STATIC_LAYOUT_CLASS
          }
        >
          {children}
        </div>
      </div>
    </PullToRefreshContext.Provider>
  )
})
PullToRefresh.displayName = "PullToRefresh"

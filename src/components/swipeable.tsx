import type { CSSProperties, ReactNode } from "react"
import {
  Children,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  resolveSwipeRelease,
  SPRING_SUBSTEP,
  springStep,
} from "#adaptv/components/swipeable-physics"
import {
  GesturePriority,
  useGestureCapture,
} from "#adaptv/hooks/use-gesture-capture"
import { willOpenVirtualKeyboard } from "#adaptv/hooks/use-keyboard"
import { useReducedMotion } from "#adaptv/hooks/use-reduced-motion"
import { composeStyles } from "#adaptv/utils/styles"

type SwipeableConfig = {
  /** Fraction of natural width the row must pass to open on release. */
  openThreshold: number
  /** Fraction of the open offset the row must retreat to close on release. */
  closeThreshold: number
  /** Release speed (px/s) that flicks the row open/closed regardless of position. */
  velocityThreshold: number
  /** Max angle from horizontal (deg) still treated as a horizontal swipe. */
  directionLockAngle: number
  /** Resistance applied while dragging past the natural width (0–1). */
  overshootFriction: number
  springStiffness: number
  springDamping: number
  /** Heavier damping on close so the row doesn't bounce open again. */
  springDampingClose: number
  springMass: number
}

const SWIPEABLE_DEFAULTS: SwipeableConfig = {
  openThreshold: 0.3,
  closeThreshold: 0.25,
  velocityThreshold: 250,
  directionLockAngle: 30,
  overshootFriction: 0.4,
  springStiffness: 500,
  springDamping: 40,
  springDampingClose: 55,
  springMass: 0.8,
}

type Side = "left" | "right"
type OpenSide = false | Side

/* =============================================================================
 * PHYSICS — the spring integrator (springStep/SPRING_SUBSTEP) and the release
 * decision (resolveSwipeRelease) now live in swipeable-physics.ts, pure and
 * unit-tested. This file drives them and owns the DOM/RAF side effects.
 * ============================================================================= */

/** Trailing sample window (ms) used to compute release velocity on flick. */
const VELOCITY_WINDOW_MS = 60

/**
 * Travel the engine calls no travel at all (px).
 *
 * `applyOffset` parks the transform at `""` inside this of home, and `springTo`
 * calls the row already at rest inside this of its target. Anything smaller is
 * a rounding artefact of the spring, not a movement anyone can see.
 */
const SETTLE_EPSILON_PX = 0.5

/** Mirror the root's border-radius onto clip-path — overflow alone lets a
 *  transformed child bleed past rounded corners on iOS WebKit. */
function syncRootClip(root: HTMLElement) {
  const s = getComputedStyle(root)
  const tl = s.borderTopLeftRadius
  const tr = s.borderTopRightRadius
  const br = s.borderBottomRightRadius
  const bl = s.borderBottomLeftRadius
  const flat = tl === "0px" && tr === "0px" && br === "0px" && bl === "0px"
  root.style.clipPath = flat
    ? ""
    : `inset(0 round ${tl} ${tr} ${br} ${bl})`
}

function isOpaque(color: string) {
  return (
    color !== "" && color !== "transparent" && color !== "rgba(0, 0, 0, 0)"
  )
}

/** Background of the action nearest the sliding content — used to colour the
 *  rubber-band fill. Walks a shallow content-facing chain (wrappers are common). */
function readAdjacentActionBackground(
  panel: HTMLElement,
  side: Side,
): string | null {
  const items = Array.from(panel.children).filter(
    (c): c is HTMLElement =>
      c instanceof HTMLElement && !c.hasAttribute("data-swipeable-fill"),
  )
  let node: Element | null =
    side === "right" ? items[0] : items[items.length - 1]

  for (let depth = 0; node instanceof HTMLElement && depth < 4; depth++) {
    const bg = getComputedStyle(node).backgroundColor
    if (isOpaque(bg)) return bg
    node =
      side === "right" ? node.firstElementChild : node.lastElementChild
  }
  return null
}

/**
 * Park or expose one tray. A parked tray sits off-screen under a transform,
 * which hides it from the eye and from nothing else — so it is `inert`: out of
 * the tab order, the accessibility tree, find-in-page and selection alike.
 *
 * `inert` alone, no `aria-hidden` + `tabIndex=-1` fallback. BCD 8.0.6
 * (`html.global_attributes.inert`) has it from Safari and WebView iOS 15.5,
 * Chrome and WebView Android 102. Android refuses to boot below WebView 111
 * (`MIN_ANDROID_WEBVIEW`, vite/capacitor-config.ts), so the only gap is iOS
 * 15.0–15.4. Below 15.4 a fallback would do harm: the tray's layout
 * lives in `styles/swipeable.css` inside `@layer` (iOS 15.4), so there the tray
 * is never positioned off-screen, it lays out in flow and in view, and hiding
 * it would hide visible buttons. That leaves 15.4 alone, where the unknown
 * attribute degrades to exactly the behaviour before it — and `aria-hidden` is
 * the mechanism the register already rejected for VoiceOver (B20, WebKit
 * 201887).
 *
 * A tray about to go inert that holds focus hands it to the row's content
 * first. Left alone, the browser drops it to <body> and the next Tab starts
 * from the top of the page; the content is what the user was acting on. It is
 * made focusable for that hand-off only, never joining the tab order.
 */
function parkTray(
  tray: HTMLElement | null,
  parked: boolean,
  content: HTMLElement | null,
) {
  if (!tray || tray.hasAttribute("inert") === parked) return
  const active = document.activeElement
  if (parked && content && active && tray.contains(active)) {
    if (!content.hasAttribute("tabindex")) {
      content.tabIndex = -1
      const release = () => content.removeAttribute("tabindex")
      content.addEventListener("blur", release, { once: true })
      content.focus({ preventScroll: true })
      if (document.activeElement !== content) {
        content.removeEventListener("blur", release)
        release()
      }
    } else {
      content.focus({ preventScroll: true })
    }
  }
  tray.toggleAttribute("inert", parked)
}

type DismissEntry = { isOpen: () => boolean; close: () => void }

const dismissRegistry = new Set<DismissEntry>()
let dismissInstalled = false

function closeAllOpen() {
  for (const entry of dismissRegistry) {
    if (entry.isOpen()) entry.close()
  }
}

function installGlobalDismiss() {
  if (dismissInstalled || typeof document === "undefined") return
  dismissInstalled = true

  //a focused text field means the keyboard is coming up — clear open rows
  document.addEventListener(
    "focusin",
    (e) => {
      if (
        e.target instanceof Element &&
        willOpenVirtualKeyboard(e.target)
      ) {
        closeAllOpen()
      }
    },
    true,
  )
}

function registerDismiss(entry: DismissEntry) {
  installGlobalDismiss()
  dismissRegistry.add(entry)
  return () => {
    dismissRegistry.delete(entry)
  }
}

/** Nearest scrollable ancestor — an open row closes when its list scrolls. */
function findScrollAncestor(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (
    node &&
    node !== document.body &&
    node !== document.documentElement
  ) {
    //computed style only. This used to short-circuit on `scrollable-y` /
    //`scrollable-x` / `scrollable` class names first; those utilities are gone, so
    //the checks matched nothing and only hid the fact that the real test was always
    //the one below — which finds a `ScrollView`, a drawer scroller and a
    //hand-rolled `overflow-y-auto` alike, without knowing any class names.
    const style = getComputedStyle(node)
    const flow = `${style.overflow}${style.overflowY}${style.overflowX}`
    if (/(auto|scroll|overlay)/.test(flow)) return node
    node = node.parentElement
  }
  return null
}

export const SWIPEABLE_LEFT_ACTIONS_SLOT = Symbol.for(
  "adaptv:swipeable.left-actions",
)
export const SWIPEABLE_RIGHT_ACTIONS_SLOT = Symbol.for(
  "adaptv:swipeable.right-actions",
)
export const SWIPEABLE_CONTENT_SLOT = Symbol.for(
  "adaptv:swipeable.content",
)

type SwipeableSlotProps = {
  children?: ReactNode
  style?: CSSProperties
}

type SwipeableSlot = ((props: SwipeableSlotProps) => ReactNode) & {
  displayName?: string
}

function markSlot(component: SwipeableSlot, slot: symbol): SwipeableSlot {
  ;(component as unknown as Record<symbol, boolean>)[slot] = true
  return component
}

function isSlot(
  child: ReactNode,
  slot: symbol,
  component: SwipeableSlot,
  displayName: string,
): boolean {
  if (!isValidElement(child)) return false
  const type = child.type
  if (type === component) return true
  if (typeof type === "function" || typeof type === "object") {
    const marked = type as unknown as Record<symbol, boolean> & {
      displayName?: string
    }
    return Boolean(marked[slot]) || marked.displayName === displayName
  }
  return false
}

//marker shells — SwipeableRoot reads their `.props.children` directly and never
//renders them, so the body is never invoked; identity is all that matters here
const SwipeableLeftActions = markSlot(function SwipeableLeftActions(
  _props: SwipeableSlotProps,
) {
  return null
}, SWIPEABLE_LEFT_ACTIONS_SLOT)
SwipeableLeftActions.displayName = "Swipeable.LeftActions"

const SwipeableRightActions = markSlot(function SwipeableRightActions(
  _props: SwipeableSlotProps,
) {
  return null
}, SWIPEABLE_RIGHT_ACTIONS_SLOT)
SwipeableRightActions.displayName = "Swipeable.RightActions"

const SwipeableContent = markSlot(function SwipeableContent(
  _props: SwipeableSlotProps,
) {
  return null
}, SWIPEABLE_CONTENT_SLOT)
SwipeableContent.displayName = "Swipeable.Content"

export type SwipeableContextValue = {
  isOpen: boolean
  openSide: OpenSide
  isEnabled: boolean
}

const SwipeableContext = createContext<SwipeableContextValue | null>(null)

/** Reactive open side / enabled state for {@link Swipeable} compound trees. */
export function useSwipeable(): SwipeableContextValue {
  const ctx = useContext(SwipeableContext)
  if (!ctx)
    throw new Error("useSwipeable must be used within <Swipeable>.")
  return ctx
}

type SwipeableGroupContextValue = {
  register: (close: () => void) => () => void
  notifyOpen: (close: () => void) => void
}

const SwipeableGroupContext =
  createContext<SwipeableGroupContextValue | null>(null)

export type SwipeableGroupHandle = {
  closeAll: () => void
}

type SwipeableGroupProps = {
  children: ReactNode
  /** Close siblings when one opens. @default true */
  closeOnOpen?: boolean
}

const SwipeableGroup = forwardRef<
  SwipeableGroupHandle,
  SwipeableGroupProps
>(function SwipeableGroup({ children, closeOnOpen = true }, ref) {
  const members = useRef(new Set<() => void>())

  const register = useCallback((close: () => void) => {
    members.current.add(close)
    return () => {
      members.current.delete(close)
    }
  }, [])

  const notifyOpen = useCallback(
    (opened: () => void) => {
      if (!closeOnOpen) return
      for (const close of members.current) {
        if (close !== opened) close()
      }
    },
    [closeOnOpen],
  )

  useImperativeHandle(
    ref,
    () => ({
      closeAll: () => {
        for (const close of members.current) close()
      },
    }),
    [],
  )

  const value = useMemo(
    () => ({ register, notifyOpen }),
    [register, notifyOpen],
  )

  return (
    <SwipeableGroupContext.Provider value={value}>
      {children}
    </SwipeableGroupContext.Provider>
  )
})
SwipeableGroup.displayName = "Swipeable.Group"

export type SwipeableHandle = {
  /** Live open side (`false` when closed). */
  readonly open: OpenSide
  /** Animate closed (no-op when already closed). */
  close: () => void
}

type SwipeableRootProps = Partial<SwipeableConfig> & {
  children: ReactNode
  /**
   * The row opened to `side`, from closed or from its other side. Called as
   * the open starts, not when it lands, so an open caught mid-spring and pulled
   * shut still reports this and then `onClose`. A release that springs the row
   * back to the side already reported calls nothing, except on a controlled
   * row whose `open` prop does not say `side`: a close the parent asked for,
   * caught and thrown back open, is reported so the parent can follow it.
   */
  onOpen?: (side: Side) => void
  /**
   * The row closed after an `onOpen`, called once when the close lands. A drag
   * that never opened the row, or a `close()` that finds nothing open, calls
   * nothing, so an `onClose` always follows an `onOpen` with no other
   * `onClose` between them.
   */
  onClose?: () => void
  /**
   * Controlled open state. Omit for uncontrolled rows. After the first value
   * (including `false`), omitting closes the row — same as `open={false}`.
   */
  open?: OpenSide
  enabled?: boolean
  className?: string
  style?: CSSProperties
}

/**
 * Headless swipeable row — compose `Swipeable.LeftActions` / `.RightActions` /
 * `.Content`; wrap a list in `Swipeable.Group` to close siblings on open.
 *
 * **Layering** — the root is the only clipping/rounding surface: pass any
 * `rounded-*` on the root (Tier 2 wrapper) and the action panels sit flush
 * behind the content, their outer corners rounded by the root clip. The action
 * panels and the rubber-band fill park off-screen when the row is closed and
 * only ride into the revealed gap, so `Swipeable.Content` may be transparent —
 * whatever sits behind the root (its own `bg-*`, or the page) shows through.
 * Action backgrounds are read once to colour the overshoot fill.
 *
 * **Imperative handle** (`ref`) — `ref.current.open` (live side, readonly) and
 * `ref.current.close()`.
 */
const SwipeableRoot = forwardRef<SwipeableHandle, SwipeableRootProps>(
  function SwipeableRoot(
    {
      children,
      onOpen,
      onClose,
      open: controlledOpen,
      enabled = true,
      className,
      style,
      ...configOverrides
    },
    ref,
  ) {
    const reducedMotion = useReducedMotion()
    const reducedMotionRef = useRef(reducedMotion)
    reducedMotionRef.current = reducedMotion

    const cfgRef = useRef<SwipeableConfig>(SWIPEABLE_DEFAULTS)
    cfgRef.current = { ...SWIPEABLE_DEFAULTS, ...configOverrides }

    //---- slot extraction ----------------------------------------------------
    let leftActions: ReactNode = null
    let rightActions: ReactNode = null
    let content: ReactNode = null

    Children.forEach(children, (child) => {
      if (!isValidElement(child)) return
      const props = child.props as SwipeableSlotProps
      if (
        isSlot(
          child,
          SWIPEABLE_LEFT_ACTIONS_SLOT,
          SwipeableLeftActions,
          "Swipeable.LeftActions",
        )
      ) {
        leftActions = props.children
      } else if (
        isSlot(
          child,
          SWIPEABLE_RIGHT_ACTIONS_SLOT,
          SwipeableRightActions,
          "Swipeable.RightActions",
        )
      ) {
        rightActions = props.children
      } else if (
        isSlot(
          child,
          SWIPEABLE_CONTENT_SLOT,
          SwipeableContent,
          "Swipeable.Content",
        )
      ) {
        content = props.children
      }
    })

    const hasLeft = leftActions != null
    const hasRight = rightActions != null

    //---- nodes --------------------------------------------------------------
    const rootRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const leftRef = useRef<HTMLDivElement>(null)
    const rightRef = useRef<HTMLDivElement>(null)
    const leftFillRef = useRef<HTMLDivElement>(null)
    const rightFillRef = useRef<HTMLDivElement>(null)

    //---- engine state (refs — never re-renders during a gesture) ------------
    const offsetRef = useRef(0)
    const velRef = useRef(0)
    const rafRef = useRef<number | null>(null)
    const openRef = useRef<OpenSide>(false)
    /** The side `onOpen` last reported, until `onClose` reports it shut. The
     *  callbacks answer to this, not to `openRef`: that flips when a close
     *  starts and again when a grab throws the row back open, and a release
     *  that springs the row to where it already was has changed nothing. */
    const reportedRef = useRef<OpenSide>(false)
    const closingRef = useRef(false)
    /** Natural action widths, measured from layout. */
    const lwRef = useRef(0)
    const rwRef = useRef(0)
    const pendingOpenRef = useRef<OpenSide>(false)
    const hasControlledRef = useRef(false)
    /** The last `open` prop, for a controlled row's `onOpen` gate. */
    const controlledRef = useRef<OpenSide>(false)

    //---- gesture tracking ---------------------------------------------------
    const downRef = useRef<{ x: number; y: number; start: number } | null>(
      null,
    )
    const samplesRef = useRef<{ x: number; t: number }[]>([])
    const lockRef = useRef<null | "h" | "v">(null)
    const pointerIdRef = useRef<number | null>(null)

    //Shared gesture arbitration: a row swipe competes with edge-swipe-back, a
    //drawer drag and the scroller for the same pointer. `blocksScroll` because
    //`touch-action` cannot be changed mid-touch on iOS, so holding the scroller
    //still is the only reliable way to stop a scroll the swipe took over from.
    const capture = useGestureCapture({
      priority: GesturePriority.SwipeableRow,
      blocksScroll: true,
      enabled,
      //pre-empted by a higher-priority gesture, or turned off under the
      //finger — cancel the drag so the row springs back instead of being left
      //mid-translate with no pointer to finish it. Cancel, not end: a finger
      //that lost the row did not release it, so there is no verdict to take
      onLost: () => {
        capturedRef.current = false
        handlersRef.current.cancelDrag()
      },
    })
    const captureRef = useRef(capture)
    captureRef.current = capture
    const capturedRef = useRef(false)

    const [openSide, setOpenSide] = useState<OpenSide>(false)

    const onOpenRef = useRef(onOpen)
    onOpenRef.current = onOpen
    const onCloseRef = useRef(onClose)
    onCloseRef.current = onClose
    const enabledRef = useRef(enabled)
    enabledRef.current = enabled

    const group = useContext(SwipeableGroupContext)
    const groupRef = useRef(group)
    groupRef.current = group

    /* ---- painting -------------------------------------------------------- */

    //A tray is reachable while the row is open to its side, or while a locked
    //drag is revealing it: "opening" counts, so what the finger uncovers can be
    //read before it lifts. It goes inert the moment a close STARTS, not when the
    //spring lands: `openRef` and `useSwipeable().isOpen` both flip there, and a
    //Tab during the slide-out should not land on a button that is leaving.
    const syncTrays = useCallback(() => {
      const x = offsetRef.current
      const open = openRef.current
      const dragging = downRef.current !== null && lockRef.current === "h"
      const content = contentRef.current
      parkTray(
        leftRef.current,
        !(x > 0.5 && (dragging || open === "left")),
        content,
      )
      parkTray(
        rightRef.current,
        !(x < -0.5 && (dragging || open === "right")),
        content,
      )
    }, [])

    const applyOffset = useCallback(
      (x: number) => {
        offsetRef.current = x
        const settled = Math.abs(x) < SETTLE_EPSILON_PX
        const content = contentRef.current
        if (content) {
          content.style.transform = settled ? "" : `translateX(${x}px)`
        }

        //panels slide in until their natural width, then park (the action button
        //stays pinned to the edge). a panel-width fill covers any rubber-band
        //overshoot gap. the fill is a panel child parked just past the panel's
        //OUTER edge, so its own transform cancels the panel's slide and adds the
        //raw offset instead: net, the fill tracks the content's trailing edge and
        //rides in the gap between content and parked panel, sitting off-screen when
        //closed. nothing is ever parked *behind* the content, so caller content may
        //be transparent. translating a solid block (not scaling) keeps it flicker-free.
        const lw = lwRef.current
        const leftPanelX = Math.min(0, x - lw)
        if (leftRef.current) {
          leftRef.current.style.transform = `translateX(${leftPanelX}px)`
        }
        if (leftFillRef.current) {
          leftFillRef.current.style.transform = `translateX(${x - leftPanelX}px)`
        }

        const rw = rwRef.current
        const rightPanelX = Math.max(0, x + rw)
        if (rightRef.current) {
          rightRef.current.style.transform = `translateX(${rightPanelX}px)`
        }
        if (rightFillRef.current) {
          rightFillRef.current.style.transform = `translateX(${x - rightPanelX}px)`
        }
        syncTrays()
      },
      [syncTrays],
    )

    //cleared on every spring's landing, just before onSettled runs:
    //playground/e2e/swipeable.spec.ts reads the cleared will-change as "the
    //spring landed", because the transform clears half a pixel before rest
    const setWillChange = useCallback((on: boolean) => {
      const value = on ? "transform" : ""
      for (const el of [
        contentRef.current,
        leftRef.current,
        rightRef.current,
      ]) {
        if (el) el.style.willChange = value
      }
    }, [])

    const stopSpring = useCallback(() => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }, [])

    const springTo = useCallback(
      (target: number, onSettled?: () => void) => {
        stopSpring()

        const atRest =
          Math.abs(offsetRef.current - target) < SETTLE_EPSILON_PX &&
          Math.abs(velRef.current) < 1
        if (atRest || reducedMotionRef.current) {
          applyOffset(target)
          velRef.current = 0
          setWillChange(false)
          onSettled?.()
          return
        }

        const c = cfgRef.current
        const damping =
          target === 0 ? c.springDampingClose : c.springDamping
        //closing is a hard stop at the closed point — flick momentum must not
        //carry the row past it into the opposite side (drawer hitting its frame)
        const closing = target === 0
        //side we're closing from. when the row is already resting at 0 (e.g. a
        //right-flick walled against the closed edge with no actions that side),
        //fall back to the velocity direction so the stop guard below still fires
        //— otherwise the flick overshoots past 0, flashes the background, and
        //bounces back, fighting the finger
        const fromSign =
          Math.sign(offsetRef.current) || -Math.sign(velRef.current)
        setWillChange(true)
        let last = performance.now()

        const settle = () => {
          applyOffset(target)
          velRef.current = 0
          rafRef.current = null
          setWillChange(false)
          onSettled?.()
        }

        const tick = (now: number) => {
          //fixed sub-steps so the explicit integrator stays stable on slow
          //frames — a large dt makes the damping term overshoot and ring
          let remaining = Math.min((now - last) / 1000, 0.064)
          last = now
          let pos = offsetRef.current
          let vel = velRef.current
          while (remaining > 0) {
            const dt = Math.min(remaining, SPRING_SUBSTEP)
            remaining -= dt
            const r = springStep(
              pos,
              vel,
              target,
              c.springStiffness,
              damping,
              c.springMass,
              dt,
            )
            pos = r.pos
            vel = r.vel
            if (closing && fromSign !== 0 && pos * fromSign <= 0) break
          }
          velRef.current = vel

          //reached the closed point — stop dead, absorb any leftover momentum
          if (closing && fromSign !== 0 && pos * fromSign <= 0) {
            settle()
            return
          }

          applyOffset(pos)

          if (Math.abs(pos - target) < 0.5 && Math.abs(vel) < 1) {
            settle()
            return
          }
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      },
      [applyOffset, setWillChange, stopSpring],
    )

    /* ---- open / close ---------------------------------------------------- */

    const close = useCallback(
      (releaseVelocity?: number) => {
        const shifted =
          openRef.current !== false || Math.abs(offsetRef.current) > 0.5
        if (!shifted || closingRef.current) return

        if (releaseVelocity !== undefined) velRef.current = releaseVelocity
        closingRef.current = true
        openRef.current = false
        syncTrays()
        setOpenSide(false)
        springTo(0, () => {
          closingRef.current = false
          //a row that was only dragged, never opened, springs back unreported
          if (reportedRef.current === false) return
          reportedRef.current = false
          onCloseRef.current?.()
        })
      },
      [springTo, syncTrays],
    )

    //stable identity shared by the group + dismiss registries
    const closeRef = useRef(close)
    closeRef.current = close
    const selfClose = useCallback(() => closeRef.current(), [])

    const openTo = useCallback(
      (side: Side) => {
        const width = side === "left" ? lwRef.current : rwRef.current
        if (width < 1) {
          //widths not measured yet — retry after layout settles
          pendingOpenRef.current = side
          return
        }
        pendingOpenRef.current = false
        closingRef.current = false
        openRef.current = side
        setOpenSide(side)
        springTo(side === "left" ? width : -width)
        //a nudge that settles back open, or a close grabbed and thrown back,
        //reopens the side already reported; a swap to the other side is news,
        //and so is an open a controlled row's parent does not know about — a
        //close it asked for that the finger threw back open. Unreported, the
        //parent keeps saying closed and its next `false` changes nothing
        if (
          reportedRef.current !== side ||
          (hasControlledRef.current && controlledRef.current !== side)
        ) {
          reportedRef.current = side
          onOpenRef.current?.(side)
        }
        //every open, reported or not: a row the Group closed, grabbed mid-close
        //and thrown back open, must close the sibling that closed it
        groupRef.current?.notifyOpen(selfClose)
      },
      [selfClose, springTo],
    )

    const openToRef = useRef(openTo)
    openToRef.current = openTo

    useImperativeHandle(
      ref,
      () => ({
        get open() {
          return openRef.current
        },
        close: () => closeRef.current(),
      }),
      [],
    )

    /* ---- measurement ----------------------------------------------------- */

    const measure = useCallback(() => {
      lwRef.current = leftRef.current?.offsetWidth ?? 0
      rwRef.current = rightRef.current?.offsetWidth ?? 0

      if (leftFillRef.current && leftRef.current) {
        const bg = readAdjacentActionBackground(leftRef.current, "left")
        if (bg) leftFillRef.current.style.backgroundColor = bg
      }
      if (rightFillRef.current && rightRef.current) {
        const bg = readAdjacentActionBackground(rightRef.current, "right")
        if (bg) rightFillRef.current.style.backgroundColor = bg
      }

      if (pendingOpenRef.current) {
        openToRef.current(pendingOpenRef.current)
      } else {
        applyOffset(offsetRef.current)
      }
    }, [applyOffset])

    useLayoutEffect(() => {
      measure()
      const targets = [leftRef.current, rightRef.current].filter(
        (n): n is HTMLDivElement => n !== null,
      )
      if (targets.length === 0) return
      const observer = new ResizeObserver(measure)
      for (const node of targets) observer.observe(node)
      return () => observer.disconnect()
    }, [measure])

    //mirror border-radius → clip-path (iOS rounded-corner clip for the transform)
    useLayoutEffect(() => {
      const root = rootRef.current
      if (!root) return
      const sync = () => syncRootClip(root)
      sync()
      const observer = new ResizeObserver(sync)
      observer.observe(root)
      return () => observer.disconnect()
    }, [])

    /* ---- controlled open ------------------------------------------------- */

    useLayoutEffect(() => {
      if (controlledOpen !== undefined) hasControlledRef.current = true
      controlledRef.current = controlledOpen ?? false
      const target =
        controlledOpen ?? (hasControlledRef.current ? false : undefined)
      if (target === undefined) return
      if (target) openToRef.current(target)
      else closeRef.current()
    }, [controlledOpen])

    /* ---- group membership + dismissers ----------------------------------- */

    useEffect(() => {
      return groupRef.current?.register(selfClose)
    }, [selfClose])

    useEffect(() => {
      return registerDismiss({
        isOpen: () =>
          openRef.current !== false || Math.abs(offsetRef.current) > 0.5,
        close: () => closeRef.current(),
      })
    }, [])

    useEffect(() => stopSpring, [stopSpring])

    //close on ancestor scroll
    useLayoutEffect(() => {
      const root = rootRef.current
      if (!root) return
      const scroller = findScrollAncestor(root)
      if (!scroller) return
      const onScroll = () => closeRef.current()
      scroller.addEventListener("scroll", onScroll, {
        passive: true,
        capture: true,
      })
      return () =>
        scroller.removeEventListener("scroll", onScroll, { capture: true })
    }, [])

    //close on outside pointer release. A finger dragging THIS row is never
    //the outside pointer, however many other fingers are down: a second
    //finger lifting beside the list, on a window listener that never sees
    //which row it landed on, must not reach into a swipe the first finger
    //is still running. A row being dragged is dismissed by its own
    //release (endDrag/cancelDrag), never by someone else's
    useEffect(() => {
      const onPointerUp = (e: PointerEvent) => {
        if (downRef.current) return
        const root = rootRef.current
        if (!root || root.contains(e.target as Node)) return
        closeRef.current()
      }
      window.addEventListener("pointerup", onPointerUp, { capture: true })
      return () =>
        window.removeEventListener("pointerup", onPointerUp, {
          capture: true,
        })
    }, [])

    //close after a tray action is activated (iOS Mail). A bubbled native click, so
    //the action's own handler has already run — this dismisses AFTER it, never
    //instead of it. Only a deliberate tap/keyboard activation clicks the tray; a
    //swipe never does. In the app an action usually unmounts the row, making this a
    //harmless no-op there, while a stay-mounted tray (a toggle, a non-destructive
    //pick) now dismisses instead of stranding an open row.
    useEffect(() => {
      const root = rootRef.current
      if (!root) return
      const onClick = (e: MouseEvent) => {
        if (
          e.target instanceof Element &&
          e.target.closest("[data-swipeable-actions]")
        ) {
          closeRef.current()
        }
      }
      root.addEventListener("click", onClick)
      return () => root.removeEventListener("click", onClick)
    }, [])

    /* ---- gesture core ---------------------------------------------------- */

    const beginDrag = useCallback((clientX: number, clientY: number) => {
      velRef.current = 0
      lockRef.current = null
      samplesRef.current = [{ x: clientX, t: performance.now() }]
      downRef.current = {
        x: clientX,
        y: clientY,
        start: offsetRef.current,
      }
    }, [])

    /** @returns true once locked horizontal (callers must preventDefault). */
    const dragMove = useCallback(
      (clientX: number, clientY: number) => {
        const down = downRef.current
        if (!down) return false

        const dx = clientX - down.x
        const dy = clientY - down.y

        if (!lockRef.current) {
          if (Math.hypot(dx, dy) < 8) return false
          const angle =
            Math.atan2(Math.abs(dy), Math.abs(dx)) * (180 / Math.PI)
          lockRef.current =
            angle < cfgRef.current.directionLockAngle ? "h" : "v"
          if (lockRef.current === "h") {
            //Claim the SHARED arbiter here, at the lock and before the row
            //moves — for the mouse and the touch path alike. Not at pointerdown:
            //that is also how a tap starts, and claiming there would starve
            //every other gesture on the screen for the duration of every touch.
            //Refused means a gesture that outranks the row already owns this
            //finger (an edge swipe claims at touchstart for exactly this), so
            //the row gives the whole touch up, as a scroll would: it neither
            //tracks the finger nor blocks the scroll it does not own.
            if (!captureRef.current.request()) {
              lockRef.current = "v"
              return false
            }
            stopSpring()
            //a row caught in flight: the spring carried it on between the
            //touch and this lock, so the offset recorded at the touch is
            //stale by that travel, and tracking from it would throw the row
            //back by that much in one frame. Track from where the row IS.
            //
            //Only a carry the engine itself counts as movement re-anchors the
            //drag. A closing spring parks the transform at `""` a fraction of
            //a pixel from home (`applyOffset`) and zeroes the ref a frame
            //later, so a finger landing in that window records a `start` that
            //disagrees with the settled offset by less than a pixel on a row
            //nobody saw move. Re-anchoring on that fiction is not free: it
            //pins the row where it stands at the lock and so swallows the
            //whole direction-lock dead zone, leaving every later position
            //short of the finger by the slop for the rest of the drag.
            //Above the threshold the row really was in flight and the dead
            //zone is the right price for not throwing it backwards; below it,
            //the dead zone stays as pinned, exactly as from rest.
            //The spring's last velocity dies with it either way: the finger
            //owns the row now, and the release spring starts from the finger's
            //own velocity, not the one the interrupted spring left behind
            if (
              Math.abs(offsetRef.current - down.start) >= SETTLE_EPSILON_PX
            ) {
              down.start = offsetRef.current - dx
            }
            velRef.current = 0
            //a close this grab interrupted is over: its spring and onSettled
            //are gone, so the release decides afresh. Left latched, that
            //release's close() was a no-op and the row stuck in view
            closingRef.current = false
            setWillChange(true)
          }
        }
        if (lockRef.current !== "h") return false

        samplesRef.current.push({ x: clientX, t: performance.now() })
        if (samplesRef.current.length > 6) samplesRef.current.shift()

        const lw = hasLeft ? lwRef.current : 0
        const rw = hasRight ? rwRef.current : 0
        const friction = cfgRef.current.overshootFriction
        let offset = down.start + dx

        //clamp to a rubber-banded range of [-rw, lw] with resistant overshoot
        if (offset > lw) {
          offset = lw + Math.min((offset - lw) * friction, lw * 0.5 || 24)
        } else if (offset < -rw) {
          offset =
            -rw - Math.min((-offset - rw) * friction, rw * 0.5 || 24)
        }
        if (lw === 0 && offset > 0) offset = 0
        if (rw === 0 && offset < 0) offset = 0

        applyOffset(offset)
        return true
      },
      [applyOffset, hasLeft, hasRight, setWillChange, stopSpring],
    )

    const velocity = useCallback(() => {
      const s = samplesRef.current
      if (s.length < 2) return 0
      const last = s[s.length - 1]

      //a finger that stops before it lifts sends no more moves, so the samples
      //still end on the flick. Measured against the release itself, a pause
      //longer than the window is the stillness it is, and position decides
      if (performance.now() - last.t > VELOCITY_WINDOW_MS) return 0

      //release velocity over a short trailing window — averaging the whole
      //buffer reports a stale flick after deceleration and swallows a late one
      let first = s[s.length - 2]
      for (let i = s.length - 2; i >= 0; i--) {
        if (last.t - s[i].t > VELOCITY_WINDOW_MS) break
        first = s[i]
      }

      const dt = (last.t - first.t) / 1000
      return dt > 0 ? (last.x - first.x) / dt : 0
    }, [])

    const endDrag = useCallback(() => {
      const down = downRef.current
      if (!down) return
      downRef.current = null

      if (lockRef.current !== "h") {
        if (Math.abs(offsetRef.current) > 0.5) close()
        else setWillChange(false)
        return
      }

      const decision = resolveSwipeRelease({
        x: offsetRef.current,
        vel: velocity(),
        lw: hasLeft ? lwRef.current : 0,
        rw: hasRight ? rwRef.current : 0,
        wasOpen: openRef.current,
        cfg: cfgRef.current,
      })
      if (decision.action === "open") openToRef.current(decision.side)
      else close(decision.velocity)
      //the finger no longer holds a tray open by itself; the side the release
      //committed to does (a close already synced, unless it was a no-op)
      syncTrays()
    }, [close, hasLeft, hasRight, setWillChange, syncTrays, velocity])

    //the drag taken away: the row goes back to where the finger found it,
    //open or closed, and reports nothing new (an open that settles back open
    //is unreported by openTo; a row only dragged springs back unreported)
    const cancelDrag = useCallback(() => {
      if (!downRef.current) return
      downRef.current = null
      const side = openRef.current
      if (side) openToRef.current(side)
      else close()
      syncTrays()
    }, [close, syncTrays])

    //stable handler refs for the imperative touch listeners
    const handlersRef = useRef({
      beginDrag,
      dragMove,
      endDrag,
      cancelDrag,
    })
    handlersRef.current = { beginDrag, dragMove, endDrag, cancelDrag }

    /* ---- touch (passive:false on move so we can block vertical scroll) --- */

    useEffect(() => {
      const node = contentRef.current
      if (!node) return

      //the finger that started the drag. A phone is held in a hand: a thumb
      //steadying it, a knuckle, a second finger resting on the glass each
      //start a touch of their own mid-swipe, on this same event stream. The
      //row belongs to the first finger until IT lifts — the others neither
      //restart the gesture from their own position nor release it
      let fingerId: number | null = null
      const tracked = (list: TouchList) => {
        for (let i = 0; i < list.length; i++) {
          const t = list[i]
          if (t && t.identifier === fingerId) return t
        }
        return null
      }

      const onStart = (e: TouchEvent) => {
        if (!enabledRef.current) return
        if (fingerId !== null && downRef.current) return
        const t = e.changedTouches[0]
        if (!t) return
        fingerId = t.identifier
        handlersRef.current.beginDrag(t.clientX, t.clientY)
      }
      const onMove = (e: TouchEvent) => {
        const t = tracked(e.touches)
        if (!t) return
        if (handlersRef.current.dragMove(t.clientX, t.clientY)) {
          e.preventDefault()
          //the swipe is now horizontal-locked, so this row owns the gesture.
          //claim the pointer to fire lostpointercapture on any descendant tap
          //recognizer (useGestureEngine) — its documented veto path. doing it
          //here, rather than leaning on a synthetic pointercancel from the
          //preventDefault above, is what makes swipe-vs-tap reliable on touch.
          const id = pointerIdRef.current
          if (id !== null && !capturedRef.current) {
            node.setPointerCapture?.(id)
            capturedRef.current = true
          }
        }
      }
      const onEnd = (e: TouchEvent) => {
        //a lift or a cancel that names another finger changes nothing: the
        //browser cancels the points it names in changedTouches (a palm, a
        //finger dragged onto the chrome), and when it takes the whole touch
        //away the tracked finger is among them. A cancel naming no point at
        //all (a driver's bare cancel) ends the touch
        if (
          fingerId !== null &&
          e.changedTouches.length > 0 &&
          !tracked(e.changedTouches)
        )
          return
        fingerId = null
        captureRef.current.release()
        handlersRef.current.endDrag()
      }

      node.addEventListener("touchstart", onStart, { passive: true })
      node.addEventListener("touchmove", onMove, { passive: false })
      node.addEventListener("touchend", onEnd, { passive: true })
      node.addEventListener("touchcancel", onEnd, { passive: true })
      return () => {
        node.removeEventListener("touchstart", onStart)
        node.removeEventListener("touchmove", onMove)
        node.removeEventListener("touchend", onEnd)
        node.removeEventListener("touchcancel", onEnd)
      }
    }, [])

    useEffect(() => {
      const onBlur = () => downRef.current && handlersRef.current.endDrag()
      window.addEventListener("blur", onBlur)
      return () => window.removeEventListener("blur", onBlur)
    }, [])

    /* ---- pointer (mouse / pen) — defer capture so taps reach buttons ----- */

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || !enabled) return
      //record the pointer id for both input types: mouse drives the drag from
      //here, while touch (driven by the imperative touch listeners) needs the id
      //so a locked swipe can claim the pointer and veto a descendant tap
      pointerIdRef.current = e.pointerId
      capturedRef.current = false
      if (e.pointerType === "touch") return
      beginDrag(e.clientX, e.clientY)
    }

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "touch") return
      const locked = dragMove(e.clientX, e.clientY)
      if (
        !locked ||
        capturedRef.current ||
        pointerIdRef.current !== e.pointerId
      )
        return
      e.currentTarget.setPointerCapture?.(e.pointerId)
      capturedRef.current = true
    }

    const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
      //clear capture bookkeeping for every pointer type — touch may have claimed
      //the pointer mid-swipe (see the touch move listener) to veto a descendant tap
      if (pointerIdRef.current === e.pointerId) {
        pointerIdRef.current = null
        capturedRef.current = false
        captureRef.current.release()
      }
      //touch ends through the imperative touchend/touchcancel listeners
      if (e.pointerType === "touch") return
      endDrag()
    }

    /* ---- render ---------------------------------------------------------- */

    const contextValue = useMemo<SwipeableContextValue>(
      () => ({
        isOpen: openSide !== false,
        openSide,
        isEnabled: enabled,
      }),
      [openSide, enabled],
    )

    return (
      <SwipeableContext.Provider value={contextValue}>
        <div
          data-adaptv="swipeable"
          data-part="root"
          ref={rootRef}
          data-swipeable-root
          //No class and no lock, by decision (§2). Swipeable is the component that
          //already follows the escape-hatch rule end to end: every structural
          //declaration — the clip, the isolation, the panel pinning, the fill
          //parking — is keyed on `data-swipeable-*` in styles/swipeable.css, so
          //there is no class for a consumer to fight and nothing to lock. The
          //engine writes its transforms to the CONTENT node, not this one, so the
          //consumer's inline `style` here has no per-frame writer to race either.
          {...composeStyles({
            className,
            style,
            lockedStyle: undefined,
          })}
        >
          {/* `inert` here is the server's HTML and the mount: a row renders
              closed. The prop never changes, so React never writes it again,
              and from the first layout on parkTray owns it (see there). */}
          {hasLeft && (
            <div ref={leftRef} data-swipeable-actions="left" inert>
              <div
                ref={leftFillRef}
                aria-hidden
                data-swipeable-fill="left"
              />
              {leftActions}
            </div>
          )}
          {hasRight && (
            <div ref={rightRef} data-swipeable-actions="right" inert>
              <div
                ref={rightFillRef}
                aria-hidden
                data-swipeable-fill="right"
              />
              {rightActions}
            </div>
          )}
          <div
            ref={contentRef}
            data-swipeable-content
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onLostPointerCapture={onPointerEnd}
          >
            {content}
          </div>
        </div>
      </SwipeableContext.Provider>
    )
  },
)
SwipeableRoot.displayName = "Swipeable"

const SwipeableCompound = Object.assign(SwipeableRoot, {
  Group: SwipeableGroup,
  LeftActions: SwipeableLeftActions,
  RightActions: SwipeableRightActions,
  Content: SwipeableContent,
})

export { SwipeableCompound as Swipeable }

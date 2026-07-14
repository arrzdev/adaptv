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
import { willOpenVirtualKeyboard } from "#nativ/hooks/use-keyboard"
import { useReducedMotion } from "#nativ/hooks/use-reduced-motion"
import { cn } from "#nativ/utils/cn"

/**
 * True when `target` sits inside a swipeable row root (`[data-swipeable-root]`).
 * Used by `PullToRefresh` to yield the vertical gesture to an active row swipe.
 */
export function isSwipeableGestureTarget(
  target: EventTarget | null,
): boolean {
  if (!(target instanceof Element)) return false
  return target.closest("[data-swipeable-root]") !== null
}

/* =============================================================================
 * TYPES
 * ============================================================================= */

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
 * PHYSICS
 * ============================================================================= */

/** Fixed integration step (s). Small enough that `damping·dt/mass` stays well
 *  under the explicit-Euler stability limit of 2 at any real-world damping. */
const SPRING_SUBSTEP = 1 / 240

/** Trailing sample window (ms) used to compute release velocity on flick. */
const VELOCITY_WINDOW_MS = 60

function springStep(
  pos: number,
  vel: number,
  target: number,
  stiffness: number,
  damping: number,
  mass: number,
  dt: number,
) {
  const force = -stiffness * (pos - target) - damping * vel
  const nv = vel + (force / mass) * dt
  return { pos: pos + nv * dt, vel: nv }
}

/* =============================================================================
 * GEOMETRY HELPERS
 * ============================================================================= */

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

/* =============================================================================
 * DISMISS REGISTRY — close open rows on scroll / outside tap / keyboard open
 * ============================================================================= */

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
    if (
      node.classList.contains("scrollable-y") ||
      node.classList.contains("scrollable-x") ||
      node.classList.contains("scrollable")
    ) {
      return node
    }
    const style = getComputedStyle(node)
    const flow = `${style.overflow}${style.overflowY}${style.overflowX}`
    if (/(auto|scroll|overlay)/.test(flow)) return node
    node = node.parentElement
  }
  return null
}

/* =============================================================================
 * COMPOUND SLOTS — Tier 2 wrappers copy these markers onto their function type
 * ============================================================================= */

export const SWIPEABLE_LEFT_ACTIONS_SLOT = Symbol.for(
  "@repo/nativ:swipeable.left-actions",
)
export const SWIPEABLE_RIGHT_ACTIONS_SLOT = Symbol.for(
  "@repo/nativ:swipeable.right-actions",
)
export const SWIPEABLE_CONTENT_SLOT = Symbol.for(
  "@repo/nativ:swipeable.content",
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

/* =============================================================================
 * CONTEXT
 * ============================================================================= */

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

/* =============================================================================
 * GROUP — close siblings when one opens
 * ============================================================================= */

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

/* =============================================================================
 * ROOT
 * ============================================================================= */

export type SwipeableHandle = {
  /** Live open side (`false` when closed). */
  readonly open: OpenSide
  /** Animate closed (no-op when already closed). */
  close: () => void
}

type SwipeableRootProps = Partial<SwipeableConfig> & {
  children: ReactNode
  onOpen?: (side: Side) => void
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
    const closingRef = useRef(false)
    /** Natural action widths, measured from layout. */
    const lwRef = useRef(0)
    const rwRef = useRef(0)
    const pendingOpenRef = useRef<OpenSide>(false)
    const hasControlledRef = useRef(false)

    //---- gesture tracking ---------------------------------------------------
    const downRef = useRef<{ x: number; y: number; start: number } | null>(
      null,
    )
    const samplesRef = useRef<{ x: number; t: number }[]>([])
    const lockRef = useRef<null | "h" | "v">(null)
    const pointerIdRef = useRef<number | null>(null)
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

    const applyOffset = useCallback((x: number) => {
      offsetRef.current = x
      const settled = Math.abs(x) < 0.5
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
    }, [])

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
          Math.abs(offsetRef.current - target) < 0.5 &&
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
        setOpenSide(false)
        springTo(0, () => {
          closingRef.current = false
          onCloseRef.current?.()
        })
      },
      [springTo],
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
        onOpenRef.current?.(side)
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

    //close on outside pointer release
    useEffect(() => {
      const onPointerUp = (e: PointerEvent) => {
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
            stopSpring()
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

      const c = cfgRef.current
      const x = offsetRef.current
      const vel = velocity()
      const lw = hasLeft ? lwRef.current : 0
      const rw = hasRight ? rwRef.current : 0
      const wasOpen = openRef.current

      if (wasOpen === "left") {
        //flick back closes; flick through into right territory swaps sides
        if (vel < -c.velocityThreshold) {
          if (x < 0 && rw > 0) return openToRef.current("right")
          return close(vel)
        }
        if (x < lw * (1 - c.closeThreshold)) return close()
        return openToRef.current("left")
      }
      if (wasOpen === "right") {
        if (vel > c.velocityThreshold) {
          if (x > 0 && lw > 0) return openToRef.current("left")
          return close(vel)
        }
        if (x > -rw * (1 - c.closeThreshold)) return close()
        return openToRef.current("right")
      }

      //from closed — flick wins, else position threshold
      if (vel > c.velocityThreshold && lw > 0)
        return openToRef.current("left")
      if (vel < -c.velocityThreshold && rw > 0) {
        return openToRef.current("right")
      }
      if (lw > 0 && x > lw * c.openThreshold)
        return openToRef.current("left")
      if (rw > 0 && x < -rw * c.openThreshold) {
        return openToRef.current("right")
      }
      close()
    }, [close, hasLeft, hasRight, setWillChange, velocity])

    //stable handler refs for the imperative touch listeners
    const handlersRef = useRef({ beginDrag, dragMove, endDrag })
    handlersRef.current = { beginDrag, dragMove, endDrag }

    /* ---- touch (passive:false on move so we can block vertical scroll) --- */

    useEffect(() => {
      const node = contentRef.current
      if (!node) return

      const onStart = (e: TouchEvent) => {
        if (!enabledRef.current) return
        const t = e.touches[0]
        if (t) handlersRef.current.beginDrag(t.clientX, t.clientY)
      }
      const onMove = (e: TouchEvent) => {
        const t = e.touches[0]
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
      const onEnd = () => handlersRef.current.endDrag()

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
          ref={rootRef}
          data-swipeable-root
          className={cn(className)}
          style={style}
        >
          {hasLeft && (
            <div ref={leftRef} data-swipeable-actions="left">
              <div
                ref={leftFillRef}
                aria-hidden
                data-swipeable-fill="left"
              />
              {leftActions}
            </div>
          )}
          {hasRight && (
            <div ref={rightRef} data-swipeable-actions="right">
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

/* =============================================================================
 * COMPOUND EXPORT
 * ============================================================================= */

const SwipeableCompound = Object.assign(SwipeableRoot, {
  Group: SwipeableGroup,
  LeftActions: SwipeableLeftActions,
  RightActions: SwipeableRightActions,
  Content: SwipeableContent,
})

export { SwipeableCompound as Swipeable }

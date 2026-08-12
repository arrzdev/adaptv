import type {
  ComponentPropsWithoutRef,
  CSSProperties,
  HTMLAttributes,
  ReactNode,
  Ref,
  RefObject,
} from "react"
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
  DRAWER_CONTENT_MAX_HEIGHT_VAR,
  DrawerEngine,
  useDrawerEngineContext,
} from "#adaptv/components/drawer/drawer-engine"
import { cn } from "#adaptv/utils/cn"
import { mergeStyles } from "#adaptv/utils/styles"

/* =============================================================================
 * TYPES
 * ============================================================================= */

export type DrawerRootHandle = {
  readonly open: boolean
  show: () => void
  hide: () => void
  focus: () => void
}

/** Spec alias — same handle as {@link DrawerRootHandle}. */
export type DrawerHandle = DrawerRootHandle

export type DrawerContextValue = {
  isOpen: boolean
  avoidKeyboard: boolean
  /** `true` while the on-screen keyboard is up for a field inside the drawer. */
  isKeyboardOpen: boolean
}

type DrawerActionsContextValue = {
  show: () => void
  hide: () => void
}

export interface DrawerOverlayProps
  extends HTMLAttributes<HTMLButtonElement> {
  /** Run before the drawer closes on backdrop press. */
  onTap?: () => void
}
export type DrawerPortalProps = {
  children: ReactNode
}
export type DrawerTriggerProps = ComponentPropsWithoutRef<"button">
export interface DrawerShellProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
}
export type DrawerHandleProps = HTMLAttributes<HTMLSpanElement>
export type DrawerFooterProps = HTMLAttributes<HTMLDivElement>
export type DrawerCloseProps = ComponentPropsWithoutRef<"button">
export type DrawerTitleProps = HTMLAttributes<HTMLHeadingElement>
export type DrawerDescriptionProps = HTMLAttributes<HTMLParagraphElement>

export interface DrawerContentProps
  extends HTMLAttributes<HTMLDivElement> {
  /** Wrap the body in a {@link DrawerShell} flex column (default `true`). */
  shell?: boolean
  /** Extra classes for the inner scroll container. */
  scrollClassName?: string
  /**
   * The tallest the sheet may grow, measured as VISIBLE height — a CSS length (`"60dvh"`,
   * `"32rem"`) or a number of px. Content past it scrolls inside the sheet.
   *
   * This is the knob, rather than a `max-h-*` class on this part: `className` here paints the
   * panel, and the panel is the sheet plus a hidden tail below the fold, so a height set there
   * is spent on the tail before the sheet (measured: `max-h-[85dvh]` → 269px of sheet at a
   * 900px viewport). Those utilities are locked out for that reason.
   *
   * Only ever lowers the ceiling. adaptv's own cap — the viewport minus the top safe area
   * installed, 97dvh in a tab — still applies, so a sheet cannot be asked to reach the screen
   * edge. The keyboard picks this up on its own: room is held below the content and the box
   * grows into *this* cap rather than the platform one.
   */
  maxHeight?: string | number
}

export type DrawerRootProps = {
  children?: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Fired after the open (`true`) or close (`false`) animation settles. */
  onAnimationEnd?: (open: boolean) => void
  /**
   * Make room for the virtual keyboard (default `true`). The sheet grows into its max height and
   * holds the keyboard's height as empty room under its content, so the content clears the
   * keyboard and whatever no longer fits stays reachable by scrolling.
   */
  avoidKeyboard?: boolean
  /**
   * Blur focused elements outside the drawer on open to clear ghost focus (default `true`).
   * Panel-scoped — never blurs the drawer's own fields, so it coexists with autofocus.
   */
  blurInputs?: boolean
  /**
   * Suppress the user's drag-to-move/dismiss gesture — the drag handle and the whole-sheet
   * swipe — while `true` (default `false`). Programmatic open/close and keyboard avoidance (a
   * focused field still grows the sheet) are unaffected. Designed to be toggled live:
   * e.g. bind it to a destructive hold-to-confirm button inside the panel so a small finger drift
   * during the hold can't drag the sheet.
   */
  disableDrag?: boolean
}

export type DrawerNestedRootProps = DrawerRootProps

/* =============================================================================
 * TIER-1 NEUTRAL BASELINE
 *
 * Minimal gray baseline only — positioning, layout, and a visible neutral fill so
 * unstyled usage renders. Brand cosmetics (colors, radius, padding, shadow) arrive
 * through `className` from the app wrapper and win via twMerge.
 * ============================================================================= */

//LOCKED: a dim layer that does not span the viewport is not a dim layer.
const DRAWER_OVERLAY_LOCKED_CLASS = "inset-0"
//will-change keeps the full-screen dim promoted while mounted, so it doesn't demote and
//repaint at every fade end. This half landed first; the panel below carries the other half of
//the same demote-on-transition-end repaint, and the two used to stack.
const DRAWER_OVERLAY_BASE_CLASS = "bg-black/40 will-change-[opacity]"
//LOCKED: the sheet is translated along Y by the engine and spans the viewport
//width; `inset-x-0` is the geometry the drag maths and the max-height cap assume.
//`flex flex-col` is what makes the handle / scroller / footer stack a stack — the
//scroller's `min-h-0` only means anything inside a flex column.
//
//The three height utilities are locked to their initial values, which is not busywork: this
//element is NOT the sheet, it is the sheet PLUS the hidden tail below the fold (`bottom:
//-excessHeight` and a spacer of the same height, ~0.55 viewports). So a height set here is
//silently spent on the tail first — measured at a 900px viewport, `max-h-[85dvh]` left 269px
//of sheet on screen, ~30dvh, and pushed 605px of the scroller past the bottom edge. There is
//no value a consumer could pass that means what it reads as, so the property is not theirs to
//pass; `maxHeight` on Drawer.Content is, and it lands on the box that actually decides the
//visible height. → DRAWER_CONTENT_MAX_HEIGHT_VAR
//
//`max-h-[none]` and not `max-h-none`, which is the same CSS and does NOT hold: tailwind-merge
//3.4 does not list `none` among the `max-h` group's values, so `cn("max-h-[85dvh]",
//"max-h-none")` keeps BOTH and compiled source order picks the winner — the silent
//failure `cn.ts` documents at length. The arbitrary form goes through tailwind-merge's own
//arbitrary-value handling and resolves, with no registry to keep in step. (`h-auto` and
//`min-h-0` are in their groups already; only `max-h` has the gap.)
const DRAWER_PANEL_LOCKED_CLASS =
  "inset-x-0 flex flex-col h-auto min-h-0 max-h-[none]"
//will-change keeps the sheet on its own compositor layer for as long as it is mounted.
//Without it WebKit promotes the panel when the transition starts and DEMOTES it when the
//transition ends, re-rasterising the text at the exact moment the sheet arrives — the settle
//tremor, which does not show up in rAF deltas because no frame is late; the pixels just change.
//It buys no new containing block for fixed/absolute descendants: the engine writes
//`translate3d(...)` here from mount onwards and any non-`none` transform already makes this
//element one (css-transforms-2 §8), so the hint only declares what the panel is about to do.
//Static and component-scoped — the form PERFORMANCE-BOOST.md §5 permits, and the one
//`will-change` vaul's whole stylesheet carries.
const DRAWER_PANEL_BASE_CLASS =
  "rounded-t-xl bg-white shadow-lg outline-none will-change-transform"
const DRAWER_HANDLE_REGION_CLASS =
  "flex shrink-0 flex-col items-center pt-3 pb-2"
const DRAWER_GRABBER_BASE_CLASS =
  "mx-auto h-1 w-12 shrink-0 rounded-full bg-gray-600"
//LOCKED: `overflow-y-auto` + `min-h-0` ARE the drawer's scroll model — the panel is
//height-capped and this is the only element allowed to scroll inside it, which the
//drag engine relies on when it decides whether a downward gesture is a scroll or a
//dismiss. `overscroll-y-none` is what stops a fling at the end chaining to the page
//behind the sheet. `contain` scopes content invalidations to the scroller, keeping them
//off the panel's animated layer; the scroller already clips, so paint containment
//changes nothing visually.
//
//`overflow-x-hidden` is not belt-and-braces, it is the OTHER HALF of `overflow-y-auto`:
//CSS computes an unspecified `overflow-x` to `auto` the moment the other axis scrolls,
//so a single too-wide child (a chip row, a long unbroken string) silently turned the
//sheet into a two-axis pane the user could pan sideways — sliding the form out from
//under the fixed handle and footer. A drawer is a vertical surface; a child that needs
//to scroll sideways brings its own `ScrollView horizontal` (same pairing there).
const DRAWER_SCROLLER_LOCKED_CLASS =
  "min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-none"
const DRAWER_SCROLLER_BASE_CLASS =
  "flex flex-col contain-[layout_paint_style]"

//scroll-edge affordance: fade the scroller edge that hides more content. A CSS
//mask (not gradient overlays) so Tier-1 stays color-agnostic — the fade reveals
//whatever panel background the consumer painted.
const DRAWER_EDGE_FADE_PX = 24

function drawerEdgeFadeMask(
  top: boolean,
  bottom: boolean,
): string | undefined {
  if (!top && !bottom) return undefined
  const start = top ? "transparent" : "#000"
  const end = bottom ? "transparent" : "#000"
  return `linear-gradient(to bottom, ${start} 0, #000 ${DRAWER_EDGE_FADE_PX}px, #000 calc(100% - ${DRAWER_EDGE_FADE_PX}px), ${end} 100%)`
}
const DRAWER_SHELL_LAYOUT_CLASS = "flex flex-col"
const DRAWER_ROOT_LAYOUT_CLASS = "contents"

/* =============================================================================
 * HELPER FUNCTIONS
 * ============================================================================= */

function partitionDrawerChildren(children: ReactNode) {
  let handle: ReactNode = null
  let footer: ReactNode = null
  const rest: ReactNode[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) {
      if (child != null && child !== false) rest.push(child)
      return
    }
    const name = (child.type as { displayName?: string }).displayName
    if (name === "Drawer.Handle") {
      handle = child
    } else if (name === "Drawer.Footer") {
      footer = child
    } else {
      rest.push(child)
    }
  })
  return { handle, footer, rest }
}

function partitionDrawerRootChildren(children: ReactNode) {
  const portal: ReactNode[] = []
  const rest: ReactNode[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) {
      if (child != null && child !== false) rest.push(child)
      return
    }
    const name = (child.type as { displayName?: string }).displayName
    if (name === "Drawer.Portal") {
      Children.forEach(
        (child.props as DrawerPortalProps).children,
        (portalChild) => {
          if (portalChild == null || portalChild === false) return
          portal.push(portalChild)
        },
      )
      return
    }
    rest.push(child)
  })
  return { portal, rest }
}

function activeBlur() {
  const activeEl = document.activeElement as HTMLElement
  if (activeEl && typeof activeEl.blur === "function") {
    activeEl.blur()
  }
}

/* =============================================================================
 * CONTEXTS
 * ============================================================================= */

const DrawerScopeContext = createContext(0)
const DrawerContext = createContext<DrawerContextValue | null>(null)
const DrawerActionsContext =
  createContext<DrawerActionsContextValue | null>(null)

export function useDrawer() {
  const ctx = useContext(DrawerContext)
  if (!ctx) throw new Error("useDrawer must be used within <Drawer>.")
  return ctx
}

function useDrawerActions() {
  const ctx = useContext(DrawerActionsContext)
  if (!ctx)
    throw new Error("useDrawerActions must be used within <Drawer>.")
  return ctx
}

/* =============================================================================
 * COMPOUND PARTS
 *
 * Each part renders its own DOM node and pulls behavior/refs from the engine
 * context, applying `className` directly — so brand styling lives 100% at the
 * call site (no styles baked into Tier 1 beyond the neutral baseline).
 * ============================================================================= */

function DrawerOverlay({
  className,
  style,
  onTap,
  onClick,
  onPointerDown,
  ...props
}: DrawerOverlayProps) {
  const engine = useDrawerEngineContext()
  //A dismiss must come from a tap that STARTED on the backdrop. The tap that
  //OPENS the drawer fires its trailing (ghost) click after the backdrop has
  //already mounted under the pointer — with no pointerdown of its own on the
  //backdrop. Honouring that click dismissed the drawer the instant it opened
  //whenever the trigger sat under the backdrop (e.g. a top-of-screen button
  //while the sheet rises from the bottom) — the "button does nothing" bug.
  const pointerStartedOnBackdrop = useRef(false)

  //data-dragging (and data-state during a gesture close) is flipped imperatively by the
  //engine — no re-render mid-gesture; the render values cover mount and open-driven renders
  return (
    <button
      {...props}
      ref={engine.backdropRef}
      type="button"
      aria-label="Close drawer"
      aria-hidden={!engine.open}
      tabIndex={engine.open ? 0 : -1}
      data-pwa-drawer-overlay=""
      data-state={engine.backdropState}
      data-animate="false"
      data-dragging="false"
      //LOCKED (classes): the engine owns where the backdrop sits and what it sits
      //above. `fixed inset-0` is what makes it cover the app at all, and the
      //z-index is what puts it under the panel and over everything else — a
      //consumer's `z-0` would leave the dim layer behind the content it dims.
      //LOCKED (inline): the fade duration is read back off this element by the
      //engine's close timing, so the two must not disagree. Colour and the layer
      //hint are base — restyling the dim is the normal thing to want.
      //
      //The overlay only renders while the drawer is mounted (open, opening, or closing), so
      //it always intercepts taps — even while invisible mid-close. Keying pointer-events off
      //`open` let a tap during the close animation fall through to the trigger and reopen
      //(the open/close flash). A backdrop tap while closing is harmless: onBackdropClick ->
      //requestClose no-ops when already closing.
      {...mergeStyles({
        base: DRAWER_OVERLAY_BASE_CLASS,
        className,
        locked: [
          engine.backdropPosition,
          engine.backdropZ,
          DRAWER_OVERLAY_LOCKED_CLASS,
        ],
        style,
        lockedStyle: {
          ["--pwa-drawer-overlay-duration" as string]: `${engine.overlayDuration}s`,
          animationDuration: `${engine.overlayDuration}s`,
        },
      })}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        pointerStartedOnBackdrop.current = true
      }}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        //ignore the opening tap's ghost click (no pointerdown on the backdrop)
        if (!pointerStartedOnBackdrop.current) return
        pointerStartedOnBackdrop.current = false
        onTap?.()
        engine.onBackdropClick()
      }}
    />
  )
}
DrawerOverlay.displayName = "Drawer.Overlay"

function DrawerContent({
  children,
  className,
  style,
  shell = true,
  scrollClassName,
  maxHeight,
  ...props
}: DrawerContentProps) {
  const engine = useDrawerEngineContext()
  const { handle, footer, rest } = partitionDrawerChildren(children)
  const body = shell ? <DrawerShell>{rest}</DrawerShell> : rest

  //which scroller edges hide more content (drives the edge fade mask)
  const [edgeFade, setEdgeFade] = useState({ top: false, bottom: false })
  const { scrollerRef, isPanelAnimatingRef, subscribePanelSettle } = engine

  const syncEdgeFade = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    // Deferred while a panel animation is in flight: flipping the mask repaints the whole
    // scroller inside the GPU layer the compositor is animating. Overflow can't change during
    // a pure transform anyway; the settle subscription below flushes one sync afterwards.
    if (isPanelAnimatingRef.current) return
    const top = scroller.scrollTop > 1
    const bottom =
      scroller.scrollTop <
      scroller.scrollHeight - scroller.clientHeight - 1
    setEdgeFade((prev) =>
      prev.top === top && prev.bottom === bottom ? prev : { top, bottom },
    )
  }, [scrollerRef, isPanelAnimatingRef])

  //paint the initial mask into the panel's very first frame — computed post-paint (the old
  //ResizeObserver initial callback) it flipped on the scroller a few frames into the open,
  //repainting the layer mid-animation. Runs before the engine's open effect arms the gate.
  useLayoutEffect(() => {
    syncEdgeFade()
  }, [syncEdgeFade])

  // Overflow changes are answered IMMEDIATELY, not on settle. The deferral exists so a mask flip
  // does not repaint the scroller inside a layer the compositor is animating — but the engine now
  // lands its layout in one step and animates a transform (FLIP), so the repaint happens once, at
  // the moment the content actually becomes scrollable. Deferring it meant the fade appeared a
  // full animation-length after the content it describes, which reads as the gradient lagging.
  const syncEdgeFadeNow = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const top = scroller.scrollTop > 1
    const bottom =
      scroller.scrollTop <
      scroller.scrollHeight - scroller.clientHeight - 1
    setEdgeFade((prev) =>
      prev.top === top && prev.bottom === bottom ? prev : { top, bottom },
    )
  }, [scrollerRef])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const observer = new ResizeObserver(syncEdgeFadeNow)
    observer.observe(scroller)
    if (scroller.firstElementChild)
      observer.observe(scroller.firstElementChild)
    return () => observer.disconnect()
  }, [scrollerRef, syncEdgeFadeNow])

  //flush the deferred sync the moment the panel settles
  useEffect(
    () => subscribePanelSettle(syncEdgeFade),
    [subscribePanelSettle, syncEdgeFade],
  )

  const edgeFadeMask = drawerEdgeFadeMask(edgeFade.top, edgeFade.bottom)

  return (
    <div
      {...props}
      ref={engine.panelRef}
      role="dialog"
      aria-modal="true"
      aria-hidden={!engine.open}
      data-pwa-drawer=""
      data-open={engine.open}
      //LOCKED (inline): `engine.panelStyle` carries the sheet's live transform,
      //height cap and keyboard lift — values the drag engine rewrites per frame.
      //A consumer inline `transform` there would not lose to a precedence rule, it
      //would lose to a RACE (`styles.ts` limit 2), so keeping it above the consumer
      //tier at least makes the outcome the one adaptv declared. Look stays base.
      {...mergeStyles({
        base: DRAWER_PANEL_BASE_CLASS,
        className,
        locked: [
          engine.panelPosition,
          engine.panelZ,
          DRAWER_PANEL_LOCKED_CLASS,
        ],
        style,
        //the height locks have an inline half for the same reason `lockedStyle` exists at all —
        //an inline `style={{ maxHeight }}` outranks every class, locked ones included
        lockedStyle: {
          ...engine.panelStyle,
          height: "auto",
          minHeight: 0,
          maxHeight: "none",
          ...(maxHeight === undefined
            ? undefined
            : {
                [DRAWER_CONTENT_MAX_HEIGHT_VAR]:
                  typeof maxHeight === "number"
                    ? `${maxHeight}px`
                    : maxHeight,
              }),
        } as CSSProperties,
      })}
    >
      {/*the engine writes this box's keyboard room (padding + the cap it grows into) imperatively
         — drawer-keyboard.ts owns those; a raise has to prime one value and tween the next inside
         a single frame, which React's render cadence cannot express. No consumer style channel
         here, so nothing can collide.*/}
      <div ref={engine.contentRef} className={engine.contentLayoutClass}>
        <div
          //internal region, no consumer className channel — `cn` is the right tool
          //here precisely because there are no tiers to arbitrate
          className={cn(
            DRAWER_HANDLE_REGION_CLASS,
            !engine.isDragDisabled &&
              "touch-none cursor-grab active:cursor-grabbing",
          )}
          onPointerDown={engine.onHandlePointerDown}
          onPointerMove={engine.onHandlePointerMove}
          onPointerUp={engine.onHandlePointerUp}
          onPointerCancel={engine.onHandlePointerCancel}
        >
          {handle ?? (
            <span aria-hidden className={DRAWER_GRABBER_BASE_CLASS} />
          )}
        </div>
        <div
          ref={engine.scrollerRef}
          onScroll={syncEdgeFade}
          //LOCKED (inline): the mask IS the scroll-edge affordance and it is
          //recomputed from live scroll position; the transition is the engine's
          //keyboard-lift timing. `scrollClassName` is a paint channel and takes no
          //`style` of its own, so the tier here only ever holds adaptv's values.
          {...mergeStyles({
            base: DRAWER_SCROLLER_BASE_CLASS,
            className: scrollClassName,
            locked: DRAWER_SCROLLER_LOCKED_CLASS,
            lockedStyle: {
              transition: engine.contentPaddingTransition,
              maskImage: edgeFadeMask,
              WebkitMaskImage: edgeFadeMask,
            },
          })}
        >
          {body}
        </div>
        {footer}
      </div>
      <div
        aria-hidden
        className="shrink-0"
        style={{ height: engine.excessHeight }}
      />
    </div>
  )
}
DrawerContent.displayName = "Drawer.Content"

function DrawerPortal({ children }: DrawerPortalProps) {
  return <>{children}</>
}
DrawerPortal.displayName = "Drawer.Portal"

function DrawerTrigger({
  className,
  onClick,
  type = "button",
  ...props
}: DrawerTriggerProps) {
  const { show } = useDrawerActions()

  return (
    <button
      type={type}
      data-drawer-trigger
      //a trigger is a plain <button> adaptv attaches `show()` to — no neutral look
      //and nothing structural, so both tiers are undefined by decision (§2)
      className={mergeStyles({
        base: undefined,
        className,
        locked: undefined,
      })}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        show()
      }}
      {...props}
    />
  )
}
DrawerTrigger.displayName = "Drawer.Trigger"

function DrawerShell({ className, children, ...props }: DrawerShellProps) {
  return (
    //LOCKED: the shell is the flex column the scroller's `min-h-0` cap is measured
    //inside — flatten it and a tall body pushes the panel past its max height
    //instead of scrolling. Everything else about it is the consumer's.
    <div
      className={mergeStyles({
        base: undefined,
        className,
        locked: DRAWER_SHELL_LAYOUT_CLASS,
      })}
      {...props}
    >
      {children}
    </div>
  )
}
DrawerShell.displayName = "Drawer.Shell"

function DrawerDragHandle({
  className,
  children,
  ...props
}: DrawerHandleProps) {
  if (children) {
    return <>{children}</>
  }

  return (
    <span
      aria-hidden
      //a grabber is pure decoration — the drag lives on the region around it, so
      //there is nothing here a className could break
      className={mergeStyles({
        base: DRAWER_GRABBER_BASE_CLASS,
        className,
        locked: undefined,
      })}
      {...props}
    />
  )
}
DrawerDragHandle.displayName = "Drawer.Handle"

/**
 * Pinned action region rendered BELOW the content scroller (sibling, not child).
 * Must be a direct child of `Drawer.Content`. When the drawer hits its max-height
 * cap the scroller shrinks and scrolls while the footer stays visible; the
 * keyboard lift carries it up with the panel. Tier 2 owns padding (incl. the
 * bottom safe-area inset) via `className`.
 */
function DrawerFooter({
  className,
  children,
  ...props
}: DrawerFooterProps) {
  return (
    //`shrink-0` is the footer's whole job — it is the sibling BELOW the scroller
    //that must stay visible when the panel hits its height cap. Locked for that,
    //base for the column direction.
    <div
      className={mergeStyles({
        base: "flex flex-col",
        className,
        locked: "shrink-0",
      })}
      {...props}
    >
      {children}
    </div>
  )
}
DrawerFooter.displayName = "Drawer.Footer"

function DrawerClose({
  className,
  onClick,
  type = "button",
  ...props
}: DrawerCloseProps) {
  const { hide } = useDrawerActions()

  return (
    <button
      type={type}
      //a plain <button> adaptv attaches `hide()` to — no neutral look, nothing
      //structural. Both tiers named so the omission stays a decision (§2).
      className={mergeStyles({
        base: undefined,
        className,
        locked: undefined,
      })}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        hide()
      }}
      {...props}
    />
  )
}
DrawerClose.displayName = "Drawer.Close"

function DrawerTitle({ className, ...props }: DrawerTitleProps) {
  //heading text: nothing neutral to offer, nothing structural to protect
  return (
    <h2
      className={mergeStyles({
        base: undefined,
        className,
        locked: undefined,
      })}
      {...props}
    />
  )
}
DrawerTitle.displayName = "Drawer.Title"

function DrawerDescription({
  className,
  ...props
}: DrawerDescriptionProps) {
  //body text: nothing neutral to offer, nothing structural to protect
  return (
    <p
      className={mergeStyles({
        base: undefined,
        className,
        locked: undefined,
      })}
      {...props}
    />
  )
}
DrawerDescription.displayName = "Drawer.Description"

/* =============================================================================
 * CORE CONTEXT ENGINE
 * ============================================================================= */

type DrawerTreeProps = DrawerRootProps & {
  nested: boolean
  rootRef?: RefObject<HTMLDivElement | null>
  imperativeRef?: Ref<DrawerRootHandle>
}

function DrawerTree({
  children,
  nested: _nested,
  avoidKeyboard = true,
  blurInputs = true,
  disableDrag = false,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  onAnimationEnd,
  rootRef,
  imperativeRef,
}: DrawerTreeProps) {
  const parentScopeDepth = useContext(DrawerScopeContext)
  const isControlled = openProp !== undefined
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const [internalOpen, setInternalOpen] = useState(
    () => openProp ?? defaultOpen,
  )

  const isOpen = isControlled ? Boolean(internalOpen) : uncontrolledOpen
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false)
  const { portal, rest } = partitionDrawerRootChildren(children)

  const triggerOpenLifecycle = useCallback(
    (nextState: boolean) => {
      activeBlur()

      if (isControlled) {
        setInternalOpen(nextState)
      } else {
        setUncontrolledOpen(nextState)
      }
      onOpenChange?.(nextState)
    },
    [isControlled, onOpenChange],
  )

  useEffect(() => {
    if (isControlled && openProp !== internalOpen) {
      triggerOpenLifecycle(openProp)
    }
  }, [openProp, isControlled, internalOpen, triggerOpenLifecycle])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      triggerOpenLifecycle(next)
    },
    [triggerOpenLifecycle],
  )

  const handleSettle = useCallback(
    (nextOpen: boolean) => {
      onAnimationEnd?.(nextOpen)
      if (nextOpen) return
      if (!isControlled) return
      onOpenChange?.(false)
    },
    [isControlled, onAnimationEnd, onOpenChange],
  )

  const handleRequestClose = useCallback(() => {
    handleOpenChange(false)
  }, [handleOpenChange])

  useImperativeHandle(
    imperativeRef,
    () => ({
      get open() {
        return isOpen
      },
      show: () => handleOpenChange(true),
      hide: () => handleOpenChange(false),
      focus: () => {
        rootRef?.current
          ?.querySelector<HTMLButtonElement>(
            "[data-drawer-trigger], button",
          )
          ?.focus()
      },
    }),
    [handleOpenChange, isOpen, rootRef],
  )

  const drawerContextValue = useMemo(
    () => ({ isOpen, avoidKeyboard, isKeyboardOpen }),
    [isOpen, avoidKeyboard, isKeyboardOpen],
  )

  const drawerActions = useMemo(
    () => ({
      show: () => handleOpenChange(true),
      hide: () => handleOpenChange(false),
    }),
    [handleOpenChange],
  )

  return (
    <DrawerScopeContext.Provider value={parentScopeDepth + 1}>
      <DrawerContext.Provider value={drawerContextValue}>
        <DrawerActionsContext.Provider value={drawerActions}>
          <div ref={rootRef} className={DRAWER_ROOT_LAYOUT_CLASS}>
            {rest}
            <DrawerEngine
              open={isOpen}
              onRequestClose={handleRequestClose}
              onSettle={handleSettle}
              onKeyboardOpenChange={setIsKeyboardOpen}
              avoidKeyboard={avoidKeyboard}
              blurInputs={blurInputs}
              disableDrag={disableDrag}
            >
              {portal}
            </DrawerEngine>
          </div>
        </DrawerActionsContext.Provider>
      </DrawerContext.Provider>
    </DrawerScopeContext.Provider>
  )
}

/* =============================================================================
 * EXPORTS EXPOSURE
 * ============================================================================= */

const DrawerRoot = forwardRef<DrawerRootHandle, DrawerRootProps>(
  function DrawerRoot({ children, ...props }, ref) {
    const parentScopeDepth = useContext(DrawerScopeContext)
    const rootRef = useRef<HTMLDivElement>(null)
    return (
      <DrawerTree
        nested={parentScopeDepth > 0}
        rootRef={rootRef}
        imperativeRef={ref}
        {...props}
      >
        {children}
      </DrawerTree>
    )
  },
)
DrawerRoot.displayName = "Drawer"

const DrawerNestedRoot = forwardRef<
  DrawerRootHandle,
  DrawerNestedRootProps
>(function DrawerNestedRoot(props, ref) {
  const rootRef = useRef<HTMLDivElement>(null)
  return (
    <DrawerTree nested rootRef={rootRef} imperativeRef={ref} {...props} />
  )
})
DrawerNestedRoot.displayName = "Drawer.Nested"

export const Drawer = Object.assign(DrawerRoot, {
  Nested: DrawerNestedRoot,
  Trigger: DrawerTrigger,
  Portal: DrawerPortal,
  Overlay: DrawerOverlay,
  Backdrop: DrawerOverlay,
  Content: DrawerContent,
  Shell: DrawerShell,
  Handle: DrawerDragHandle,
  Footer: DrawerFooter,
  Title: DrawerTitle,
  Description: DrawerDescription,
  Close: DrawerClose,
})

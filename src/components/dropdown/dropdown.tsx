import type {
  CSSProperties,
  MouseEvent,
  ReactNode,
  RefObject,
} from "react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { BackPriority } from "#adaptv/capabilities/back-chain"
import type {
  DropdownPlacement,
  ResolvedPosition,
} from "#adaptv/components/dropdown/dropdown-position"
import { resolveDropdownPosition } from "#adaptv/components/dropdown/dropdown-position"
import { subscribeOutsidePress } from "#adaptv/components/dropdown/outside-press"
import {
  PRESS_TARGET_DISABLED_LOCKED_STYLE,
  PRESS_TARGET_LOCKED_STYLE,
} from "#adaptv/components/press-core"
import { useBackHandler } from "#adaptv/hooks/use-back-handler"
import { useInsets } from "#adaptv/hooks/use-insets"
import { mergeStyles } from "#adaptv/utils/styles"

/* =============================================================================
 * Dropdown — an anchored menu.
 *
 * A `position: fixed` panel placed from the trigger's live viewport rect by the
 * pure engine in dropdown-position.ts: it opens on its preferred side, flips when
 * that side can't hold it, caps its height (scrolling inside) when neither can,
 * and shifts to stay on screen — so a trigger clipped inside a scrolling carousel
 * still opens on the visible part. Fixed positioning is deliberate: it escapes any
 * `overflow: hidden` ancestor, which is exactly the occlusion case. It dismisses
 * on an outside press, on scroll/resize it re-anchors, and Escape / the back chain
 * (at the Transient band — "menus dismiss rather than navigate") close it.
 * ============================================================================= */

type DropdownContextValue = {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: RefObject<HTMLButtonElement | null>
  placement: DropdownPlacement
}

const DropdownContext = createContext<DropdownContextValue | null>(null)

function useDropdownContext(): DropdownContextValue {
  const ctx = useContext(DropdownContext)
  if (!ctx)
    throw new Error("Dropdown parts must be used within <Dropdown>.")
  return ctx
}

//LOCKED structure: the panel is a scroll container (its height is capped by the
//engine, and content past the cap must scroll, not overflow the viewport), sits
//above app chrome, and contains its overscroll so a menu fling never scrolls the
//page behind it. z-index and the fixed layer are not the consumer's to reshape.
//The neutral menu surface is a default in dropdown.css, fully overridable.
const DROPDOWN_CONTENT_LOCKED_STYLE: CSSProperties = Object.freeze({
  zIndex: 50,
  overflowY: "auto",
  overscrollBehavior: "contain",
})
//LOCKED: `text-align: start` is structure, not paint — an item is a full-width row
//whose label reads from the inline start, never a centred `<button>` label. Beside it
//rides the press-target `touch-action` longhand: an item sits INSIDE the panel's own
//scroller, so it is exactly the "tappable and gesture-driven" case press-core.ts
//describes (WebKit 240917), and a consumer `touch-none` here would turn every row of
//a scrolling menu into a dead zone. The cursor is the other half of the pair and
//stays a default in dropdown.css, so `className="cursor-wait"` on a pending item
//still wins.
const DROPDOWN_ITEM_LOCKED_STYLE: CSSProperties = Object.freeze({
  ...PRESS_TARGET_LOCKED_STYLE,
  textAlign: "start",
})
const DROPDOWN_ITEM_DISABLED_LOCKED_STYLE: CSSProperties = Object.freeze({
  ...PRESS_TARGET_DISABLED_LOCKED_STYLE,
  textAlign: "start",
})

export type DropdownProps = {
  children: ReactNode
  /** Controlled open state (with {@link DropdownProps.onOpenChange}). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Uncontrolled initial state. */
  defaultOpen?: boolean
  /** Preferred side + alignment; the engine flips/shifts from here. @default "bottom-start" */
  placement?: DropdownPlacement
}

/**
 * Anchored menu. Compose `Dropdown.Trigger` and `Dropdown.Content` (with
 * `Dropdown.Item` children). Controlled via `open`/`onOpenChange`, or uncontrolled
 * via `defaultOpen`.
 */
function Dropdown({
  children,
  open: controlledOpen,
  onOpenChange,
  defaultOpen = false,
  placement = "bottom-start",
}: DropdownProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolled
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolled(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )

  return (
    <DropdownContext.Provider
      value={{ open, setOpen, triggerRef, placement }}
    >
      {children}
    </DropdownContext.Provider>
  )
}

export type DropdownTriggerProps = {
  children: ReactNode
  className?: string
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  "aria-label"?: string
}

function DropdownTrigger({
  children,
  className,
  onClick,
  ...props
}: DropdownTriggerProps) {
  const { open, setOpen, triggerRef } = useDropdownContext()
  return (
    <button
      ref={triggerRef}
      type="button"
      data-adaptv="dropdown-trigger"
      data-part="trigger"
      aria-haspopup="menu"
      aria-expanded={open}
      //No default and no lock, by decision (like Drawer.Trigger): a trigger is a
      //plain button adaptv wires open/close onto, with no neutral look of its own.
      className={mergeStyles({ className }) || undefined}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        setOpen(!open)
      }}
      {...props}
    >
      {children}
    </button>
  )
}
DropdownTrigger.displayName = "Dropdown.Trigger"

export type DropdownContentProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
  "aria-label"?: string
}

function DropdownContent({
  children,
  className,
  style,
  ...props
}: DropdownContentProps) {
  const { open, setOpen, triggerRef, placement } = useDropdownContext()
  const insets = useInsets()
  const contentRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<ResolvedPosition | null>(null)

  const reposition = useCallback(() => {
    const trigger = triggerRef.current
    const content = contentRef.current
    if (!trigger || !content) return
    const t = trigger.getBoundingClientRect()
    setPos(
      resolveDropdownPosition({
        trigger: { x: t.x, y: t.y, width: t.width, height: t.height },
        //natural size: read the UNCAPPED content so the engine decides the cap
        content: {
          width: content.offsetWidth,
          height: content.scrollHeight,
        },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        insets,
        placement,
      }),
    )
  }, [insets, placement, triggerRef])

  //measure + place before paint so the panel never flashes at the wrong spot
  useLayoutEffect(() => {
    if (open) reposition()
    else setPos(null)
  }, [open, reposition])

  //re-anchor as ancestors scroll or the viewport resizes (capture catches every
  //scroller, incl. the carousel the trigger lives in)
  useEffect(() => {
    if (!open) return
    const onMove = () => reposition()
    window.addEventListener("scroll", onMove, true)
    window.addEventListener("resize", onMove)
    return () => {
      window.removeEventListener("scroll", onMove, true)
      window.removeEventListener("resize", onMove)
    }
  }, [open, reposition])

  //outside press dismisses; touch is decided after the gesture recognisers have
  //run, so an edge swipe closes the panel through the back chain instead of
  //finding it already gone (see outside-press.ts)
  useEffect(() => {
    if (!open) return
    return subscribeOutsidePress(
      (target) =>
        contentRef.current?.contains(target as Node | null) === true ||
        triggerRef.current?.contains(target as Node | null) === true,
      () => setOpen(false),
    )
  }, [open, setOpen, triggerRef])

  //Escape dismisses, and does not bubble to close anything behind it
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open, setOpen, triggerRef])

  //hardware/gesture back closes the menu instead of navigating (Transient band)
  useBackHandler(() => {
    if (!open) return false
    setOpen(false)
    return true
  }, BackPriority.Transient)

  if (!open) return null

  const positioned = pos !== null
  const merged = mergeStyles({
    className,
    style,
    lockedStyle: {
      ...DROPDOWN_CONTENT_LOCKED_STYLE,
      position: "fixed",
      left: pos?.left ?? 0,
      top: pos?.top ?? 0,
      maxHeight: pos?.maxHeight,
      maxWidth: pos?.maxWidth,
      //hidden for the single pre-measure frame so it never paints mis-placed
      visibility: positioned ? "visible" : "hidden",
    },
  })

  return (
    <div
      ref={contentRef}
      data-adaptv="dropdown"
      data-part="content"
      data-side={pos?.side}
      data-align={pos?.align}
      role="menu"
      tabIndex={-1}
      className={merged.className || undefined}
      style={merged.style}
      {...props}
    >
      {children}
    </div>
  )
}
DropdownContent.displayName = "Dropdown.Content"

export type DropdownItemProps = {
  children: ReactNode
  className?: string
  /** Fires on activation; the menu then closes. */
  onSelect?: () => void
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  "aria-label"?: string
}

function DropdownItem({
  children,
  className,
  onSelect,
  onClick,
  disabled,
  ...props
}: DropdownItemProps) {
  const { setOpen } = useDropdownContext()
  const merged = mergeStyles({
    className,
    lockedStyle: disabled
      ? DROPDOWN_ITEM_DISABLED_LOCKED_STYLE
      : DROPDOWN_ITEM_LOCKED_STYLE,
  })
  return (
    <button
      type="button"
      role="menuitem"
      data-adaptv="dropdown-item"
      data-part="item"
      disabled={disabled}
      className={merged.className || undefined}
      style={merged.style}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        onSelect?.()
        setOpen(false)
      }}
      {...props}
    >
      {children}
    </button>
  )
}
DropdownItem.displayName = "Dropdown.Item"

const DropdownCompound = Object.assign(Dropdown, {
  Trigger: DropdownTrigger,
  Content: DropdownContent,
  Item: DropdownItem,
})

export { DropdownCompound as Dropdown }

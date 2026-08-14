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

/* =============================================================================
 * CLASSES
 * ============================================================================= */

//LOCKED structure: the panel is a scroll container (its height is capped by the
//engine, and content past the cap must scroll, not overflow the viewport), sits
//above app chrome, and contains its overscroll so a menu fling never scrolls the
//page behind it. z-index and the fixed layer are not the consumer's to reshape.
const DROPDOWN_CONTENT_LOCKED_CLASS =
  "z-50 overflow-y-auto overscroll-contain"
//BASE neutral look — a menu surface, fully overridable via Tier 2 `className`.
const DROPDOWN_CONTENT_BASE_CLASS =
  "min-w-[8rem] rounded-md bg-surface p-1 shadow-lg ring-1 ring-border"
const DROPDOWN_ITEM_BASE_CLASS =
  "flex w-full items-center rounded-sm px-3 py-2 text-sm text-foreground disabled:opacity-40"
const DROPDOWN_ITEM_LOCKED_CLASS = "clickable text-start"

/* =============================================================================
 * ROOT
 * ============================================================================= */

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

/* =============================================================================
 * TRIGGER
 * ============================================================================= */

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
      aria-haspopup="menu"
      aria-expanded={open}
      //Both tiers undefined by decision (like Drawer.Trigger): a trigger is a plain
      //button adaptv wires open/close onto, with no neutral look of its own.
      className={mergeStyles({
        base: undefined,
        className,
        locked: undefined,
      })}
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

/* =============================================================================
 * CONTENT
 * ============================================================================= */

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

  //outside press dismisses (capture so it beats the pressed element's own handler)
  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (
        contentRef.current?.contains(target) ||
        triggerRef.current?.contains(target)
      ) {
        return
      }
      setOpen(false)
    }
    window.addEventListener("pointerdown", onDown, true)
    return () => window.removeEventListener("pointerdown", onDown, true)
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
    base: DROPDOWN_CONTENT_BASE_CLASS,
    className,
    locked: DROPDOWN_CONTENT_LOCKED_CLASS,
    style,
    lockedStyle: {
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
      data-side={pos?.side}
      data-align={pos?.align}
      role="menu"
      tabIndex={-1}
      className={merged.className}
      style={merged.style}
      {...props}
    >
      {children}
    </div>
  )
}
DropdownContent.displayName = "Dropdown.Content"

/* =============================================================================
 * ITEM
 * ============================================================================= */

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
  return (
    <button
      type="button"
      role="menuitem"
      data-adaptv="dropdown-item"
      disabled={disabled}
      className={mergeStyles({
        base: DROPDOWN_ITEM_BASE_CLASS,
        className,
        locked: DROPDOWN_ITEM_LOCKED_CLASS,
      })}
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

/* =============================================================================
 * COMPOUND EXPORT
 * ============================================================================= */

const DropdownCompound = Object.assign(Dropdown, {
  Trigger: DropdownTrigger,
  Content: DropdownContent,
  Item: DropdownItem,
})

export { DropdownCompound as Dropdown }

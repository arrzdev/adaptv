import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { clamp } from "#nativ/utils/clamp"
import { cn } from "#nativ/utils/cn"

/* =============================================================================
 * CONSTANTS
 * ============================================================================= */

export const WHEEL_ITEM_HEIGHT = 30
const VISIBLE_ROWS = 5
export const WHEEL_HEIGHT = WHEEL_ITEM_HEIGHT * VISIBLE_ROWS
const WHEEL_PAD = WHEEL_ITEM_HEIGHT * 2

// drum projection (the iOS-native cylinder): rows are re-projected from their
// flat scroll slots onto a cylinder — tilted, pulled toward the rim, pushed
// back in Z — so the column reads as a rotating drum, not a flat list. The
// radius follows from the step angle so one row of scroll = one step of drum.
const WHEEL_ROW_TILT_DEG = 22
const WHEEL_MAX_TILT_DEG = 84
const WHEEL_PERSPECTIVE_PX = 600
const WHEEL_RADIUS =
  WHEEL_ITEM_HEIGHT / (2 * Math.tan((WHEEL_ROW_TILT_DEG * Math.PI) / 360))

// fade the rows above/below the centered selection
const WHEEL_MASK =
  "linear-gradient(to bottom, transparent, #000 34%, #000 66%, transparent)"

const WHEEL_FIELDSET_CLASS =
  "m-0 min-w-0 scrollable-y overscroll-contain border-0 p-0"

// neutral Tier-1 row paint: iOS keeps size and weight UNIFORM across rows —
// the centered row is emphasized by color only (plus the consumer's selection
// lens), so never add a data-active size/weight jump here. Tier-2 recolors via
// `itemClassName` + `data-[active=true]:`. JS owns the row transform (drum
// projection) — never add transform utilities or a transform transition.
const WHEEL_ITEM_NEUTRAL_CLASS =
  "clickable flex h-full w-full items-center justify-center text-lg font-medium text-gray-400 tabular-nums transition-colors duration-150 data-[active=true]:text-gray-900"

/* =============================================================================
 * TYPES
 * ============================================================================= */

export type WheelItem = { value: number; label: string }

export interface WheelColumnProps {
  items: WheelItem[]
  /** Centered (selected) value. */
  value: number
  /**
   * Fired whenever the centered value changes — live while the wheel is
   * moving, plus a final commit once scrolling settles.
   */
  onChange: (value: number) => void
  /** Accessible name for the column (rendered as a `<fieldset>`). */
  ariaLabel: string
  /** Tier-2 paint on the scroll container. */
  className?: string
  /**
   * Tier-2 paint on each row (a full-size `<button>`) — branch the centered
   * row with `data-[active=true]:`.
   *
   * | Attribute | When | Example |
   * |-----------|------|---------|
   * | `data-active` | row is the centered selection | `data-[active=true]:text-foreground` |
   */
  itemClassName?: string
}

/* =============================================================================
 * ROOT
 * ============================================================================= */

// FREE momentum scroll — no CSS scroll-snap. `y mandatory` on iOS truncates
// flings to a crawl (the browser aims for a nearby snap point instead of
// letting the drum spin), which reads as "stuck". Instead the glide runs
// native and unclipped, and once it settles we smooth-roll to the nearest row
// (the JS settle snap). The value reports live as rows cross the center —
// closing/submitting mid-glide keeps whatever the wheel was last over.
/**
 * iOS-style scroll-wheel column: a free momentum scroller with the native
 * drum projection (rows curve onto a cylinder) that reports the centered row
 * live as it changes and settle-snaps to the nearest row. Tapping a row rolls
 * it to the center. Neutral Tier-1 (gray baseline) — paint the rows via
 * `itemClassName` + the `data-active` hook. One column; compose several
 * (e.g. day / month / year) at the call site.
 */
export function WheelColumn({
  items,
  value,
  onChange,
  ariaLabel,
  className,
  itemClassName,
}: WheelColumnProps) {
  const scrollRef = useRef<HTMLFieldSetElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const draggingRef = useRef(false)
  //true from the first scroll event until settle — covers the momentum glide
  //after the finger lifts, where draggingRef is already false
  const scrollingRef = useRef(false)
  const commitTimer = useRef(0)

  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  )
  // tracks the centered row live while scrolling (highlight only, no commit)
  const [activeIndex, setActiveIndex] = useState(selectedIndex)

  function clampIndex(index: number) {
    return Math.min(items.length - 1, Math.max(0, index))
  }

  function nearestIndex() {
    const el = scrollRef.current
    if (!el) return selectedIndex
    return clampIndex(Math.round(el.scrollTop / WHEEL_ITEM_HEIGHT))
  }

  // project every row onto the drum for the current scroll position — direct
  // style writes (transform only) on the same cadence as scroll events
  function paintBarrel() {
    const el = scrollRef.current
    const list = listRef.current
    if (!el || !list) return
    //distance from center in rows: row i sits i*H - scrollTop from the middle
    const centerRow = el.scrollTop / WHEEL_ITEM_HEIGHT
    for (let index = 0; index < list.children.length; index++) {
      const row = list.children[index] as HTMLElement
      const tiltDeg = clamp(
        (index - centerRow) * WHEEL_ROW_TILT_DEG,
        -WHEEL_MAX_TILT_DEG,
        WHEEL_MAX_TILT_DEG,
      )
      const tilt = (tiltDeg * Math.PI) / 180
      //move the row from its flat slot to its cylinder position: rows bunch
      //and foreshorten toward the rim exactly like the native drum
      const flatY = (index - centerRow) * WHEEL_ITEM_HEIGHT
      const drumY = WHEEL_RADIUS * Math.sin(tilt)
      const drumZ = WHEEL_RADIUS * (Math.cos(tilt) - 1)
      row.style.transform = `perspective(${WHEEL_PERSPECTIVE_PX}px) translateY(${drumY - flatY}px) translateZ(${drumZ}px) rotateX(${-tiltDeg}deg)`
    }
  }

  //rows appear/disappear when items change (e.g. day count) — reproject
  // biome-ignore lint/correctness/useExhaustiveDependencies: items drives the row list
  useLayoutEffect(() => {
    paintBarrel()
  }, [items])

  // align to the external value (mount + changes like day clamping) when idle;
  // skipping while scrolling also keeps the live onChange echo (parent setting
  // `value` back to what we just reported) from yanking an in-flight glide
  // biome-ignore lint/correctness/useExhaustiveDependencies: paintBarrel reads refs only — selectedIndex is the real trigger
  useEffect(() => {
    const el = scrollRef.current
    if (!el || draggingRef.current || scrollingRef.current) return
    const target = selectedIndex * WHEEL_ITEM_HEIGHT
    if (Math.abs(el.scrollTop - target) > 1) el.scrollTo({ top: target })
    setActiveIndex(selectedIndex)
    paintBarrel()
  }, [selectedIndex])

  // the glide has settled — roll to the exact row (free scroll has no CSS
  // snap) and push the value up. The smooth roll re-enters handleScroll, so
  // this converges: once on the row the offset is sub-pixel and we're done.
  function commit() {
    scrollingRef.current = false
    const index = nearestIndex()
    setActiveIndex(index)
    const el = scrollRef.current
    if (el) {
      const target = index * WHEEL_ITEM_HEIGHT
      if (Math.abs(el.scrollTop - target) > 1) {
        el.scrollTo({ top: target, behavior: "smooth" })
      }
    }
    const next = items[index]
    if (next && next.value !== value) onChange(next.value)
  }

  function handleScroll() {
    scrollingRef.current = true
    paintBarrel()
    const index = nearestIndex()
    setActiveIndex(index)
    //report live — whatever row is centered right now IS the value, so a
    //close/submit mid-glide saves what the user last saw
    const next = items[index]
    if (next && next.value !== value) onChange(next.value)
    window.clearTimeout(commitTimer.current)
    // while a finger is down, leave the wheel free; the timer also keeps
    // resetting through the snap glide, so we settle only once it idles
    if (draggingRef.current) return
    commitTimer.current = window.setTimeout(commit, 120)
  }

  // touch (not pointer) events: iOS fires pointercancel mid-scroll, which would
  // wrongly look like a release; touchend only fires on the real finger-lift
  function handleTouchStart() {
    draggingRef.current = true
    window.clearTimeout(commitTimer.current)
  }

  function handleTouchEnd() {
    if (!draggingRef.current) return
    draggingRef.current = false
    window.clearTimeout(commitTimer.current)
    commitTimer.current = window.setTimeout(commit, 120)
  }

  //iOS-native affordance: tapping a row rolls it into the center. The smooth
  //scroll emits scroll events, so the live report + settle commit both run.
  function handleRowTap(index: number) {
    scrollRef.current?.scrollTo({
      top: index * WHEEL_ITEM_HEIGHT,
      behavior: "smooth",
    })
  }

  return (
    <fieldset
      ref={scrollRef}
      onScroll={handleScroll}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      aria-label={ariaLabel}
      //spinning past the top row would otherwise hand the gesture to the
      //sheet drag (free scroll hits scrollTop 0 mid-spin) — a wheel touch is
      //never a drawer drag
      data-drawer-no-drag=""
      className={cn(WHEEL_FIELDSET_CLASS, className)}
      style={{
        height: WHEEL_HEIGHT,
        maskImage: WHEEL_MASK,
        WebkitMaskImage: WHEEL_MASK,
      }}
    >
      <ul
        ref={listRef}
        className="m-0 list-none p-0"
        style={{ paddingTop: WHEEL_PAD, paddingBottom: WHEEL_PAD }}
      >
        {items.map((item, index) => {
          const isActive = index === activeIndex
          return (
            <li key={item.value} style={{ height: WHEEL_ITEM_HEIGHT }}>
              <button
                type="button"
                //pointer-first control inside a scroll wheel — the fieldset
                //itself is the keyboard/AT surface, so keep rows out of tab order
                tabIndex={-1}
                data-active={isActive}
                onClick={() => handleRowTap(index)}
                className={cn(WHEEL_ITEM_NEUTRAL_CLASS, itemClassName)}
              >
                {item.label}
              </button>
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}

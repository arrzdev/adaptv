import type { CSSProperties, KeyboardEvent } from "react"
import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react"
import { TOUCH_PASSTHROUGH_STYLE } from "#adaptv/components/press-core"
import {
  snapIndex,
  WHEEL_HEIGHT,
  WHEEL_ITEM_HEIGHT,
  WHEEL_PAD,
  wheelRowTransform,
} from "#adaptv/components/wheel-column-geometry"
import { mergeStyles } from "#adaptv/utils/styles"

/* =============================================================================
 * CONSTANTS — the item height, layout box and drum projection now live in
 * wheel-column-geometry.ts (pure + unit-tested); this file drives them.
 * WHEEL_ITEM_HEIGHT/WHEEL_HEIGHT stay on the public component path via re-export.
 * ============================================================================= */

export { WHEEL_HEIGHT, WHEEL_ITEM_HEIGHT }

//rows a PageUp/PageDown moves: one visible column's worth, as a native picker pages
const WHEEL_PAGE_ROWS = WHEEL_HEIGHT / WHEEL_ITEM_HEIGHT

// fade the rows above/below the centered selection
const WHEEL_MASK =
  "linear-gradient(to bottom, transparent, #000 34%, #000 66%, transparent)"

/*
 * LOCKED (inline, docs/decisions/styling.md §2.0): the wheel IS the scroller — every
 * index this component reports is `scrollTop / WHEEL_ITEM_HEIGHT`, so a consumer's
 * `overflow-hidden` would not restyle it, it would make it report 0 forever.
 *
 * ⚠︎ This once read `"scrollable-y overscroll-contain"`, and the second class SILENTLY
 * won the whole shorthand — `overscroll-behavior: contain` overrode the axis rule, and
 * the wheel stopped scrolling. As inline longhands there is no shorthand to collide
 * with and no conflict table to keep in step: each property is its own key.
 *
 * The height is `VISIBLE_ROWS * WHEEL_ITEM_HEIGHT` and the list is padded by exactly
 * two rows top and bottom so that scrollTop 0 centres index 0. Change the height and
 * the centre line moves off the selected row — the column keeps working and reports
 * the wrong value. The mask is what fades the unselected rows onto the drum.
 *
 * The fieldset's UA margin/padding/border reset is a default, not a lock: it lives in
 * styles/wheel-column.css, and a consumer who wants a bordered column may say so.
 */
const WHEEL_FIELDSET_LOCKED_STYLE: CSSProperties = Object.freeze({
  overflowY: "auto",
  overflowX: "hidden",
  overscrollBehaviorY: "contain",
  ...TOUCH_PASSTHROUGH_STYLE,
  height: WHEEL_HEIGHT,
  maskImage: WHEEL_MASK,
  WebkitMaskImage: WHEEL_MASK,
})
//the two-row pad that centres index 0 at scrollTop 0 (see above)
const WHEEL_LIST_STYLE: CSSProperties = Object.freeze({
  paddingTop: WHEEL_PAD,
  paddingBottom: WHEEL_PAD,
})
const WHEEL_ROW_STYLE: CSSProperties = Object.freeze({
  height: WHEEL_ITEM_HEIGHT,
})
//LOCKED on a row: full width and height is what makes the whole 30px slot the tap
//target the drum projection is computed against — a shrunk row leaves dead gaps
//between selections. The touch-action longhand is the press-target contract (WebKit
//240917). The row's paint (size, weight, the active colour) is a default in
//styles/wheel-column.css.
const WHEEL_ITEM_LOCKED_STYLE: CSSProperties = Object.freeze({
  ...TOUCH_PASSTHROUGH_STYLE,
  height: "100%",
  width: "100%",
})

export type WheelItem = { value: number; label: string }

export interface WheelColumnProps {
  items: WheelItem[]
  /** Centered (selected) value. */
  value: number
  /**
   * Fired whenever the centered value changes — live while the wheel is
   * moving, plus a final commit once scrolling settles on a row that is not
   * the current `value`.
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

/** True for an empty list, no tracked finger, or a list naming the tracked one. */
function namesTrackedFinger(
  list: ArrayLike<{ identifier: number }> | undefined,
  fingerId: number | null,
) {
  if (!list || list.length === 0 || fingerId === null) return true
  for (let i = 0; i < list.length; i++) {
    if (list[i]?.identifier === fingerId) return true
  }
  return false
}

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
  //the finger that is spinning the wheel. A thumb steadying the phone lands
  //and lifts anywhere on the screen while it spins, on this same event
  //stream: its touchstart does not restart the spin and its lift is not the
  //lift. `touches` is every point on the whole surface, so the lift is read
  //off `changedTouches`, the points THIS event is about
  const fingerIdRef = useRef<number | null>(null)
  //true from the first scroll event until settle — covers the momentum glide
  //after the finger lifts, where draggingRef is already false
  const scrollingRef = useRef(false)
  const commitTimer = useRef(0)
  //the row the last key press aimed at, until the wheel settles — a second press
  //lands while the first roll is still travelling, and counting from the centred row
  //then would swallow it
  const keyTargetRef = useRef<number | null>(null)
  //the settle as of the latest commit, for the timers to call: a timer is armed by an
  //event handler from the render BEFORE the consumer stores the row it reported (or
  //clamps a day the month no longer has), and that render's own commit would read its
  //stale value, items and onChange — reporting the stored row a second time, a row
  //that left the list, or a row through a callback that closes over an old month
  const commitRef = useRef(() => {})
  //the row a live report named since the wheel's last commit. A scroll event reads
  //`value` from that commit, so a second event before the consumer's re-render (the
  //engine ran a frame ahead of React's render task, as WebKit does after a long task)
  //would report the stored row again. Every report also forces a commit, which is
  //what clears it: a consumer that does not store still hears the row every frame
  const reportedRef = useRef<number | null>(null)
  const [, forceCommit] = useReducer((count: number) => count + 1, 0)
  //a layout effect, not a passive one: passive effects can run after the next frame's
  //scroll event, which would find the ref still set and swallow the row a consumer
  //that does not store is owed
  useLayoutEffect(() => {
    commitRef.current = commit
    reportedRef.current = null
  })

  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  )
  // tracks the centered row live while scrolling (highlight only, no commit)
  const [activeIndex, setActiveIndex] = useState(selectedIndex)

  function nearestIndex() {
    const el = scrollRef.current
    if (!el) return selectedIndex
    return snapIndex(el.scrollTop, items.length)
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
      //project the row from its flat slot onto the cylinder — rows bunch and
      //foreshorten toward the rim exactly like the native drum
      row.style.transform = wheelRowTransform(index - centerRow)
    }
  }

  //Drive the drum from a rAF loop while the wheel is in motion, not only from
  //scroll events. On a hard iOS momentum fling the compositor scrolls ahead of the
  //main thread and scroll events are coalesced, so a projection written only on
  //those events LAGS the real scrollTop — the rows shear and stutter, worst at high
  //velocity ("looks broken when flicked fast"). Painting every animation frame from
  //the live scrollTop keeps the drum locked to the scroll no matter how sparse the
  //scroll events are. The loop self-stops the frame the wheel idles.
  const rafRef = useRef(0)
  function paintLoop() {
    paintBarrel()
    rafRef.current =
      scrollingRef.current || draggingRef.current
        ? requestAnimationFrame(paintLoop)
        : 0
  }
  function ensurePaintLoop() {
    if (rafRef.current === 0) {
      rafRef.current = requestAnimationFrame(paintLoop)
    }
  }

  //stop the loop and the pending commit if we unmount mid-spin
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      window.clearTimeout(commitTimer.current)
    }
  }, [])

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
    keyTargetRef.current = null
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
    //rAF owns the per-frame projection now; a scroll event only needs to make sure
    //the loop is running (and report the live value below)
    ensurePaintLoop()
    const index = nearestIndex()
    setActiveIndex(index)
    //report live — whatever row is centered right now IS the value, so a
    //close/submit mid-glide saves what the user last saw
    const next = items[index]
    if (
      next &&
      next.value !== value &&
      next.value !== reportedRef.current
    ) {
      reportedRef.current = next.value
      forceCommit()
      onChange(next.value)
    }
    window.clearTimeout(commitTimer.current)
    // while a finger is down, leave the wheel free; the timer also keeps
    // resetting through the snap glide, so we settle only once it idles
    if (draggingRef.current) return
    commitTimer.current = window.setTimeout(() => commitRef.current(), 120)
  }

  // touch (not pointer) events: iOS fires pointercancel mid-scroll, which would
  // wrongly look like a release; touchend only fires on the real finger-lift
  function handleTouchStart(e: React.TouchEvent) {
    if (draggingRef.current) return
    draggingRef.current = true
    fingerIdRef.current = e.changedTouches?.[0]?.identifier ?? null
    keyTargetRef.current = null
    window.clearTimeout(commitTimer.current)
    //paint from the first frame of the drag, before any scroll event fires
    ensurePaintLoop()
  }

  function handleTouchEnd(e: React.TouchEvent) {
    if (!draggingRef.current) return
    //a lift or a cancel that names another finger (the thumb) leaves the
    //spinning finger down: not the lift, no settle yet. One that names the
    //spinning finger, or names no finger at all (a driver's bare cancel), is
    if (!namesTrackedFinger(e.changedTouches, fingerIdRef.current)) return
    fingerIdRef.current = null
    draggingRef.current = false
    window.clearTimeout(commitTimer.current)
    commitTimer.current = window.setTimeout(() => commitRef.current(), 120)
  }

  //iOS-native affordance: tapping a row rolls it into the center. The smooth
  //scroll emits scroll events, so the live report + settle commit both run.
  function handleRowTap(index: number) {
    scrollRef.current?.scrollTo({
      top: index * WHEEL_ITEM_HEIGHT,
      behavior: "smooth",
    })
  }

  //the keyboard path to the value: the column is the tab stop (its rows are not),
  //and a key rolls it exactly like a tap, so the value still flows through the
  //scroll pipeline. Handled here rather than left to the engine, whose own arrow
  //scroll moves 40px and would settle onto a row the key did not ask for.
  function handleKeyDown(event: KeyboardEvent<HTMLFieldSetElement>) {
    //Alt/Cmd/Ctrl+Arrow belong to the browser and the OS (history, word and line
    //jumps, screen-reader commands) — a picker that eats them breaks those
    if (event.altKey || event.metaKey || event.ctrlKey) return
    if (items.length === 0) return
    const from = keyTargetRef.current ?? nearestIndex()
    const last = items.length - 1
    const to = {
      ArrowDown: from + 1,
      ArrowUp: from - 1,
      PageDown: from + WHEEL_PAGE_ROWS,
      PageUp: from - WHEEL_PAGE_ROWS,
      Home: 0,
      End: last,
    }[event.key]
    if (to === undefined) return
    event.preventDefault()
    keyTargetRef.current = Math.min(last, Math.max(0, to))
    handleRowTap(keyTargetRef.current)
  }

  return (
    <fieldset
      data-adaptv="wheel-column"
      data-part="root"
      ref={scrollRef}
      onScroll={handleScroll}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      onKeyDown={handleKeyDown}
      //the column's only keyboard stop (its rows are tabIndex -1). It stays a named
      //group rather than taking `spinbutton`, the ARIA pattern these keys come from:
      //that role changes what VoiceOver does with the rows inside, which is a device
      //check this change has not had
      // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard access to a group whose rows are out of the tab order, see above
      tabIndex={0}
      aria-label={ariaLabel}
      //spinning past the top row would otherwise hand the gesture to the
      //sheet drag (free scroll hits scrollTop 0 mid-spin) — a wheel touch is
      //never a drawer drag
      data-drawer-no-drag=""
      //`lockedStyle`, not a bare `style=`: see WHEEL_FIELDSET_LOCKED_STYLE
      {...mergeStyles({
        className,
        lockedStyle: WHEEL_FIELDSET_LOCKED_STYLE,
      })}
    >
      <ul
        ref={listRef}
        data-adaptv="wheel-column-list"
        data-part="list"
        style={WHEEL_LIST_STYLE}
      >
        {items.map((item, index) => {
          const isActive = index === activeIndex
          return (
            <li key={item.value} style={WHEEL_ROW_STYLE}>
              <button
                type="button"
                //pointer-first control inside a scroll wheel — the fieldset is
                //the one tab stop and owns the keys, so keep rows out of tab order
                tabIndex={-1}
                data-adaptv="wheel-column-item"
                data-part="item"
                data-active={isActive}
                onClick={() => handleRowTap(index)}
                {...mergeStyles({
                  className: itemClassName,
                  lockedStyle: WHEEL_ITEM_LOCKED_STYLE,
                })}
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

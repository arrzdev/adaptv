/**
 * Slider: a painted track under adaptv's own pointer handling, with a real
 * `<input type="range">` kept in the tree for keyboard, screen readers and forms.
 *
 * ## The four quirks this component owns
 *
 * 1. **iOS WebKit ignores a touch that starts on a native range input's TRACK.**
 *    Only the thumb itself drags, and a tap on the track does nothing, so a
 *    finger that lands two millimetres off the thumb gets no response. adaptv
 *    paints its own track and handles the pointer on the WHOLE control, so
 *    tap-to-set and drag-from-anywhere work everywhere; the native input stays
 *    mounted, visually hidden but focusable, and remains the semantic control.
 *
 * 2. **A horizontal drag competes with a Swipeable row, a Drawer drag and the
 *    ScrollView for the same pointer.** The slider claims the shared arbiter at
 *    the moment the gesture LOCKS horizontal (|dx| > |dy| past the slop) under
 *    {@link GesturePriority.Slider}, `blocksScroll: true`, and `onLost` ends the
 *    drag. A touch that goes vertical first abandons the gesture and leaves the
 *    value UNCHANGED, so scrolling a page by dragging across a slider never
 *    moves it. A touch that lifts where it landed is a TAP, and the lift is the
 *    set: the press deferred it only until the finger said it was not a scroll.
 *    Mouse and pen set the value on pointerdown: there is no scroll to protect
 *    against, and a click-to-set that waited for movement would feel broken.
 *
 * 3. **`pointercancel` must end the drag cleanly, and on iOS it only fires if
 *    sibling pointer listeners exist** (WebKit 194173, register B13). pointerdown,
 *    pointermove, pointerup and pointercancel are all registered on the root for
 *    that reason. The root carries the touch-action LONGHAND `pan-y pinch-zoom`,
 *    never `manipulation` (WebKit 240917 kills pointercancel under it), so vertical
 *    panning stays native and the horizontal axis is the slider's.
 *
 * 4. **Float steps must read as the decimal the user sees.** With step 0.1,
 *    three arrow presses from 0 must read exactly 0.3 and never
 *    0.30000000000000004. {@link quantizeSliderValue} snaps to the step grid from
 *    `min` and rounds to the step's decimal places; every value the component
 *    reports goes through it.
 */
import type {
  ChangeEvent,
  CSSProperties,
  KeyboardEvent,
  PointerEvent,
  ReactNode,
  RefObject,
} from "react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"
import { TOUCH_PASSTHROUGH_STYLE } from "#adaptv/components/press-core"
import {
  GesturePriority,
  useGestureCapture,
} from "#adaptv/hooks/use-gesture-capture"
import { mergeStyles } from "#adaptv/utils/styles"

/** Props for the root {@link Slider}. */
export interface SliderProps {
  /** Controlled value. */
  value?: number
  /** Initial value when uncontrolled. Defaults to `min`. */
  defaultValue?: number
  /** Fired on every change the user makes: each drag sample, a tap, a key. */
  onValueChange?: (value: number) => void
  /** Fired once when a drag or tap ends, and once per keyboard change. */
  onValueCommit?: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  /** Form field name, carried by the native range input. */
  name?: string
  /** Id of the native range input, so a `<label htmlFor>` reaches it. */
  id?: string
  "aria-label"?: string
  "aria-labelledby"?: string
  /** Tier 2 utilities for the root, the hit area. */
  className?: string
  style?: CSSProperties
  /** `Slider.Track`, `Slider.Range` and `Slider.Thumb` slots; defaults to all three. */
  children?: ReactNode
}

/** Reactive state from {@link useSlider}, for Tier 2 branch paint inside the slots. */
export type SliderContextValue = {
  value: number
  min: number
  max: number
  step: number
  /** `(value - min) / (max - min)`, 0..1. */
  percent: number
  isDragging: boolean
  isDisabled: boolean
}

export interface SliderTrackProps {
  className?: string
  children?: ReactNode
}

export interface SliderRangeProps {
  className?: string
}

export interface SliderThumbProps {
  className?: string
}

/**
 * The movement (px) a touch must travel before the gesture is judged. Below it
 * the finger has not said which axis it means yet, and a slider that grabbed
 * every touch at 1px would swallow the start of every page scroll across it.
 */
const SLIDER_LOCK_SLOP_PX = 6

/**
 * The published fill, 0..1. Unprefixed because it is scoped to the slider's own
 * subtree (docs/decisions/styling.md §3.2); the range and thumb read it in
 * `calc()` so the paint follows the value with no measurement.
 */
const SLIDER_FILL_VAR = "--slider-fill"

//The root's flex layout, 44px minimum height, width and disabled cursor, and every
//part's look (track rail, range fill, thumb size, colour and shadow) are default rules
//in styles/slider.css. What is here is LOCKED, inline (docs/decisions/styling.md
//§2.0), so no `className` can defeat it.
//
//LOCKED: `position: relative` is the positioning context the thumb's `absolute` +
//computed `left` are measured against; the pointer mapping below reads the same box,
//so dropping it would break both. The touch-action longhand is quirk 3 above.
const SLIDER_ROOT_LOCKED_STYLE: CSSProperties = Object.freeze({
  position: "relative",
  touchAction: "pan-y pinch-zoom",
})
//A disabled slider must not become a dead zone for a horizontal pan either: it
//handles no pointer, so every axis goes back to the browser (press-core has the
//measurement for why `touch-action: none` on an inert control costs the page its
//scroll).
const SLIDER_ROOT_DISABLED_LOCKED_STYLE: CSSProperties = Object.freeze({
  position: "relative",
  ...TOUCH_PASSTHROUGH_STYLE,
})
//LOCKED, visually hidden: keeps the native input focusable and announced; the
//pointer never reaches it (1px, clipped), which is the whole point of quirk 1. It
//was the `sr-only` utility; inline so a stylesheet that is missing or overridden can
//never put a native range input back under the finger.
const SLIDER_INPUT_LOCKED_STYLE: CSSProperties = Object.freeze({
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  borderWidth: 0,
})
//LOCKED: the track is the box `Slider.Range` fills.
const SLIDER_TRACK_LOCKED_STYLE: CSSProperties = Object.freeze({
  position: "relative",
})
//LOCKED: the range is pinned to the track's leading edge and full height; its width
//is the value.
const SLIDER_RANGE_LOCKED_LAYOUT_STYLE: CSSProperties = Object.freeze({
  position: "absolute",
  top: 0,
  bottom: 0,
  left: 0,
})
//LOCKED: the thumb is decorative and sits over the root's hit area; taking
//pointer events would only make the mapping's start point depend on where the
//finger landed. `top: 50%` pairs with the `-50%` in the locked translate.
const SLIDER_THUMB_LOCKED_LAYOUT_STYLE: CSSProperties = Object.freeze({
  pointerEvents: "none",
  position: "absolute",
  top: "50%",
})

const SliderContext = createContext<SliderContextValue | null>(null)

type SliderInternals = {
  thumbRef: RefObject<HTMLSpanElement | null>
}
const SliderInternalsContext = createContext<SliderInternals | null>(null)

/**
 * Reactive slider state for Tier 2 slot wrappers. Branch on `isDragging`,
 * `isDisabled` or `percent`; throws outside a `<Slider>`.
 */
export function useSlider(): SliderContextValue {
  const ctx = useContext(SliderContext)
  if (!ctx) {
    throw new Error("useSlider must be used within <Slider>.")
  }
  return ctx
}

/* =============================================================================
 * VALUE MATHS
 * ============================================================================= */

/** Decimal places a number is written with, so `0.1` and `1e-7` both count. */
function decimalPlacesOf(n: number): number {
  const text = String(n)
  const exponent = text.match(/e-(\d+)$/)
  if (exponent?.[1]) {
    const mantissa = text.slice(0, text.indexOf("e"))
    const mantissaPlaces = mantissa.includes(".")
      ? mantissa.length - mantissa.indexOf(".") - 1
      : 0
    return Number(exponent[1]) + mantissaPlaces
  }
  const dot = text.indexOf(".")
  return dot === -1 ? 0 : text.length - dot - 1
}

/**
 * Snap a value to the step grid that starts at `min`, rounded to the step's own
 * decimal places, and clamped into `[min, max]`.
 *
 * The rounding is quirk 4: `0 + 0.1 + 0.1 + 0.1` is `0.30000000000000004` in
 * binary floating point, and a slider that reports that number to a form or a
 * label is wrong in the only way a user can see. Multiplying the step count
 * back out and fixing the decimals gives the number the grid was written in.
 *
 * When `max` is not on the grid (`min 0, step 3, max 10`) the top value is the
 * last grid point at or below `max`, which is what the native range input does.
 */
export function quantizeSliderValue(
  value: number,
  min: number,
  max: number,
  step: number,
): number {
  if (!Number.isFinite(value)) return min
  if (max <= min) return min
  const safeStep = step > 0 && Number.isFinite(step) ? step : 1
  const clamped = Math.min(max, Math.max(min, value))
  const decimals = Math.max(
    decimalPlacesOf(safeStep),
    decimalPlacesOf(min),
  )
  const round = (n: number) => Number(n.toFixed(decimals))
  let steps = Math.round((clamped - min) / safeStep)
  let snapped = round(min + steps * safeStep)
  //rounding up can step past max when max is off the grid
  if (snapped > max) {
    steps -= 1
    snapped = round(min + steps * safeStep)
  }
  return Math.max(min, snapped)
}

function percentOf(value: number, min: number, max: number): number {
  if (max <= min) return 0
  return Math.min(1, Math.max(0, (value - min) / (max - min)))
}

/* =============================================================================
 * SLOTS
 * ============================================================================= */

/**
 * The painted rail. Structural `relative` is locked so `Slider.Range` has a box
 * to fill; the look is the consumer's.
 */
function SliderTrack({ className, children }: SliderTrackProps) {
  useSlider()
  return (
    <div
      data-adaptv="slider-track"
      data-part="track"
      className={className || undefined}
      style={SLIDER_TRACK_LOCKED_STYLE}
    >
      {children}
    </div>
  )
}

SliderTrack.displayName = "Slider.Track"

/**
 * The filled part of the track, `0..fill` of its width. Reads `--slider-fill`
 * from the root so it moves with the value and never needs a measurement.
 */
function SliderRange({ className }: SliderRangeProps) {
  useSlider()
  const range = mergeStyles({
    className,
    lockedStyle: {
      ...SLIDER_RANGE_LOCKED_LAYOUT_STYLE,
      width: `calc(var(${SLIDER_FILL_VAR}) * 100%)`,
    },
  })
  return (
    <div
      data-adaptv="slider-range"
      data-part="range"
      className={range.className || undefined}
      style={range.style}
    />
  )
}

SliderRange.displayName = "Slider.Range"

/**
 * The decorative thumb. Its position is the value, so it is locked inline:
 * `left` walks the whole root width while the `translate` pulls the thumb back
 * by its OWN width times the same fill. Net travel is `fill * (100% - thumb)`,
 * which keeps the thumb inside the root at both ends without the CSS ever
 * knowing how wide a consumer made it. The pointer mapping in the root uses
 * the same inset, so a press at the thumb's centre reads back the same value.
 */
function SliderThumb({ className }: SliderThumbProps) {
  useSlider()
  const { thumbRef } = useContext(SliderInternalsContext) ?? {}
  const thumb = mergeStyles({
    className,
    lockedStyle: {
      ...SLIDER_THUMB_LOCKED_LAYOUT_STYLE,
      left: `calc(var(${SLIDER_FILL_VAR}) * 100%)`,
      translate: `calc(var(${SLIDER_FILL_VAR}) * -100%) -50%`,
    },
  })
  return (
    <span
      ref={thumbRef}
      aria-hidden
      data-adaptv="slider-thumb"
      data-part="thumb"
      className={thumb.className || undefined}
      style={thumb.style}
    />
  )
}

SliderThumb.displayName = "Slider.Thumb"

/* =============================================================================
 * ROOT
 * ============================================================================= */

type PointerTracking = {
  id: number
  type: string
  startX: number
  startY: number
  /** Whether this pointer owns the value: mouse and pen from down, touch from lock. */
  dragging: boolean
}

/**
 * Horizontal slider. The root is the hit area (44px tall by default); the
 * native `<input type="range">` inside it is the semantic control.
 *
 * Controlled with `value` + `onValueChange`, or uncontrolled with
 * `defaultValue`. `onValueCommit` fires once per finished interaction.
 *
 * @example
 * ```tsx
 * <Slider aria-label="Volume" value={volume} onValueChange={setVolume} />
 *
 * <Slider aria-label="Brightness" defaultValue={40} step={5} onValueCommit={save}>
 *   <Slider.Track className="bg-brand-100">
 *     <Slider.Range className="bg-brand-600" />
 *   </Slider.Track>
 *   <Slider.Thumb className="h-6 w-6 border border-brand-600" />
 * </Slider>
 * ```
 */
function SliderRoot({
  value: controlledValue,
  defaultValue,
  onValueChange,
  onValueCommit,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  name,
  id: idProp,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  className,
  style,
  children,
}: SliderProps) {
  const generatedId = useId()
  const inputId = idProp ?? generatedId
  const isControlled = controlledValue !== undefined
  const [uncontrolledValue, setUncontrolledValue] = useState(() =>
    quantizeSliderValue(defaultValue ?? min, min, max, step),
  )
  //the consumer's controlled value is clamped but not snapped: `step` is the
  //keyboard and drag granularity, and a consumer may legitimately hold 33.3
  const rawValue = isControlled ? controlledValue : uncontrolledValue
  const value = Math.min(max, Math.max(min, rawValue))
  const [isDragging, setIsDragging] = useState(false)
  const isDisabled = Boolean(disabled)

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const thumbRef = useRef<HTMLSpanElement>(null)
  //the live value, read inside pointer handlers where the render's `value` may
  //already be one sample stale
  const valueRef = useRef(value)
  valueRef.current = value
  const pointerRef = useRef<PointerTracking | null>(null)
  const keyboardDirtyRef = useRef(false)

  const onValueChangeRef = useRef(onValueChange)
  onValueChangeRef.current = onValueChange
  const onValueCommitRef = useRef(onValueCommit)
  onValueCommitRef.current = onValueCommit

  const setValue = useCallback(
    (next: number) => {
      const quantized = quantizeSliderValue(next, min, max, step)
      if (quantized === valueRef.current) return
      valueRef.current = quantized
      if (!isControlled) setUncontrolledValue(quantized)
      onValueChangeRef.current?.(quantized)
    },
    [isControlled, min, max, step],
  )

  /**
   * Pointer x to value, in the root's box. The thumb's centre travels from
   * `thumb/2` to `width - thumb/2` (see `SliderThumb`), so the mapping starts
   * at that same inset: a press on the thumb's centre reads back the value
   * that put it there, and a press at either end still reaches `min`/`max`.
   */
  const valueAtPointer = useCallback(
    (clientX: number): number => {
      const root = rootRef.current
      if (!root) return valueRef.current
      const rect = root.getBoundingClientRect()
      const thumbWidth =
        thumbRef.current?.getBoundingClientRect().width ?? 0
      const travel = rect.width - thumbWidth
      if (travel <= 0) return valueRef.current
      const fill = (clientX - rect.left - thumbWidth / 2) / travel
      return min + Math.min(1, Math.max(0, fill)) * (max - min)
    },
    [min, max],
  )

  const capture = useGestureCapture({
    priority: GesturePriority.Slider,
    blocksScroll: true,
    enabled: !isDisabled,
    //pre-empted by a higher-priority gesture: end the drag so the control is not
    //left in `data-dragging` with no pointer to finish it
    onLost: () => endDragRef.current(),
  })
  const captureRef = useRef(capture)
  captureRef.current = capture

  const endDrag = useCallback(() => {
    const tracking = pointerRef.current
    pointerRef.current = null
    if (!tracking?.dragging) return
    const root = rootRef.current
    if (root?.hasPointerCapture?.(tracking.id)) {
      root.releasePointerCapture?.(tracking.id)
    }
    captureRef.current.release()
    setIsDragging(false)
    onValueCommitRef.current?.(valueRef.current)
  }, [])
  const endDragRef = useRef(endDrag)
  endDragRef.current = endDrag

  /** Claim the pointer (arbiter first) and start owning the value. */
  const beginDrag = useCallback(
    (tracking: PointerTracking, clientX: number): boolean => {
      if (!captureRef.current.request()) return false
      rootRef.current?.setPointerCapture?.(tracking.id)
      tracking.dragging = true
      setIsDragging(true)
      inputRef.current?.focus({ preventScroll: true })
      setValue(valueAtPointer(clientX))
      return true
    },
    [setValue, valueAtPointer],
  )

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (isDisabled || e.button !== 0 || !e.isPrimary) return
    if (pointerRef.current) return
    const tracking: PointerTracking = {
      id: e.pointerId,
      type: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      dragging: false,
    }
    pointerRef.current = tracking
    //a touch has to say which axis it means first (quirk 2); a mouse or pen
    //cannot be scrolling, so the press IS the set
    if (e.pointerType === "touch") return
    //no text selection from a mouse drag across the labels around the control
    e.preventDefault()
    if (!beginDrag(tracking, e.clientX)) pointerRef.current = null
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const tracking = pointerRef.current
    if (!tracking || tracking.id !== e.pointerId) return
    if (tracking.dragging) {
      setValue(valueAtPointer(e.clientX))
      return
    }
    const dx = Math.abs(e.clientX - tracking.startX)
    const dy = Math.abs(e.clientY - tracking.startY)
    if (dy > dx && dy > SLIDER_LOCK_SLOP_PX) {
      //a scroll, not a set: hand the finger back and touch nothing
      pointerRef.current = null
      return
    }
    if (dx > dy && dx > SLIDER_LOCK_SLOP_PX) {
      if (!beginDrag(tracking, e.clientX)) pointerRef.current = null
    }
  }

  /**
   * A touch that lifted where it landed. The press could not set the value
   * (the finger might have been about to scroll), so the lift does, once, and
   * commits: one tap is one `onValueChange` and one `onValueCommit`, the same
   * shape a mouse press-and-release has. Through the arbiter like a drag, so a
   * tap under a live drawer or edge swipe stays theirs; a tap holds nothing,
   * so the claim is released at once.
   */
  const tapAt = useCallback(
    (clientX: number) => {
      if (!captureRef.current.request()) return
      captureRef.current.release()
      inputRef.current?.focus({ preventScroll: true })
      setValue(valueAtPointer(clientX))
      onValueCommitRef.current?.(valueRef.current)
    },
    [setValue, valueAtPointer],
  )

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    const tracking = pointerRef.current
    if (!tracking || tracking.id !== e.pointerId) return
    if (!tracking.dragging) {
      //a finger that never chose an axis is a tap, unless the platform took it:
      //a pointercancel is the browser starting its own scroll, never a set
      pointerRef.current = null
      if (e.type === "pointerup") tapAt(e.clientX)
      return
    }
    endDrag()
  }

  //a component unmounting mid-drag must not leave the arbiter held; the hook
  //releases on disable, this only clears the local bookkeeping
  useEffect(
    () => () => {
      pointerRef.current = null
    },
    [],
  )

  /* ---- keyboard: the native input is focused, adaptv does the stepping ------ */

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (isDisabled) return
    const current = valueRef.current
    let next: number | null = null
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = current + step
        break
      case "ArrowLeft":
      case "ArrowDown":
        next = current - step
        break
      case "PageUp":
        next = current + step * 10
        break
      case "PageDown":
        next = current - step * 10
        break
      case "Home":
        next = min
        break
      case "End":
        next = max
        break
      default:
        return
    }
    //the browser would step the input itself and write the float it computed
    //into `value`; taking the key keeps every reported number on the grid
    e.preventDefault()
    keyboardDirtyRef.current = true
    setValue(next)
  }

  const onInputKeyUp = () => {
    //a held key repeats keydown many times and releases once: one commit
    if (!keyboardDirtyRef.current) return
    keyboardDirtyRef.current = false
    onValueCommitRef.current?.(valueRef.current)
  }

  //a screen reader adjusting the range input drives the native value with no
  //key events at all; each such change is discrete, so it commits at once
  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (isDisabled) return
    const next = Number.parseFloat(e.target.value)
    if (!Number.isFinite(next)) return
    setValue(next)
    onValueCommitRef.current?.(valueRef.current)
  }

  /* ---- render ---------------------------------------------------------------- */

  const percent = percentOf(value, min, max)
  const context: SliderContextValue = {
    value,
    min,
    max,
    step,
    percent,
    isDragging,
    isDisabled,
  }

  const root = mergeStyles({
    className,
    style,
    lockedStyle: {
      ...(isDisabled
        ? SLIDER_ROOT_DISABLED_LOCKED_STYLE
        : SLIDER_ROOT_LOCKED_STYLE),
      [SLIDER_FILL_VAR]: String(percent),
    } as CSSProperties,
  })

  return (
    <SliderContext.Provider value={context}>
      <SliderInternalsContext.Provider value={{ thumbRef }}>
        <div
          ref={rootRef}
          data-adaptv="slider"
          data-part="root"
          data-orientation="horizontal"
          data-dragging={isDragging ? "" : undefined}
          data-disabled={isDisabled ? "" : undefined}
          className={root.className || undefined}
          style={root.style}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <input
            ref={inputRef}
            id={inputId}
            type="range"
            name={name}
            min={min}
            max={max}
            step={step}
            value={value}
            disabled={isDisabled}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            onKeyDown={onInputKeyDown}
            onKeyUp={onInputKeyUp}
            onChange={onInputChange}
            data-adaptv="slider"
            data-part="input"
            style={SLIDER_INPUT_LOCKED_STYLE}
          />
          {children ?? (
            <>
              <SliderTrack>
                <SliderRange />
              </SliderTrack>
              <SliderThumb />
            </>
          )}
        </div>
      </SliderInternalsContext.Provider>
    </SliderContext.Provider>
  )
}

SliderRoot.displayName = "Slider"

const Slider = Object.assign(SliderRoot, {
  Track: SliderTrack,
  Range: SliderRange,
  Thumb: SliderThumb,
})

export { Slider }

import type {
  ChangeEvent,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  MouseEvent,
  PointerEvent,
  ReactElement,
  ReactNode,
} from "react"
import {
  Children,
  createContext,
  forwardRef,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import {
  PRESS_TARGET_DISABLED_LOCKED_CLASS,
  PRESS_TARGET_LOCKED_CLASS,
} from "#adaptv/components/press-core"
import { useGestureEngine } from "#adaptv/hooks/use-gesture-engine"
import { dynamicValues } from "#adaptv/utils/dynamic-values"
import { mergeStyles } from "#adaptv/utils/styles"

/**
 * Imperative API for {@link RadioGroup}. Attach with `ref`.
 *
 * | Member | Description |
 * |--------|-------------|
 * | `value` | Live selected value, `null` when nothing is selected (readonly) |
 * | `disabled` | Live group-level disabled state (readonly) |
 * | `focus()` | Focus the selected radio, or the first enabled one — where Tab lands |
 */
export type RadioGroupHandle = {
  readonly value: string | null
  readonly disabled: boolean
  focus: () => void
}

/**
 * Imperative API for `RadioGroup.Item`. Attach with `ref`.
 *
 * | Member | Description |
 * |--------|-------------|
 * | `checked` | Live checked state (readonly) |
 * | `disabled` | Live disabled state, the group's included (readonly) |
 * | `focus()` | Focus the underlying `<input type="radio">` |
 */
export type RadioGroupItemHandle = {
  readonly checked: boolean
  readonly disabled: boolean
  focus: () => void
}

/** Group state from {@link useRadioGroup}. */
export type RadioGroupContextValue = {
  /** The selected value, `null` when nothing is selected. */
  value: string | null
  /** The `name` every radio in the group carries — the consumer's, or a per-instance id. */
  name: string
  isDisabled: boolean
  isRequired: boolean
  /** Tailwind spacing index passed to the root `size` prop. */
  size: number
}

/** Per-item state from {@link useRadioGroupItem} for Tier 2 branch paint. */
export type RadioGroupItemContextValue = {
  value: string
  isChecked: boolean
  /** The item's own `disabled` OR the group's. */
  isDisabled: boolean
  /** Tailwind spacing index passed to the root `size` prop. */
  size: number
}

/**
 * Props for the root {@link RadioGroup}.
 *
 * Controlled: `value` + `onValueChange` (`value={null}` is controlled with nothing
 * selected). Uncontrolled: `defaultValue`. Name the group with `aria-label` or
 * `aria-labelledby`.
 */
export interface RadioGroupProps
  extends Omit<
    HTMLAttributes<HTMLDivElement>,
    | "role"
    | "defaultValue"
    | "onChange"
    | "className"
    | "style"
    | "children"
  > {
  /** Controlled selected value; `null` selects nothing. */
  value?: string | null
  /** Initial selected value when uncontrolled. */
  defaultValue?: string | null
  /** Fired once per selection the user makes; receives the item's value. */
  onValueChange?: (value: string) => void
  /**
   * The radios' `name`, and the key their value is submitted under in a form.
   *
   * Omit it and each instance gets its own id-derived name. A radio group is keyed
   * on `name` within one document (or one form), so two mounted groups sharing a
   * literal name are ONE group to the browser: selecting in one clears the other.
   * An explicit `name` is for form submission, and giving two instances the same
   * one is choosing that behaviour.
   */
  name?: string
  /** Disables every item: none can be selected, focused, or submitted. */
  disabled?: boolean
  /** Constraint validation: the form will not submit until an item is selected. */
  required?: boolean
  /** The `id` of a `<form>` elsewhere in the document the radios belong to. */
  form?: string
  /**
   * Exposed as `aria-orientation` and used for the default flex direction. Arrow
   * keys move the selection in BOTH axes whatever this says — that is the native
   * radio behaviour, and the group does not override it.
   * @default "vertical"
   */
  orientation?: "horizontal" | "vertical"
  /** Tailwind spacing index for every item's box: edge = size × 0.25rem. */
  size?: number
  /** Tier 2 utilities merged after the neutral layout on the group element. */
  className?: string
  style?: CSSProperties
  /** `RadioGroup.Item` elements, with any markup between them. */
  children?: ReactNode
}

/**
 * Props for `RadioGroup.Item`. Forwards native input props (`aria-*`, `id`,
 * `autoFocus`, pointer and key handlers…) to the real `<input type="radio">`.
 */
export interface RadioGroupItemProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    | "type"
    | "name"
    | "value"
    | "checked"
    | "defaultChecked"
    | "onChange"
    | "required"
    | "form"
    | "size"
    | "className"
    | "style"
    | "children"
  > {
  /** The value this item selects, and submits. */
  value: string
  /** Disables this item; the group's `disabled` disables it too. */
  disabled?: boolean
  /** Tier 2 utilities on the item's `<label>` — the whole hit area. */
  className?: string
  style?: CSSProperties
  /**
   * The item's content. A default `RadioGroup.Box` is placed before it unless the
   * children contain their own `RadioGroup.Box`.
   */
  children?: ReactNode
}

/** Props for `RadioGroup.Box`, the painted circle. */
export interface RadioGroupBoxProps {
  /** Tier 2 shape, ring and fill utilities. */
  className?: string
  style?: CSSProperties
  /** Omit for the default `RadioGroup.Indicator`. */
  children?: ReactNode
}

/** Props for `RadioGroup.Indicator`, the selected mark inside the box. */
export interface RadioGroupIndicatorProps {
  /** Tier 2 mark colour and motion utilities. */
  className?: string
  /** Custom mark; omit for the neutral dot. */
  children?: ReactNode
}

const RADIO_GROUP_ROOT_BASE_CLASS = "flex gap-2"
const RADIO_GROUP_ROOT_VERTICAL_CLASS = "flex-col"
const RADIO_GROUP_ROOT_HORIZONTAL_CLASS = "flex-row flex-wrap"

const RADIO_ITEM_BASE_LAYOUT_CLASS = "inline-flex items-center gap-2"
//BASE: the keyboard focus ring. The native input is `opacity-0`, so the patches.css
//`:focus-visible` outline it would draw is invisible; the label draws it instead,
//in the same colour chain (`--adaptv-ring`, then `currentColor`).
const RADIO_ITEM_FOCUS_RING_CLASS =
  "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--adaptv-ring,currentColor)]"
//LOCKED: the input is laid over the whole label, so the label is its containing
//block; a consumer `static` here would send the input to the nearest positioned
//ancestor and make the radio's accessible frame some other element's box.
const RADIO_ITEM_LOCKED_LAYOUT_CLASS = "relative"
//LOCKED (touch) and BASE (cursor) are separate tiers — press-core explains why
const RADIO_ITEM_INTERACTION_CLASS = PRESS_TARGET_LOCKED_CLASS
const RADIO_ITEM_CURSOR_CLASS = "cursor-pointer"
const RADIO_ITEM_NON_INTERACTION_CLASS = PRESS_TARGET_DISABLED_LOCKED_CLASS
const RADIO_ITEM_DISABLED_CURSOR_CLASS = "cursor-not-allowed"
//LOCKED: the input is the ONLY element assistive tech and automation see, so its
//box is the radio's frame to VoiceOver, TalkBack and every tap aimed at it. A
//clipped `sr-only` input is a speck: on the iOS 18.0 and 26.1 simulators the
//sibling Switch read ~1×2 pt and a tap at its centre did nothing (PR #132 measured
//it; this is the same fix). Covering the label exactly, invisibly, makes the
//accessible frame and the hit area one rectangle. It is rendered LAST so it paints
//over the positioned box by order, with no z-index to lift it over overlays.
const RADIO_ITEM_INPUT_LOCKED_CLASS =
  "absolute inset-0 m-0 size-full cursor-[inherit] appearance-none opacity-0"
//LOCKED: the box is the positioning and clipping context for the mark, and
//`shrink-0` keeps the circle round inside a flex label.
const RADIO_BOX_LOCKED_LAYOUT_CLASS =
  "relative flex shrink-0 items-center justify-center overflow-hidden"
//BASE: under forced colors the background is replaced by Canvas and a fill-only
//box vanishes, so it gets an outline there, which the UA paints in a system colour
//(`outline-1` carries the solid style with it).
const RADIO_BOX_SURFACE_CLASS =
  "rounded-full bg-gray-50 forced-colors:outline-1 forced-colors:-outline-offset-1"
//LOCKED: the mark sits over the box; if it took pointer events a tap on it would
//land on the mark instead of the input laid over the item.
const RADIO_INDICATOR_LOCKED_LAYOUT_CLASS = "pointer-events-none"

//How long after a release its click may still arrive: iOS holds a tap's click for
//its double-tap wait (~350 ms); everything else fires it with the release.
const PRESS_CLICK_WINDOW_MS = 1000

const RadioGroupContext = createContext<
  | (RadioGroupContextValue & {
      form: string | undefined
      /** What a form reset restores: `defaultValue`, or the owner's `value`. */
      resetValue: string | null
      select: (value: string) => void
    })
  | null
>(null)
const RadioGroupItemContext =
  createContext<RadioGroupItemContextValue | null>(null)

/** Group state inside a {@link RadioGroup}: the selected value, name, and flags. */
export function useRadioGroup(): RadioGroupContextValue {
  const ctx = useContext(RadioGroupContext)
  if (!ctx) {
    throw new Error("useRadioGroup must be used within <RadioGroup>.")
  }
  const { value, name, isDisabled, isRequired, size } = ctx
  return { value, name, isDisabled, isRequired, size }
}

/**
 * Reactive state of one `RadioGroup.Item`. Use in Tier 2 `RadioGroup.Box` /
 * `RadioGroup.Indicator` wrappers — branch with `isChecked` / `isDisabled`, not
 * `has-[:checked]:` or `group-*` selectors.
 */
export function useRadioGroupItem(): RadioGroupItemContextValue {
  const ctx = useContext(RadioGroupItemContext)
  if (!ctx) {
    throw new Error(
      "useRadioGroupItem must be used within <RadioGroup.Item>.",
    )
  }
  return ctx
}

/* =============================================================================
 * LAYOUT
 * ============================================================================= */

function radioLayout(size: number) {
  return dynamicValues({
    size,
    derive: ({ edgeRem }) => ({
      boxRem: edgeRem,
      indicatorRem: edgeRem * 0.5,
    }),
  })
}

function isRadioBoxElement(
  child: ReactNode,
): child is ReactElement<RadioGroupBoxProps> {
  if (!isValidElement(child)) return false
  if (child.type === RadioGroupBox) return true
  const type = child.type
  if (typeof type === "function" || typeof type === "object")
    return (
      (type as { displayName?: string }).displayName === "RadioGroup.Box"
    )
  return false
}

/**
 * The painted circle. Rendered by default before the item's content; place your
 * own `<RadioGroup.Box className="…">` among the children to restyle or move it.
 */
function RadioGroupBox({
  className,
  style,
  children,
}: RadioGroupBoxProps) {
  const { size } = useRadioGroupItem()
  const { boxRem } = radioLayout(size)
  //the edge is `lockedStyle` for Checkbox.Box's reason: the mark is derived from
  //the SAME `size`, so an inline width would resize the circle and not the dot
  const { className: boxClassName, style: boxStyle } = mergeStyles({
    base: RADIO_BOX_SURFACE_CLASS,
    className,
    locked: RADIO_BOX_LOCKED_LAYOUT_CLASS,
    style,
    lockedStyle: { width: `${boxRem}rem`, height: `${boxRem}rem` },
  })

  return (
    <span data-part="box" style={boxStyle} className={boxClassName}>
      {children ?? <RadioGroupIndicator />}
    </span>
  )
}

RadioGroupBox.displayName = "RadioGroup.Box"

/**
 * The selected mark, centred in `RadioGroup.Box`. A `currentColor` dot by default,
 * so it keeps painting under forced colors.
 */
function RadioGroupIndicator({
  className,
  children,
}: RadioGroupIndicatorProps) {
  const { isChecked, size } = useRadioGroupItem()
  const { indicatorRem } = radioLayout(size)
  //opacity IS the mark's visibility, so it is locked with the size: a consumer who
  //pins it to 1 would draw a dot on an unselected item. Branch with the hook.
  const { className: markClassName, style: markStyle } = mergeStyles({
    base: undefined,
    className,
    locked: RADIO_INDICATOR_LOCKED_LAYOUT_CLASS,
    lockedStyle: {
      width: `${indicatorRem}rem`,
      height: `${indicatorRem}rem`,
      opacity: isChecked ? 1 : 0,
    },
  })

  if (children) {
    return (
      <span
        data-part="indicator"
        style={markStyle}
        className={markClassName}
      >
        {children}
      </span>
    )
  }

  return (
    <svg
      data-part="indicator"
      aria-hidden
      style={markStyle}
      className={markClassName}
      viewBox="0 0 16 16"
    >
      <title>Selected</title>
      <circle cx="8" cy="8" r="8" fill="currentColor" />
    </svg>
  )
}

RadioGroupIndicator.displayName = "RadioGroup.Indicator"

/* =============================================================================
 * ITEM
 *
 * A `<label>` holding the painted box, the consumer's content, and — last, laid
 * over all of it — the native `<input type="radio">`.
 *
 * Selection is the NATIVE radio's `change` event, not the gesture engine's release.
 * Checkbox and Switch let the engine activate on release and swallow every native
 * click, because a second activation of a toggle inverts it. A radio's is
 * idempotent: the browser fires `change` only when an input BECOMES checked. And
 * every path that is not a pointer press on this label arrives as a click no press
 * produced — the arrow keys (the browser checks the next radio and fires a click on
 * it), Space, a VoiceOver or TalkBack activation, an outer `<label>` forwarding its
 * click, `element.click()`. Swallowing those, as the engine does by default, would
 * break arrow-key selection outright. So the engine keeps what it is for here — the
 * press visual, the `touch-action` longhand, and the veto of a press that was
 * dragged off or cancelled — and the browser decides selection.
 * ============================================================================= */

const RadioGroupItem = forwardRef<
  RadioGroupItemHandle,
  RadioGroupItemProps
>(function RadioGroupItem(
  {
    value,
    disabled,
    className,
    style,
    children,
    id: idProp,
    ...inputProps
  },
  ref,
) {
  const group = useContext(RadioGroupContext)
  if (!group) {
    throw new Error("RadioGroup.Item must be used within <RadioGroup>.")
  }
  const inputId = useId()
  const resolvedInputId = idProp ?? inputId
  const isChecked = group.value === value
  const isDisabled = group.isDisabled || Boolean(disabled)
  const inputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(
    ref,
    () => ({
      get checked() {
        return inputRef.current?.checked ?? isChecked
      },
      get disabled() {
        return inputRef.current?.disabled ?? isDisabled
      },
      focus: () => {
        inputRef.current?.focus()
      },
    }),
    [isChecked, isDisabled],
  )

  const engine = useGestureEngine({ disabled: isDisabled })

  //Whether the click now arriving was produced by a pointer press on this label.
  //Only such a click may be vetoed by the engine (a press dragged off the item
  //and released, whose trailing click must not select). Every other click — the
  //arrow keys, Space, assistive tech, a forwarding label, `.click()` — is left
  //alone so the browser selects. `detail` is 0 for all of those, and the flag
  //covers a stale veto: a cancelled press arms the engine and no click follows,
  //so without it the NEXT arrow-key selection of this item would be swallowed.
  const pressOwnsClick = useRef(false)
  //When this item's last press was released. A press dragged off the item and
  //released fires NO click on iOS, so the flag above (and the engine's veto) stay
  //armed with nothing to consume them; a later click that carries a click count
  //but no pointerdown here (an assistive-tech activation, a forwarded label click)
  //would be swallowed once. The click a release produces follows it at once (on
  //iOS within the double-tap wait, ~350 ms), so a click past the window is not
  //that press's click and is never vetoed.
  const releasedAt = useRef(Number.NEGATIVE_INFINITY)

  //A form reset restores each radio's `checked` ATTRIBUTE, which React writes only
  //on mount. Keep it on the item the reset should restore, so the DOM after a reset
  //is the group's reset value, never the mount-time selection.
  const isResetTarget = group.resetValue === value
  useEffect(() => {
    if (inputRef.current) inputRef.current.defaultChecked = isResetTarget
  }, [isResetTarget])

  const itemContext: RadioGroupItemContextValue = {
    value,
    isChecked,
    isDisabled,
    size: group.size,
  }

  const content = Children.toArray(children).some(isRadioBoxElement) ? (
    children
  ) : (
    <>
      <RadioGroupBox />
      {children}
    </>
  )

  return (
    <RadioGroupItemContext.Provider value={itemContext}>
      <label
        data-part="item"
        data-checked={isChecked ? "" : undefined}
        data-disabled={isDisabled ? "" : undefined}
        htmlFor={resolvedInputId}
        {...mergeStyles({
          base: [
            RADIO_ITEM_BASE_LAYOUT_CLASS,
            RADIO_ITEM_FOCUS_RING_CLASS,
            isDisabled
              ? RADIO_ITEM_DISABLED_CURSOR_CLASS
              : RADIO_ITEM_CURSOR_CLASS,
          ],
          className,
          locked: [
            RADIO_ITEM_LOCKED_LAYOUT_CLASS,
            isDisabled
              ? RADIO_ITEM_NON_INTERACTION_CLASS
              : RADIO_ITEM_INTERACTION_CLASS,
          ],
          style,
          //the geometry lives on the box; nothing about the label is inline
          lockedStyle: undefined,
        })}
        data-press-engine={engine["data-press-engine"]}
        onPointerDown={(e: PointerEvent<HTMLLabelElement>) => {
          pressOwnsClick.current =
            !isDisabled && e.button === 0 && e.isPrimary
          engine.onPointerDown(e)
        }}
        onPointerMove={engine.onPointerMove}
        onPointerUp={(e: PointerEvent<HTMLLabelElement>) => {
          releasedAt.current = performance.now()
          engine.onPointerUp(e)
        }}
        onPointerCancel={(e: PointerEvent<HTMLLabelElement>) => {
          //no click follows a cancel, so this press owns none
          pressOwnsClick.current = false
          engine.onPointerCancel(e)
        }}
        onLostPointerCapture={engine.onLostPointerCapture}
        onKeyDown={engine.onKeyDown}
        onKeyUp={engine.onKeyUp}
        onClickCapture={(e: MouseEvent<HTMLLabelElement>) => {
          const owned =
            pressOwnsClick.current &&
            e.detail !== 0 &&
            performance.now() - releasedAt.current <= PRESS_CLICK_WINDOW_MS
          pressOwnsClick.current = false
          if (owned) engine.onClickCapture(e)
        }}
        //no `engine.onClick`: it swallows every click, and selection IS the click
      >
        {content}
        <input
          {...inputProps}
          ref={inputRef}
          id={resolvedInputId}
          type="radio"
          name={group.name}
          value={value}
          form={group.form}
          checked={isChecked}
          disabled={isDisabled}
          required={group.isRequired}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            if (e.currentTarget.checked) group.select(value)
          }}
          className={RADIO_ITEM_INPUT_LOCKED_CLASS}
        />
      </label>
    </RadioGroupItemContext.Provider>
  )
})

RadioGroupItem.displayName = "RadioGroup.Item"

/* =============================================================================
 * ROOT
 * ============================================================================= */

/**
 * RadioGroup: one choice out of several, on native `<input type="radio">`s.
 *
 * The group is a `role="radiogroup"` element; each `RadioGroup.Item` is a label
 * whose native radio lies invisibly over the whole item, so its accessible frame
 * is the item. Arrow keys, Tab, Space, form submission, `required` and disabled
 * items are the browser's own radio behaviour — nothing is re-implemented.
 *
 * **Tier 2 brand paint** — item `className` for the row; branch inside
 * `RadioGroup.Box` / `RadioGroup.Indicator` with {@link useRadioGroupItem}. The
 * group carries `data-adaptv="radio-group" data-part="root"`; every item carries
 * `data-part="item"`, plus `data-checked` and `data-disabled` while they hold, so
 * `[data-adaptv="radio-group"]` matches the group alone.
 *
 * @example
 * ```tsx
 * const [plan, setPlan] = useState("monthly")
 *
 * <RadioGroup aria-label="Plan" value={plan} onValueChange={setPlan}>
 *   <RadioGroup.Item value="monthly">Monthly</RadioGroup.Item>
 *   <RadioGroup.Item value="yearly">Yearly</RadioGroup.Item>
 * </RadioGroup>
 * ```
 */
const RadioGroup = forwardRef<RadioGroupHandle, RadioGroupProps>(
  function RadioGroup(
    {
      value: controlledValue,
      defaultValue = null,
      onValueChange,
      name: nameProp,
      disabled,
      required,
      form,
      orientation = "vertical",
      size = 6,
      className,
      style,
      children,
      ...rootProps
    },
    ref,
  ) {
    //one name per mounted instance: a literal default would make every RadioGroup
    //on the page one browser radio group
    const instanceName = useId()
    const name = nameProp ?? instanceName
    const isControlled = controlledValue !== undefined
    const [uncontrolledValue, setUncontrolledValue] = useState<
      string | null
    >(defaultValue)
    const value = isControlled ? controlledValue : uncontrolledValue
    const isDisabled = Boolean(disabled)
    const isRequired = Boolean(required)
    const rootRef = useRef<HTMLDivElement>(null)

    //A reset of the form that owns the radios (an ancestor, or the one `form`
    //names) puts the DOM back on the reset value but fires no `change`, so an
    //uncontrolled group would keep painting and reporting the last choice while
    //FormData submits another. Follow the reset: once the browser has run it (the
    //event is cancelable and fires before the controls reset, so read the DOM a
    //task later), take the selection from the radios. A controlled group needs no
    //listener: its reset value is its `value`, so the DOM does not move.
    useEffect(() => {
      const root = rootRef.current
      if (isControlled || !root) return
      const doc = root.ownerDocument
      let timer: ReturnType<typeof setTimeout> | undefined
      const onReset = (event: Event) => {
        const owner =
          root.querySelector<HTMLInputElement>('input[type="radio"]')?.form
        if (!owner || event.target !== owner) return
        clearTimeout(timer)
        timer = setTimeout(() => {
          if (event.defaultPrevented) return
          const checked = root.querySelector<HTMLInputElement>(
            'input[type="radio"]:checked',
          )
          setUncontrolledValue(checked ? checked.value : null)
        }, 0)
      }
      //capture on the document: `reset` does not bubble in the spec, and the form
      //may be anywhere in the document when `form` names it
      doc.addEventListener("reset", onReset, true)
      return () => {
        clearTimeout(timer)
        doc.removeEventListener("reset", onReset, true)
      }
    }, [isControlled])

    useImperativeHandle(
      ref,
      () => ({
        get value() {
          return value
        },
        get disabled() {
          return isDisabled
        },
        focus: () => {
          const root = rootRef.current
          if (!root) return
          const target =
            root.querySelector<HTMLInputElement>(
              'input[type="radio"]:checked:not(:disabled)',
            ) ??
            root.querySelector<HTMLInputElement>(
              'input[type="radio"]:not(:disabled)',
            )
          target?.focus()
        },
      }),
      [value, isDisabled],
    )

    const select = useCallback(
      (next: string) => {
        if (isDisabled) return
        if (!isControlled) setUncontrolledValue(next)
        onValueChange?.(next)
      },
      [isControlled, isDisabled, onValueChange],
    )

    return (
      <RadioGroupContext.Provider
        value={{
          value,
          name,
          isDisabled,
          isRequired,
          size,
          form,
          resetValue: isControlled ? controlledValue : defaultValue,
          select,
        }}
      >
        <div
          {...rootProps}
          ref={rootRef}
          role="radiogroup"
          aria-orientation={orientation}
          aria-required={isRequired || undefined}
          aria-disabled={isDisabled || undefined}
          data-adaptv="radio-group"
          data-part="root"
          data-disabled={isDisabled ? "" : undefined}
          {...mergeStyles({
            base: [
              RADIO_GROUP_ROOT_BASE_CLASS,
              orientation === "horizontal"
                ? RADIO_GROUP_ROOT_HORIZONTAL_CLASS
                : RADIO_GROUP_ROOT_VERTICAL_CLASS,
            ],
            className,
            //the group positions nothing and clips nothing: its layout is a default
            locked: undefined,
            style,
            lockedStyle: undefined,
          })}
        >
          {children}
        </div>
      </RadioGroupContext.Provider>
    )
  },
)

RadioGroup.displayName = "RadioGroup"

const RadioGroupCompound = Object.assign(RadioGroup, {
  Item: RadioGroupItem,
  Box: RadioGroupBox,
  Indicator: RadioGroupIndicator,
})

export { RadioGroupCompound as RadioGroup }

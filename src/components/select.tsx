import type {
  ChangeEvent,
  CSSProperties,
  MouseEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  RefObject,
} from "react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
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
 * Select — a single-value picker that opens a menu on every target.
 *
 * The quirks this primitive owns, and the reason each part of it exists:
 *
 * 1. iOS renders `<select>` as a wheel (or a sheet), never as a menu, and merely
 *    focusing it scrolls the page and raises the Done bar. So the thing the user
 *    presses is a painted trigger and the thing that opens is an anchored listbox,
 *    on every target alike. A REAL `<select>` stays mounted underneath — visually
 *    hidden, `tabIndex={-1}`, `aria-hidden`, never focused — for the two jobs only
 *    a native control can do: it carries `name`/`required`/`disabled`/`value` into
 *    the form, and it is what browser autofill writes into. It mirrors the
 *    registered options as `<option>`s, and its `onChange` (autofill) feeds the
 *    value back.
 * 2. Hardware and gesture back must close the list, not navigate: the listbox
 *    registers on the back chain at `BackPriority.Transient`, exactly as Dropdown.
 * 3. The list is `position: fixed` and placed by `resolveDropdownPosition`, so it
 *    escapes any `overflow: hidden` ancestor and flips, caps its height and
 *    shifts to stay on screen; scroll/resize re-anchor it. On open the
 *    highlighted option is scrolled into view (`block: "nearest"`).
 * 4. Keyboard, on the trigger: ArrowDown/ArrowUp/Enter/Space open the list, and
 *    the arrows also seed the highlight (the selected option, else the first
 *    enabled one). In the list: ArrowDown/ArrowUp move the highlight over enabled
 *    options without wrapping, Home/End jump, Enter/Space pick the highlighted
 *    option and close, Escape closes without changing the value, Tab closes; the
 *    keyboard close paths return focus to the trigger. Printable keys accumulate
 *    for 500ms and move the highlight to the next option (from the highlight,
 *    wrapping) whose label starts with the buffer, case-insensitively.
 * 5. Options sit inside the panel's own scroller, so each one carries the
 *    press-core `touch-action` longhand LOCKED (never `touch-manipulation`, never
 *    `touch-none` — WebKit 240917) like `Dropdown.Item`, and `pointermove` over
 *    an option highlights it.
 *
 * Dropdown's ENGINE is reused (the position resolver, the back chain, the
 * insets, the press-core locks, the locked panel structure) but not Dropdown
 * itself: a menu has no value, no selected row, no highlight and no form
 * presence, and bolting those onto `role="menu"` would leave the consumer with
 * the wrong ARIA on every element.
 *
 * Options register `{ value, label, disabled }` with the root when they mount
 * (a layout effect, so the trigger shows the selected label before first paint on
 * the client; a server render shows the placeholder until hydration). Because
 * `Select.Content` keeps its children rendered while closed — the listbox panel
 * is what comes and goes — the registry, the trigger label and the native
 * `<option>`s are there whether the list is open or not. Registration order is
 * mount order, which is DOM order for a static list; there is deliberately no
 * MutationObserver.
 * ============================================================================= */

type SelectOptionRecord = {
  id: string
  value: string
  label: string
  disabled: boolean
}

/** What {@link useSelect} returns. */
export type SelectContextValue = {
  /** The selected value, `undefined` while the placeholder shows. */
  value: string | undefined
  open: boolean
  disabled: boolean
}

type SelectInternalContextValue = SelectContextValue & {
  required: boolean
  placeholder: string | undefined
  placement: DropdownPlacement
  listboxId: string
  rootAriaLabel: string | undefined
  options: SelectOptionRecord[]
  selected: SelectOptionRecord | undefined
  highlighted: string | undefined
  setHighlighted: (value: string | undefined) => void
  /**
   * True while the highlight was last moved by a key or typeahead: the content
   * then scrolls that row into view. A pointer highlight leaves it false — the
   * row is under the pointer already, and scrolling it would slide the next row
   * under the pointer and highlight that one too.
   */
  highlightByKeyboard: RefObject<boolean>
  upsertOption: (record: SelectOptionRecord) => void
  removeOption: (id: string) => void
  triggerRef: RefObject<HTMLButtonElement | null>
  /** Open with the highlight seeded; `seedFirst` falls back to the first enabled option. */
  openList: (seedFirst: boolean) => void
  /** Close, and return focus to the trigger when asked. */
  closeList: (refocus: boolean) => void
  /** Commit a value (fires `onValueChange` only on change), close, refocus. */
  pick: (value: string) => void
  onListKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void
}

const SelectContext = createContext<SelectInternalContextValue | null>(
  null,
)

function useSelectContext(): SelectInternalContextValue {
  const ctx = useContext(SelectContext)
  if (!ctx) throw new Error("Select parts must be used within <Select>.")
  return ctx
}

/**
 * Reactive state for {@link Select} compound trees: `{ value, open, disabled }`.
 * Throws outside a `<Select>`.
 */
export function useSelect(): SelectContextValue {
  const ctx = useContext(SelectContext)
  if (!ctx) throw new Error("useSelect must be used within <Select>.")
  return { value: ctx.value, open: ctx.open, disabled: ctx.disabled }
}

/** How long a typeahead buffer lives between keystrokes. */
const SELECT_TYPEAHEAD_MS = 500

//LOCKED structure, identical to Dropdown's panel and for the same reasons: the
//engine caps the height so the rows must scroll inside, it sits above app chrome,
//and a fling that reaches the end must not scroll the page behind it. Joined by the
//engine's placement below. The neutral menu surface is a default in select.css.
const SELECT_CONTENT_LOCKED_STYLE: CSSProperties = Object.freeze({
  zIndex: 50,
  overflowY: "auto",
  overscrollBehavior: "contain",
})
//LOCKED, same split as Dropdown.Item: `text-align: start` is structure (a row reads
//from the inline start), and beside it rides the press-target `touch-action`
//longhand because a row lives inside the panel's own scroller (quirk 5). The cursor
//is a default in select.css so `cursor-wait` on a pending row still wins.
const SELECT_OPTION_LOCKED_STYLE: CSSProperties = Object.freeze({
  ...PRESS_TARGET_LOCKED_STYLE,
  textAlign: "start",
})
const SELECT_OPTION_DISABLED_LOCKED_STYLE: CSSProperties = Object.freeze({
  ...PRESS_TARGET_DISABLED_LOCKED_STYLE,
  textAlign: "start",
})
//The native select is for the form and for autofill only (quirk 1): off-screen in
//the standard visually-hidden way, never focusable, never announced. Locked inline
//rather than a default: it is not a look, no consumer channel reaches the element,
//and a page that has not loaded adaptv's stylesheet must still not paint a second
//control.
const SELECT_NATIVE_LOCKED_STYLE: CSSProperties = Object.freeze({
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  borderWidth: 0,
})

/** An enabled option's index nearest `from` in `dir`, or `-1` when there is none. No wrap. */
function stepEnabled(
  options: SelectOptionRecord[],
  from: number,
  dir: 1 | -1,
): number {
  for (let i = from + dir; i >= 0 && i < options.length; i += dir) {
    if (!options[i]?.disabled) return i
  }
  return -1
}

/** The first (or last) enabled option's index, or `-1`. */
function edgeEnabled(
  options: SelectOptionRecord[],
  edge: "first" | "last",
): number {
  return edge === "first"
    ? stepEnabled(options, -1, 1)
    : stepEnabled(options, options.length, -1)
}

/** Typeahead: the next enabled option after `from` (wrapping) whose label starts with `query`. */
function findTypeahead(
  options: SelectOptionRecord[],
  from: number,
  query: string,
): number {
  const needle = query.toLowerCase()
  for (let step = 1; step <= options.length; step++) {
    const i = (from + step) % options.length
    const option = options[i]
    if (!option || option.disabled) continue
    if (option.label.toLowerCase().startsWith(needle)) return i
  }
  return -1
}

export type SelectProps = {
  children: ReactNode
  /** Controlled value (with {@link SelectProps.onValueChange}); `""` means none. */
  value?: string
  /** Uncontrolled initial value; omit for the placeholder. */
  defaultValue?: string
  /** Fires once per pick, and not when the already-selected value is picked again. */
  onValueChange?: (value: string) => void
  /** Forwarded to the native `<select>` so the form sees the value. */
  name?: string
  disabled?: boolean
  required?: boolean
  /** Shown by `Select.Value` while nothing is selected. */
  placeholder?: string
  /** Labels the trigger (unless the trigger sets its own) and the native select. */
  "aria-label"?: string
  className?: string
  style?: CSSProperties
  /** Preferred side + alignment; the engine flips/shifts from here. @default "bottom-start" */
  placement?: DropdownPlacement
}

/**
 * Single-value picker. Compose `Select.Trigger` (with `Select.Value`) and
 * `Select.Content` (with `Select.Option` children). Controlled via
 * `value`/`onValueChange`, or uncontrolled via `defaultValue`.
 */
function Select({
  children,
  value: controlledValue,
  defaultValue,
  onValueChange,
  name,
  disabled = false,
  required = false,
  placeholder,
  "aria-label": ariaLabel,
  className,
  style,
  placement = "bottom-start",
}: SelectProps) {
  const listboxId = useId()
  const [uncontrolled, setUncontrolled] = useState<string | undefined>(
    defaultValue === "" ? undefined : defaultValue,
  )
  const isControlled = controlledValue !== undefined
  const value = isControlled
    ? controlledValue === ""
      ? undefined
      : controlledValue
    : uncontrolled

  const [open, setOpenState] = useState(false)
  const [options, setOptions] = useState<SelectOptionRecord[]>([])
  const [highlighted, setHighlighted] = useState<string | undefined>(
    undefined,
  )
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const highlightByKeyboard = useRef(false)
  const typeahead = useRef<{
    buffer: string
    timer: ReturnType<typeof setTimeout> | null
  }>({ buffer: "", timer: null })

  const selected = options.find((o) => o.value === value)

  const upsertOption = useCallback((record: SelectOptionRecord) => {
    setOptions((prev) => {
      const i = prev.findIndex((o) => o.id === record.id)
      //update in place so a re-registered option keeps its DOM position
      if (i === -1) return [...prev, record]
      const next = prev.slice()
      next[i] = record
      return next
    })
  }, [])

  const removeOption = useCallback((id: string) => {
    setOptions((prev) => prev.filter((o) => o.id !== id))
  }, [])

  const commit = useCallback(
    (next: string | undefined) => {
      if (next === value) return
      if (!isControlled) setUncontrolled(next)
      onValueChange?.(next ?? "")
    },
    [isControlled, onValueChange, value],
  )

  const clearTypeahead = useCallback(() => {
    const t = typeahead.current
    if (t.timer) clearTimeout(t.timer)
    t.timer = null
    t.buffer = ""
  }, [])
  useEffect(() => clearTypeahead, [clearTypeahead])

  const openList = useCallback(
    (seedFirst: boolean) => {
      if (disabled) return
      const seed =
        selected && !selected.disabled
          ? selected.value
          : seedFirst
            ? options[edgeEnabled(options, "first")]?.value
            : undefined
      highlightByKeyboard.current = false
      setHighlighted(seed)
      setOpenState(true)
    },
    [disabled, options, selected],
  )

  const closeList = useCallback(
    (refocus: boolean) => {
      clearTypeahead()
      setOpenState(false)
      setHighlighted(undefined)
      if (refocus) triggerRef.current?.focus({ preventScroll: true })
    },
    [clearTypeahead],
  )

  //disabled underneath an open list: the trigger can no longer close it and
  //the rows must not pick, so the list goes with the flag, before paint
  useLayoutEffect(() => {
    if (disabled && open) closeList(false)
  }, [disabled, open, closeList])

  const pick = useCallback(
    (next: string) => {
      commit(next)
      closeList(true)
    },
    [commit, closeList],
  )

  const onListKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const current = options.findIndex((o) => o.value === highlighted)
      const moveTo = (index: number) => {
        event.preventDefault()
        if (index === -1) return
        highlightByKeyboard.current = true
        setHighlighted(options[index]?.value)
      }
      switch (event.key) {
        case "ArrowDown":
          return moveTo(
            current === -1
              ? edgeEnabled(options, "first")
              : stepEnabled(options, current, 1),
          )
        case "ArrowUp":
          return moveTo(
            current === -1
              ? edgeEnabled(options, "last")
              : stepEnabled(options, current, -1),
          )
        case "Home":
          return moveTo(edgeEnabled(options, "first"))
        case "End":
          return moveTo(edgeEnabled(options, "last"))
        case "Enter":
        case " ": {
          event.preventDefault()
          const target = options[current]
          if (target && !target.disabled) pick(target.value)
          else closeList(true)
          return
        }
        case "Tab":
          //no preventDefault: focus lands on the trigger now, and the browser's
          //own Tab then moves on from there, as if the list had never been open
          closeList(true)
          return
        default:
          break
      }
      //typeahead — a single printable character, no chord
      if (
        event.key.length !== 1 ||
        event.key === " " ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return
      event.preventDefault()
      const t = typeahead.current
      if (t.timer) clearTimeout(t.timer)
      t.buffer += event.key
      t.timer = setTimeout(() => {
        t.buffer = ""
        t.timer = null
      }, SELECT_TYPEAHEAD_MS)
      const hit = findTypeahead(options, current, t.buffer)
      if (hit === -1) return
      highlightByKeyboard.current = true
      setHighlighted(options[hit]?.value)
    },
    [options, highlighted, pick, closeList],
  )

  const onNativeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    //browser autofill is the only thing that reaches this handler (quirk 1)
    const next = event.target.value
    commit(next === "" ? undefined : next)
  }

  const isPlaceholder = selected === undefined

  //the root has a default look (select.css) and nothing locked; the consumer's
  //`style` still goes through the one place precedence is decided
  const rootStyles = mergeStyles({ className, style })

  return (
    <SelectContext.Provider
      value={{
        value,
        open,
        disabled,
        required,
        placeholder,
        placement,
        listboxId,
        rootAriaLabel: ariaLabel,
        options,
        selected,
        highlighted,
        setHighlighted,
        highlightByKeyboard,
        upsertOption,
        removeOption,
        triggerRef,
        openList,
        closeList,
        pick,
        onListKeyDown,
      }}
    >
      <div
        data-adaptv="select"
        data-part="root"
        data-select-open={open ? "" : undefined}
        data-disabled={disabled ? "" : undefined}
        data-placeholder={isPlaceholder ? "" : undefined}
        data-required={required ? "" : undefined}
        className={rootStyles.className || undefined}
        style={rootStyles.style}
      >
        {children}
        <select
          aria-hidden
          tabIndex={-1}
          name={name}
          required={required}
          disabled={disabled}
          value={value ?? ""}
          onChange={onNativeChange}
          aria-label={ariaLabel}
          data-adaptv="select-native"
          data-part="native"
          data-disabled={disabled ? "" : undefined}
          style={SELECT_NATIVE_LOCKED_STYLE}
        >
          {/* the placeholder option: it is what `required` validates against */}
          <option value="">{placeholder ?? ""}</option>
          {options.map((o) => (
            <option key={o.id} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </SelectContext.Provider>
  )
}
Select.displayName = "Select"

export type SelectTriggerProps = {
  /** Defaults to `<Select.Value />`. */
  children?: ReactNode
  className?: string
  "aria-label"?: string
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
}

/**
 * The painted control the user presses (quirk 1). A `<button role="combobox">`
 * that opens the listbox on click and on ArrowDown/ArrowUp/Enter/Space.
 */
function SelectTrigger({
  children,
  className,
  "aria-label": ariaLabel,
  onClick,
}: SelectTriggerProps) {
  const {
    open,
    disabled,
    selected,
    listboxId,
    rootAriaLabel,
    triggerRef,
    openList,
    closeList,
  } = useSelectContext()

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault()
        openList(true)
        return
      case "Enter":
      case " ":
        //preventDefault here cancels the button's own activation (it never
        //becomes :active, so no click follows on keyup), which is what keeps
        //this from opening and then immediately toggling closed
        event.preventDefault()
        openList(false)
        return
      default:
        return
    }
  }

  const triggerStyles = mergeStyles({
    className,
    lockedStyle: disabled
      ? PRESS_TARGET_DISABLED_LOCKED_STYLE
      : PRESS_TARGET_LOCKED_STYLE,
  })

  return (
    <button
      ref={triggerRef}
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listboxId}
      aria-label={ariaLabel ?? rootAriaLabel}
      disabled={disabled}
      data-adaptv="select-trigger"
      data-part="trigger"
      data-placeholder={selected === undefined ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      //the trigger is a press target inside whatever scroller the form lives in,
      //so its touch-action is locked inline for the reason press-core.ts gives; its
      //look and cursor are defaults in select.css
      className={triggerStyles.className || undefined}
      style={triggerStyles.style}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || disabled) return
        if (open) closeList(false)
        else openList(false)
      }}
      onKeyDown={onKeyDown}
    >
      {children ?? <SelectValue />}
    </button>
  )
}
SelectTrigger.displayName = "Select.Trigger"

export type SelectValueProps = {
  /** Overrides the root's `placeholder`. */
  placeholder?: string
  className?: string
}

/** The selected option's label, or the placeholder while nothing is selected. */
function SelectValue({ placeholder, className }: SelectValueProps) {
  const { selected, placeholder: rootPlaceholder } = useSelectContext()
  const isPlaceholder = selected === undefined
  return (
    <span
      data-adaptv="select-value"
      data-part="value"
      data-placeholder={isPlaceholder ? "" : undefined}
      //text: no default look, nothing locked
      className={mergeStyles({ className }) || undefined}
    >
      {isPlaceholder ? (placeholder ?? rootPlaceholder) : selected.label}
    </span>
  )
}
SelectValue.displayName = "Select.Value"

export type SelectContentProps = {
  children: ReactNode
  className?: string
  style?: CSSProperties
  "aria-label"?: string
}

/**
 * The anchored listbox (quirks 2 and 3). Its `Select.Option` children stay
 * rendered — and registered — while closed; the panel itself exists only while
 * open.
 */
function SelectContent({
  children,
  className,
  style,
  "aria-label": ariaLabel,
}: SelectContentProps) {
  const {
    open,
    placement,
    listboxId,
    rootAriaLabel,
    options,
    highlighted,
    highlightByKeyboard,
    triggerRef,
    closeList,
    onListKeyDown,
  } = useSelectContext()
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

  const positioned = pos !== null

  //once placed (a `visibility: hidden` node cannot take focus), focus the listbox
  //without scrolling the page to it, and bring the highlighted row into view
  useLayoutEffect(() => {
    if (!open || !positioned) return
    const content = contentRef.current
    if (!content) return
    content.focus({ preventScroll: true })
    content
      .querySelector<HTMLElement>("[data-highlighted]")
      ?.scrollIntoView({ block: "nearest" })
  }, [open, positioned])

  //a key moved the highlight: keep that row in view, nearest edge, so the
  //walk through a capped list never continues below the fold. A pointer
  //highlight is skipped on purpose (see `highlightByKeyboard`).
  useLayoutEffect(() => {
    if (!open || !positioned || highlighted === undefined) return
    if (!highlightByKeyboard.current) return
    highlightByKeyboard.current = false
    contentRef.current
      ?.querySelector<HTMLElement>("[data-highlighted]")
      ?.scrollIntoView({ block: "nearest" })
  }, [open, positioned, highlighted, highlightByKeyboard])

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
      () => closeList(false),
    )
  }, [open, closeList, triggerRef])

  //Escape dismisses without touching the value, refocuses the trigger, and does
  //not bubble to close anything behind it
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      closeList(true)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [open, closeList])

  //hardware/gesture back closes the list instead of navigating (quirk 2)
  useBackHandler(() => {
    if (!open) return false
    closeList(false)
    return true
  }, BackPriority.Transient)

  //closed: the options still mount (and register), the panel does not
  if (!open) return <>{children}</>

  const merged = mergeStyles({
    className,
    style,
    lockedStyle: {
      ...SELECT_CONTENT_LOCKED_STYLE,
      position: "fixed",
      left: pos?.left ?? 0,
      top: pos?.top ?? 0,
      maxHeight: pos?.maxHeight,
      maxWidth: pos?.maxWidth,
      //hidden for the single pre-measure frame so it never paints mis-placed
      visibility: positioned ? "visible" : "hidden",
    },
  })
  const active = options.find((o) => o.value === highlighted)

  return (
    <div
      ref={contentRef}
      id={listboxId}
      role="listbox"
      tabIndex={-1}
      aria-label={ariaLabel ?? rootAriaLabel}
      aria-activedescendant={active?.id}
      data-adaptv="select-content"
      data-part="content"
      data-side={pos?.side}
      data-align={pos?.align}
      className={merged.className || undefined}
      style={merged.style}
      onKeyDown={onListKeyDown}
    >
      {children}
    </div>
  )
}
SelectContent.displayName = "Select.Content"

export type SelectOptionProps = {
  value: string
  /** The label the trigger and typeahead use; defaults to string children, else `value`. */
  label?: string
  disabled?: boolean
  className?: string
  children?: ReactNode
}

/** One row of the listbox (quirk 5). Registers itself with the root on mount. */
function SelectOption({
  value,
  label,
  disabled = false,
  className,
  children,
}: SelectOptionProps) {
  const {
    open,
    value: selectedValue,
    highlighted,
    setHighlighted,
    highlightByKeyboard,
    upsertOption,
    removeOption,
    pick,
  } = useSelectContext()
  const id = useId()
  const resolvedLabel =
    label ?? (typeof children === "string" ? children : value)

  useLayoutEffect(() => {
    upsertOption({ id, value, label: resolvedLabel, disabled })
  }, [upsertOption, id, value, resolvedLabel, disabled])
  useLayoutEffect(() => () => removeOption(id), [removeOption, id])

  if (!open) return null

  const isSelected = selectedValue === value
  const isHighlighted = highlighted === value
  const optionStyles = mergeStyles({
    className,
    lockedStyle: disabled
      ? SELECT_OPTION_DISABLED_LOCKED_STYLE
      : SELECT_OPTION_LOCKED_STYLE,
  })
  //A row is never focused and handles no keys of its own: focus stays on the
  //listbox, which owns the keyboard (quirk 4) and names the row through
  //`aria-activedescendant`. That is the listbox pattern, not a gap.
  return (
    // biome-ignore lint/a11y/useFocusableInteractive: focus stays on the listbox (aria-activedescendant)
    // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox's onKeyDown picks the highlighted row
    <div
      id={id}
      role="option"
      aria-selected={isSelected}
      aria-disabled={disabled || undefined}
      data-adaptv="select-option"
      data-part="option"
      data-value={value}
      data-selected={isSelected ? "" : undefined}
      data-highlighted={isHighlighted ? "" : undefined}
      data-disabled={disabled ? "" : undefined}
      className={optionStyles.className || undefined}
      style={optionStyles.style}
      onPointerMove={() => {
        if (disabled || isHighlighted) return
        highlightByKeyboard.current = false
        setHighlighted(value)
      }}
      onClick={() => {
        if (!disabled) pick(value)
      }}
    >
      {children ?? resolvedLabel}
    </div>
  )
}
SelectOption.displayName = "Select.Option"

const SelectCompound = Object.assign(Select, {
  Trigger: SelectTrigger,
  Value: SelectValue,
  Content: SelectContent,
  Option: SelectOption,
})

export { SelectCompound as Select }

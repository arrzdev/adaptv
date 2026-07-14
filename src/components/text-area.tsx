import type {
  ComponentProps,
  FocusEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  ReactElement,
  ReactNode,
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
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { cn } from "#nativ/utils/cn"
import { isTouchDevice } from "#nativ/utils/is-touch-device"

/* =============================================================================
 * TYPES
 * ============================================================================= */

/**
 * Imperative API for {@link TextArea}. Attach with `ref`.
 *
 * | Member | Description |
 * |--------|-------------|
 * | `value` | Live field value (readonly) |
 * | `disabled` | Live disabled state (readonly) |
 * | `focus()` | Focus the underlying `<textarea>` |
 * | `clear()` | Clear value and dispatch native `input`/`change` |
 */
export type TextAreaHandle = {
  readonly value: string
  readonly disabled: boolean
  focus: () => void
  clear: () => void
}

/**
 * Props for `TextArea.Label`. Must be a direct child of `<TextArea>`.
 *
 * @example
 * ```tsx
 * <TextArea name="notes">
 *   <TextArea.Label>Notes</TextArea.Label>
 * </TextArea>
 * ```
 */
export interface TextAreaLabelProps {
  /** Label text or rich label content. */
  children: ReactNode
  /** Tier 2 typography and spacing. */
  className?: string
}

/**
 * Props for `TextArea.Hint`. Must be a direct child of `<TextArea>`.
 *
 * Wired to the field via `aria-describedby` when rendered inside `<TextArea>`.
 */
export interface TextAreaHintProps {
  /** Helper copy shown below the field. */
  children: ReactNode
  /** Tier 2 muted typography. */
  className?: string
}

/**
 * Props for `TextArea.Error`. Must be a direct child of `<TextArea>`.
 *
 * Wired to the field via `aria-describedby` and `role="alert"` when rendered
 * inside `<TextArea>`.
 */
export interface TextAreaErrorProps {
  /** Validation or error message. */
  children: ReactNode
  /** Tier 2 destructive typography. */
  className?: string
}

/**
 * Multiline text field. Forwards native `<textarea>` props (`value`, `defaultValue`,
 * `onChange`, `disabled`, `name`, `aria-*`, etc.).
 *
 * **Controlled** — `value` + `onChange`. **Uncontrolled** — `defaultValue`.
 *
 * Optional `TextArea.Label`, `TextArea.Hint`, and `TextArea.Error` must be direct
 * children of `<TextArea>`; the root lays them out in a column and wires ids /
 * `aria-describedby`. Root `className` styles the shell (`placeholder:` / `caret:`
 * route to the inner `<textarea>`). Tier 2 owns shell `px-*` / `py-*`, border, and
 * focus chrome; Tier 1 is chromeless on the inner field and only mirrors shell
 * padding for scroll inset when content overflows.
 */
export type TextAreaProps = Omit<
  ComponentProps<"textarea">,
  "onKeyDown" | "onBlur"
> & {
  /** `TextArea.Label`, `TextArea.Hint`, and/or `TextArea.Error` slots. */
  children?: ReactNode
  /** Grow height with content until `maxRows`, then scroll (default: true). */
  autoResize?: boolean
  /** Minimum row count for auto-grow (default: 4). */
  rows?: number
  /** Maximum rows before scrolling (default: 100). */
  maxRows?: number
  /** Called on Enter without Shift (desktop only; ignored on touch devices). */
  onSubmitKey?: () => void
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void
  onBlur?: (e: FocusEvent<HTMLTextAreaElement>) => void
}

type PartitionedTextAreaChildren = {
  label: ReactElement<TextAreaLabelProps> | null
  hint: ReactElement<TextAreaHintProps> | null
  error: ReactElement<TextAreaErrorProps> | null
}

/** Slot wiring and disabled state for {@link TextArea} compound trees. */
export type TextAreaContextValue = {
  isDisabled: boolean
  fieldId: string
  hintId: string | undefined
  errorId: string | undefined
}

/* =============================================================================
 * CLASSES
 * ============================================================================= */

const TEXT_AREA_SHELL_GROW_LAYOUT_CLASS = "box-border block w-full min-w-0"
const TEXT_AREA_SHELL_FILL_LAYOUT_CLASS =
  "box-border flex h-full min-h-0 w-full min-w-0 flex-col"
const TEXT_AREA_SHELL_INTERACTION_CLASS = "cursor-text"
const TEXT_AREA_SHELL_NON_INTERACTION_CLASS = "non-clickable"
const TEXT_AREA_SHELL_SURFACE_CLASS = "bg-gray-50 text-gray-950"
const TEXT_AREA_INNER_LAYOUT_CLASS =
  "block w-full min-w-0 resize-none leading-normal"
const TEXT_AREA_INNER_CHROMELESS_CLASS =
  "border-none bg-transparent p-0 shadow-none text-inherit outline-none ring-0"
const TEXT_AREA_INNER_FILL_CLASS = "min-h-0 w-full flex-1"
const TEXT_AREA_INNER_AT_MAX_ROWS_OVERFLOW_CLASS =
  "overflow-y-auto hardware-boosted"
const TEXT_AREA_FIELDSET_LAYOUT_CLASS =
  "flex w-full min-w-0 flex-col gap-2 border-0 p-0 m-0"

const TEXT_AREA_FIELD_CLASS_PREFIXES = ["placeholder:", "caret:"] as const

/* =============================================================================
 * CONTEXT
 * ============================================================================= */

const TextAreaContext = createContext<TextAreaContextValue | null>(null)

/**
 * Slot ids for {@link TextArea} Label / Hint / Error parts (not brand `is*` state).
 * Use in Tier 2 wrappers that replace compound slots.
 */
export function useTextArea(): TextAreaContextValue {
  const ctx = useContext(TextAreaContext)
  if (ctx === null) {
    throw new Error(
      "useTextArea must be used within a <TextArea> with Label, Hint, or Error slots.",
    )
  }
  return ctx
}

function useTextAreaContext(): TextAreaContextValue {
  return useTextArea()
}

/* =============================================================================
 * CLASSNAME PARTITIONING
 * ============================================================================= */

function isTextAreaFieldClassToken(token: string) {
  return TEXT_AREA_FIELD_CLASS_PREFIXES.some((prefix) =>
    token.startsWith(prefix),
  )
}

/**
 * Shell vs inner split (same allowlist as grouped {@link Input}: `placeholder:` / `caret:`).
 * Brand padding, border, and focus chrome stay on the shell via Tier 2 `className`.
 */
function partitionTextAreaClassName(className?: string) {
  if (!className) {
    return { shellClassName: undefined, innerClassName: undefined }
  }

  const shellTokens: string[] = []
  const innerTokens: string[] = []

  for (const token of className.trim().split(/\s+/)) {
    if (!token) continue
    if (isTextAreaFieldClassToken(token)) innerTokens.push(token)
    else shellTokens.push(token)
  }

  return {
    shellClassName:
      shellTokens.length > 0 ? shellTokens.join(" ") : undefined,
    innerClassName:
      innerTokens.length > 0 ? innerTokens.join(" ") : undefined,
  }
}

/* =============================================================================
 * CHILDREN PARTITIONING
 * ============================================================================= */

function isTextAreaLabelElement(
  child: ReactNode,
): child is ReactElement<TextAreaLabelProps> {
  if (!isValidElement(child)) return false
  if (child.type === TextAreaLabel) return true
  const type = child.type
  if (typeof type === "function" || typeof type === "object")
    return (
      (type as { displayName?: string }).displayName === "TextArea.Label"
    )
  return false
}

function isTextAreaHintElement(
  child: ReactNode,
): child is ReactElement<TextAreaHintProps> {
  if (!isValidElement(child)) return false
  if (child.type === TextAreaHint) return true
  const type = child.type
  if (typeof type === "function" || typeof type === "object")
    return (
      (type as { displayName?: string }).displayName === "TextArea.Hint"
    )
  return false
}

function isTextAreaErrorElement(
  child: ReactNode,
): child is ReactElement<TextAreaErrorProps> {
  if (!isValidElement(child)) return false
  if (child.type === TextAreaError) return true
  const type = child.type
  if (typeof type === "function" || typeof type === "object")
    return (
      (type as { displayName?: string }).displayName === "TextArea.Error"
    )
  return false
}

function partitionTextAreaChildren(
  children: ReactNode,
): PartitionedTextAreaChildren {
  let label: ReactElement<TextAreaLabelProps> | null = null
  let hint: ReactElement<TextAreaHintProps> | null = null
  let error: ReactElement<TextAreaErrorProps> | null = null

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) {
      if (child !== null && child !== undefined && child !== false) {
        throw new Error(
          "TextArea accepts only TextArea.Label, TextArea.Hint, and TextArea.Error children.",
        )
      }
      return
    }

    if (isTextAreaLabelElement(child)) {
      if (label) {
        throw new Error(
          "TextArea accepts only one <TextArea.Label> child.",
        )
      }
      label = child
      return
    }

    if (isTextAreaHintElement(child)) {
      if (hint) {
        throw new Error("TextArea accepts only one <TextArea.Hint> child.")
      }
      hint = child
      return
    }

    if (isTextAreaErrorElement(child)) {
      if (error) {
        throw new Error(
          "TextArea accepts only one <TextArea.Error> child.",
        )
      }
      error = child
      return
    }

    throw new Error(
      "TextArea accepts only TextArea.Label, TextArea.Hint, and TextArea.Error as direct children.",
    )
  })

  return { label, hint, error }
}

function dispatchFieldValueEvents(field: HTMLTextAreaElement) {
  field.dispatchEvent(new Event("input", { bubbles: true }))
  field.dispatchEvent(new Event("change", { bubbles: true }))
}

/** True when the user removed text (deletion, cut, or shorter paste/replace). */
function isTextAreaShrinkInput(e: FormEvent<HTMLTextAreaElement>) {
  const native = e.nativeEvent
  if (
    native instanceof InputEvent &&
    native.inputType.startsWith("delete")
  ) {
    return true
  }

  return false
}

/* =============================================================================
 * AUTO RESIZE
 *
 * Inner `<textarea>` is chromeless (`p-0`, no border). Tier 2 `px-*` / `py-*` on the
 * shell `className`; when scrolling, Tier 1 sets inner `scroll-padding-bottom` from
 * the shell’s computed `padding-bottom` only (top inset is not adjusted).
 * Row caps (`rows`, `maxRows`) size the inner scrollport. Fill layout when
 * `autoResize={false}` (`h-full` + inner scroll).
 * ============================================================================= */

function documentRootFontSizePx() {
  if (typeof document === "undefined") return 16
  return (
    parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  )
}

function pxToRem(px: number) {
  return px / documentRootFontSizePx()
}

type TextAreaInnerMetrics = {
  lineHeight: number
  borderTop: number
  borderBottom: number
}

type TextAreaShellMetrics = {
  paddingTop: number
  paddingBottom: number
  borderTop: number
  borderBottom: number
}

function readTextAreaInnerMetrics(
  textarea: HTMLTextAreaElement,
): TextAreaInnerMetrics {
  const computedStyle = window.getComputedStyle(textarea)
  const fontSize = parseFloat(computedStyle.fontSize) || 14
  const lineHeight = parseFloat(computedStyle.lineHeight) || fontSize * 1.5

  return {
    lineHeight,
    borderTop: parseFloat(computedStyle.borderTopWidth) || 0,
    borderBottom: parseFloat(computedStyle.borderBottomWidth) || 0,
  }
}

function readTextAreaShellMetrics(
  shell: HTMLElement,
): TextAreaShellMetrics {
  const computedStyle = window.getComputedStyle(shell)

  return {
    paddingTop: parseFloat(computedStyle.paddingTop) || 0,
    paddingBottom: parseFloat(computedStyle.paddingBottom) || 0,
    borderTop: parseFloat(computedStyle.borderTopWidth) || 0,
    borderBottom: parseFloat(computedStyle.borderBottomWidth) || 0,
  }
}

function innerHeightForRows(
  rowCount: number,
  { lineHeight, borderTop, borderBottom }: TextAreaInnerMetrics,
) {
  return lineHeight * rowCount + borderTop + borderBottom
}

function shellVerticalChrome({
  paddingTop,
  paddingBottom,
  borderTop,
  borderBottom,
}: TextAreaShellMetrics) {
  return paddingTop + paddingBottom + borderTop + borderBottom
}

function parseCssLengthPx(raw: string): number | null {
  if (!raw || raw === "none" || raw === "auto") return null

  const value = parseFloat(raw)
  if (Number.isNaN(value) || value <= 0) return null

  return value
}

/**
 * Border-box cap from `max-height`, or explicit `%` / `h-full` height — not
 * content-sized px height (that false-positive blocked auto-grow on the shell).
 */
function resolveCssBoxHeightCap(element: HTMLElement): number | null {
  const style = window.getComputedStyle(element)
  const maxHeight = parseCssLengthPx(style.maxHeight)
  if (maxHeight !== null) return maxHeight

  const heightRaw = style.height
  if (heightRaw.includes("%")) {
    const height = parseCssLengthPx(heightRaw)
    if (height !== null) return height
  }

  if (element instanceof HTMLTextAreaElement && !element.style.height) {
    const height = parseCssLengthPx(heightRaw)
    if (height !== null && heightRaw !== "auto") return height
  }

  return null
}

function resolveParentMaxInnerHeight(
  shell: HTMLElement,
  innerMetrics: TextAreaInnerMetrics,
  shellMetrics: TextAreaShellMetrics,
): number | null {
  const parent = shell.parentElement
  if (!parent) return null

  const parentStyle = window.getComputedStyle(parent)
  const parentMaxHeightRaw = parentStyle.maxHeight
  if (!parentMaxHeightRaw || parentMaxHeightRaw === "none") return null

  const parentMaxHeightValue = parseFloat(parentMaxHeightRaw)
  if (Number.isNaN(parentMaxHeightValue) || parentMaxHeightValue <= 0)
    return null

  const shellRect = shell.getBoundingClientRect()
  const parentRect = parent.getBoundingClientRect()
  const topOffset = shellRect.top - parentRect.top
  const availableShellHeight = parentMaxHeightValue - topOffset
  if (availableShellHeight <= 0) return null

  const availableInnerHeight =
    availableShellHeight - shellVerticalChrome(shellMetrics)
  if (availableInnerHeight <= 0) return null

  const integerRows = Math.max(
    1,
    Math.floor(availableInnerHeight / innerMetrics.lineHeight),
  )

  return innerHeightForRows(integerRows, innerMetrics)
}

function resolveInnerMaxHeightCap(
  shell: HTMLElement,
  innerMetrics: TextAreaInnerMetrics,
  shellMetrics: TextAreaShellMetrics,
  maxRowsHeight: number,
  cssShellHeightCap: number | null,
): number {
  const caps = [maxRowsHeight]

  if (cssShellHeightCap !== null) {
    const innerCap = cssShellHeightCap - shellVerticalChrome(shellMetrics)
    if (innerCap > 0) caps.push(innerCap)
  }

  const parentInnerCap = resolveParentMaxInnerHeight(
    shell,
    innerMetrics,
    shellMetrics,
  )
  if (parentInnerCap !== null) caps.push(parentInnerCap)

  return Math.min(...caps)
}

/** Sub-pixel tolerance when comparing measured vs applied height. */
const TEXT_AREA_HEIGHT_EPSILON_PX = 1

type TextAreaAutoHeightCaps = {
  minHeight: number
  maxHeightValue: number
  shellPaddingBottom: number
}

function computeTextAreaAutoHeightCaps(
  inner: HTMLTextAreaElement,
  shell: HTMLElement,
  { rows, maxRows }: { rows: number; maxRows: number },
): TextAreaAutoHeightCaps {
  const innerMetrics = readTextAreaInnerMetrics(inner)
  const shellMetrics = readTextAreaShellMetrics(shell)
  const cssShellHeightCap = resolveCssBoxHeightCap(shell)

  const singleRowHeight = innerHeightForRows(1, innerMetrics)
  const minHeight =
    rows === 1 ? singleRowHeight : innerHeightForRows(rows, innerMetrics)
  const maxRowsHeight = innerHeightForRows(maxRows, innerMetrics)

  return {
    minHeight,
    maxHeightValue: resolveInnerMaxHeightCap(
      shell,
      innerMetrics,
      shellMetrics,
      maxRowsHeight,
      cssShellHeightCap,
    ),
    shellPaddingBottom: shellMetrics.paddingBottom,
  }
}

function syncTextAreaMaxRowsOverflowState(
  inner: HTMLTextAreaElement,
  atMaxRows: boolean,
  shellPaddingBottom: number,
) {
  if (atMaxRows) {
    syncTextAreaInnerScrollPadding(inner, shellPaddingBottom)
    return
  }

  clearTextAreaInnerScrollPadding(inner)
}

type ApplyTextAreaAutoHeightOptions = {
  /** Collapse to `auto` to read true content height (deletions, controlled shrink). */
  remeasure?: boolean
}

/**
 * Grow-mode: inline height on the inner field. Returns whether content exceeds the cap.
 *
 * Grows without collapsing when `scrollHeight > clientHeight`. When the box is taller
 * than its content, `scrollHeight === clientHeight`, so shrink only runs when `remeasure`
 * is set (delete/cut/shorter value) — not on every insert.
 */
function applyTextAreaAutoHeight(
  inner: HTMLTextAreaElement,
  caps: TextAreaAutoHeightCaps,
  { remeasure = false }: ApplyTextAreaAutoHeightOptions = {},
): boolean {
  const { minHeight, maxHeightValue, shellPaddingBottom } = caps
  const clientHeight = inner.clientHeight

  if (
    !remeasure &&
    clientHeight >= maxHeightValue - TEXT_AREA_HEIGHT_EPSILON_PX &&
    inner.scrollHeight > clientHeight
  ) {
    syncTextAreaMaxRowsOverflowState(inner, true, shellPaddingBottom)
    return true
  }

  let desiredHeight = inner.scrollHeight

  if (inner.scrollHeight > clientHeight) {
    // Content taller than the box — grow without collapsing.
  } else if (remeasure || inner.scrollHeight < clientHeight) {
    inner.style.height = "auto"
    void inner.offsetHeight
    desiredHeight = inner.scrollHeight
  } else {
    const currentHeight = inner.offsetHeight
    const finalHeight = Math.max(
      minHeight,
      Math.min(inner.scrollHeight, maxHeightValue),
    )
    const atMaxRows = inner.scrollHeight > maxHeightValue

    if (
      Math.abs(currentHeight - finalHeight) > TEXT_AREA_HEIGHT_EPSILON_PX
    ) {
      inner.style.height = `${pxToRem(finalHeight)}rem`
    }

    syncTextAreaMaxRowsOverflowState(inner, atMaxRows, shellPaddingBottom)
    return atMaxRows
  }

  const finalHeight = Math.max(
    minHeight,
    Math.min(desiredHeight, maxHeightValue),
  )
  const atMaxRows = desiredHeight > maxHeightValue

  if (
    Math.abs(inner.offsetHeight - finalHeight) >
    TEXT_AREA_HEIGHT_EPSILON_PX
  ) {
    inner.style.height = `${pxToRem(finalHeight)}rem`
  }

  syncTextAreaMaxRowsOverflowState(inner, atMaxRows, shellPaddingBottom)

  return atMaxRows
}

/** Mirrors Tier 2 shell `padding-bottom` on the inner scrollport. */
function syncTextAreaInnerScrollPadding(
  inner: HTMLTextAreaElement,
  paddingBottom: number,
) {
  inner.style.scrollPaddingTop = "0px"
  inner.style.scrollPaddingBottom = `${paddingBottom}px`
}

function clearTextAreaInnerScrollPadding(inner: HTMLTextAreaElement) {
  inner.style.removeProperty("scroll-padding-top")
  inner.style.removeProperty("scroll-padding-bottom")
}

function syncTextAreaFillField(
  inner: HTMLTextAreaElement,
  shell: HTMLElement,
): boolean {
  inner.style.removeProperty("height")
  inner.style.removeProperty("min-height")
  inner.style.removeProperty("overflow")

  const overflows = inner.scrollHeight > inner.clientHeight

  if (overflows) {
    syncTextAreaInnerScrollPadding(
      inner,
      readTextAreaShellMetrics(shell).paddingBottom,
    )
    if (document.activeElement !== inner) inner.scrollTop = 0
  } else {
    clearTextAreaInnerScrollPadding(inner)
  }

  return overflows
}

type UseTextAreaAutoResizeOptions = {
  shellRef: RefObject<HTMLDivElement | null>
  fieldRef: RefObject<HTMLTextAreaElement | null>
  autoResize: boolean
  rows: number
  maxRows: number
  value: TextAreaProps["value"]
}

function useTextAreaAutoResize({
  shellRef,
  fieldRef,
  autoResize,
  rows,
  maxRows,
  value,
}: UseTextAreaAutoResizeOptions) {
  const [atMaxRows, setAtMaxRows] = useState(false)
  const syncFrameRef = useRef(0)
  const pendingRemeasureRef = useRef(false)
  const contentLengthRef = useRef(0)
  const autoHeightCapsRef = useRef<TextAreaAutoHeightCaps | null>(null)
  const rowCapsRef = useRef({ rows, maxRows })

  const setAtMaxRowsIfChanged = useCallback((next: boolean) => {
    setAtMaxRows((prev) => (prev === next ? prev : next))
  }, [])

  const invalidateAutoHeightCaps = useCallback(() => {
    autoHeightCapsRef.current = null
  }, [])

  const getAutoHeightCaps = useCallback(
    (inner: HTMLTextAreaElement, shell: HTMLElement) => {
      if (
        rowCapsRef.current.rows !== rows ||
        rowCapsRef.current.maxRows !== maxRows
      ) {
        rowCapsRef.current = { rows, maxRows }
        autoHeightCapsRef.current = null
      }

      if (autoHeightCapsRef.current === null) {
        autoHeightCapsRef.current = computeTextAreaAutoHeightCaps(
          inner,
          shell,
          {
            rows,
            maxRows,
          },
        )
      }

      return autoHeightCapsRef.current
    },
    [maxRows, rows],
  )

  const syncField = useCallback(
    (options?: ApplyTextAreaAutoHeightOptions) => {
      const inner = fieldRef.current
      const shell = shellRef.current
      if (!inner || !shell) return

      contentLengthRef.current = inner.value.length

      if (!autoResize) {
        setAtMaxRowsIfChanged(syncTextAreaFillField(inner, shell))
        return
      }

      setAtMaxRowsIfChanged(
        applyTextAreaAutoHeight(
          inner,
          getAutoHeightCaps(inner, shell),
          options,
        ),
      )
    },
    [
      autoResize,
      fieldRef,
      getAutoHeightCaps,
      setAtMaxRowsIfChanged,
      shellRef,
    ],
  )

  const scheduleSyncField = useCallback(
    (options?: ApplyTextAreaAutoHeightOptions) => {
      if (options?.remeasure) pendingRemeasureRef.current = true

      cancelAnimationFrame(syncFrameRef.current)
      syncFrameRef.current = requestAnimationFrame(() => {
        syncField({
          remeasure: pendingRemeasureRef.current,
        })
        pendingRemeasureRef.current = false
      })
    },
    [syncField],
  )

  useLayoutEffect(() => {
    const valueLength = typeof value === "string" ? value.length : null
    const remeasure =
      valueLength !== null && valueLength < contentLengthRef.current

    syncField({ remeasure })
    // Controlled: `value` is a sync trigger when the parent updates the field.
    void value
  }, [syncField, value])

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return

    const observer = new ResizeObserver(() => {
      invalidateAutoHeightCaps()
      scheduleSyncField()
    })
    observer.observe(shell)

    if (autoResize) {
      const parent = shell.parentElement
      if (parent) observer.observe(parent)
    }

    return () => {
      cancelAnimationFrame(syncFrameRef.current)
      observer.disconnect()
    }
  }, [autoResize, invalidateAutoHeightCaps, scheduleSyncField, shellRef])

  const notifyFieldInput = useCallback(
    (e: FormEvent<HTMLTextAreaElement>) => {
      const nextLength = e.currentTarget.value.length
      const remeasure =
        isTextAreaShrinkInput(e) || nextLength < contentLengthRef.current
      scheduleSyncField({ remeasure })
    },
    [scheduleSyncField],
  )

  return { atMaxRows, notifyFieldInput, resizeTextarea: scheduleSyncField }
}

/* =============================================================================
 * TEXT AREA SHELL
 * ============================================================================= */

type TextAreaShellProps = {
  children: ReactNode
  className?: string
  fieldRef: RefObject<HTMLTextAreaElement | null>
  disabled?: boolean
  isFillMode: boolean
}

const TextAreaShell = forwardRef<HTMLDivElement, TextAreaShellProps>(
  function TextAreaShell(
    { children, className, fieldRef, disabled, isFillMode },
    ref,
  ) {
    function handleMouseDown(e: MouseEvent<HTMLDivElement>) {
      const field = fieldRef.current
      if (!field) return

      const target = e.target as HTMLElement
      if (field === target || field.contains(target)) return

      if (document.activeElement !== field) {
        e.preventDefault()
        field.focus()
        return
      }

      e.preventDefault()
    }

    return (
      // Padding band click focuses the inner field (shell is not a <label> when TextArea.Label is used).
      // biome-ignore lint/a11y/noStaticElementInteractions: mirrors grouped Input shell hit target
      <div
        ref={ref}
        className={cn(
          isFillMode
            ? TEXT_AREA_SHELL_FILL_LAYOUT_CLASS
            : TEXT_AREA_SHELL_GROW_LAYOUT_CLASS,
          disabled
            ? TEXT_AREA_SHELL_NON_INTERACTION_CLASS
            : TEXT_AREA_SHELL_INTERACTION_CLASS,
          TEXT_AREA_SHELL_SURFACE_CLASS,
          className,
        )}
        onMouseDown={handleMouseDown}
      >
        {children}
      </div>
    )
  },
)

TextAreaShell.displayName = "TextAreaShell"

/* =============================================================================
 * TEXT AREA LABEL
 * ============================================================================= */

/**
 * Accessible label for the field. Must be a direct child of `<TextArea>`.
 *
 * Renders a native `<label htmlFor={fieldId}>` using the root-generated id.
 */
function TextAreaLabel({ children, className }: TextAreaLabelProps) {
  const { fieldId } = useTextAreaContext()

  return (
    <label htmlFor={fieldId} className={cn(className)}>
      {children}
    </label>
  )
}

TextAreaLabel.displayName = "TextArea.Label"

/* =============================================================================
 * TEXT AREA HINT
 * ============================================================================= */

/**
 * Helper text below the field. Must be a direct child of `<TextArea>`.
 *
 * Exposes a stable `id` for `aria-describedby` on the `<textarea>`.
 */
function TextAreaHint({ children, className }: TextAreaHintProps) {
  const { hintId } = useTextAreaContext()

  return (
    <p id={hintId} className={cn(className)}>
      {children}
    </p>
  )
}

TextAreaHint.displayName = "TextArea.Hint"

/* =============================================================================
 * TEXT AREA ERROR
 * ============================================================================= */

/**
 * Error message below the field. Must be a direct child of `<TextArea>`.
 *
 * Uses `role="alert"` and a stable `id` for `aria-describedby` on the `<textarea>`.
 */
function TextAreaError({ children, className }: TextAreaErrorProps) {
  const { errorId } = useTextAreaContext()

  return (
    <p id={errorId} role="alert" className={cn(className)}>
      {children}
    </p>
  )
}

TextAreaError.displayName = "TextArea.Error"

/* =============================================================================
 * ROOT
 * ============================================================================= */

/**
 * Multiline field with optional auto-grow. Set `autoResize={false}` for a fixed-height
 * field that scrolls inside itself (height from `rows` and/or `className`).
 *
 * **With slots** — place `TextArea.Label`, `TextArea.Hint`, and/or `TextArea.Error`
 * as direct children. `className` styles the shell (`placeholder:` → inner field).
 * Tier 2 supplies shell padding (`px-*` / `py-*`), border, and `focus-within:` —
 * not Tier 1.
 *
 * **Imperative handle** (`ref`)
 * - `ref.current.value` — live field value (readonly).
 * - `ref.current.disabled` — reflects the live disabled state (readonly).
 * - `ref.current.focus()` — focuses the underlying textarea.
 * - `ref.current.clear()` — clears the native `<textarea>` and dispatches `input`/`change`.
 *
 * **Baseline styles**: neutral gray shell surface, full width, chromeless inner field.
 * Borders, padding, and focus belong in Tier 2 `className` on the shell.
 *
 * @example
 * ```tsx
 * const ref = useRef<TextAreaHandle>(null)
 *
 * <TextArea ref={ref} name="notes" rows={3} placeholder="Notes">
 *   <TextArea.Label>Notes</TextArea.Label>
 *   <TextArea.Hint>Optional</TextArea.Hint>
 * </TextArea>
 * ```
 */
const TextAreaRoot = forwardRef<TextAreaHandle, TextAreaProps>(
  function TextArea(
    {
      children,
      className,
      autoResize = true,
      rows = 4,
      maxRows = 100,
      value,
      disabled,
      name,
      defaultValue,
      onSubmitKey,
      onKeyDown,
      onBlur,
      onChange,
      onInput,
      id,
      ...props
    },
    ref,
  ) {
    const shellRef = useRef<HTMLDivElement | null>(null)
    const fieldRef = useRef<HTMLTextAreaElement | null>(null)
    const { shellClassName, innerClassName } = useMemo(
      () => partitionTextAreaClassName(className),
      [className],
    )
    const isFillMode = !autoResize

    const { atMaxRows, notifyFieldInput } = useTextAreaAutoResize({
      shellRef,
      fieldRef,
      autoResize,
      rows,
      maxRows,
      value,
    })

    const generatedFieldId = useId()
    const hintId = useId()
    const errorId = useId()
    const fieldId = id ?? generatedFieldId

    const { label, hint, error } = useMemo(
      () => partitionTextAreaChildren(children),
      [children],
    )
    const hasSlots = label !== null || hint !== null || error !== null
    const describedBy = useMemo(() => {
      const ids: string[] = []
      if (hint) ids.push(hintId)
      if (error) ids.push(errorId)
      return ids.length > 0 ? ids.join(" ") : undefined
    }, [error, hint, errorId, hintId])

    useImperativeHandle(
      ref,
      () => ({
        get value() {
          return fieldRef.current?.value ?? ""
        },
        get disabled() {
          return fieldRef.current?.disabled ?? false
        },
        focus: () => {
          fieldRef.current?.focus()
        },
        clear: () => {
          const field = fieldRef.current
          if (!field) return
          field.value = ""
          dispatchFieldValueEvents(field)
        },
      }),
      [],
    )

    function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
      if (
        onSubmitKey &&
        e.key === "Enter" &&
        !e.shiftKey &&
        !isTouchDevice()
      ) {
        e.preventDefault()
        e.stopPropagation()
        onSubmitKey()
      }
      onKeyDown?.(e)
    }

    const field = (
      <textarea
        ref={fieldRef}
        id={fieldId}
        name={name}
        aria-describedby={describedBy}
        className={cn(
          TEXT_AREA_INNER_LAYOUT_CLASS,
          TEXT_AREA_INNER_CHROMELESS_CLASS,
          isFillMode && TEXT_AREA_INNER_FILL_CLASS,
          (isFillMode || atMaxRows) &&
            TEXT_AREA_INNER_AT_MAX_ROWS_OVERFLOW_CLASS,
          innerClassName,
        )}
        rows={isFillMode ? 1 : autoResize ? 1 : rows}
        {...(value !== undefined ? { value } : {})}
        defaultValue={defaultValue}
        onChange={onChange}
        onInput={(e) => {
          onInput?.(e)
          if (value === undefined) notifyFieldInput(e)
        }}
        onKeyDown={handleKeyDown}
        onBlur={onBlur}
        {...props}
        disabled={disabled}
      />
    )

    const control = (
      <TextAreaShell
        ref={shellRef}
        fieldRef={fieldRef}
        disabled={disabled}
        isFillMode={isFillMode}
        className={shellClassName}
      >
        {field}
      </TextAreaShell>
    )

    if (!hasSlots) return control

    const contextValue: TextAreaContextValue = {
      isDisabled: disabled ?? false,
      fieldId,
      hintId: hint ? hintId : undefined,
      errorId: error ? errorId : undefined,
    }

    return (
      <TextAreaContext.Provider value={contextValue}>
        <fieldset
          disabled={disabled}
          className={TEXT_AREA_FIELDSET_LAYOUT_CLASS}
        >
          {label}
          {control}
          {hint}
          {error}
        </fieldset>
      </TextAreaContext.Provider>
    )
  },
)

TextAreaRoot.displayName = "TextArea"

/* =============================================================================
 * COMPOUND EXPORT
 * ============================================================================= */

const TextAreaCompound = Object.assign(TextAreaRoot, {
  Label: TextAreaLabel,
  Hint: TextAreaHint,
  Error: TextAreaError,
})

export { TextAreaCompound as TextArea }

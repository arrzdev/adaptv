import type {
  ComponentPropsWithRef,
  CSSProperties,
  ReactElement,
  ReactNode,
} from "react"
import { Children, cloneElement, isValidElement, useId } from "react"
import { composeStyles } from "#adaptv/utils/styles"

/* =============================================================================
 * FieldGroup — the grouped settings form.
 *
 * The iOS Settings shape: titled sections, each a stack of rows with a label on
 * the leading side and a control on the trailing side, an optional footer of
 * fine print under the stack. Ionic spells it `ion-list inset`; React Native's
 * settings screens re-derive it by hand every time. adaptv ships the STRUCTURE
 * and nothing else: which element is the section, which is the header, which
 * box holds only the rows. Every colour, radius, inset and gap is the
 * consumer's `className`, because that is the whole of what differs between
 * one app's settings page and the next.
 *
 * ## What is locked, and why so little
 *
 * A row is `display: flex`, and its label column is a flex column. That is the
 * entire locked tier, written as inline style (docs/decisions/styling.md §2.0). A row's label and control only read as leading/trailing while
 * the row is a flex container, and the title only stacks above its description
 * while the column is one, so those two are structure. Alignment
 * (`align-items: center`, `justify-content: space-between`, field-group.css) is a
 * default in the layer, overridable the way Input's
 * slot alignment is: a multi-line description with a top-aligned control is a
 * legitimate row, and `items-start` must reach it.
 *
 * ## Why there is no `data-position`
 *
 * The grouped corner radii (round the first row's top, the last row's bottom)
 * are the one thing every settings list styles, and the tempting answer is a
 * `data-position="leading|middle|trailing|only"` on each row. adaptv does not
 * stamp one, because Tailwind already spells it: the rows are the ONLY children
 * of `[data-part="rows"]`, so a consumer's `first:rounded-t-xl last:rounded-b-xl`
 * on each row is exactly that attribute, in a vocabulary they already have
 * (`docs/decisions/styling.md` §5.4.1). Header and footer never land inside the
 * rows box, which is what keeps `first:` and `last:` honest. A consumer building
 * rows OUTSIDE this component, where no such box exists, gets the same
 * classification as a pure function: {@link getFieldItemPosition}.
 *
 * ## Slots beat shorthand
 *
 * `title` / `footer` on a Section and `label` / `description` on a Row are the
 * common-case shorthand. `<FieldGroup.Header>`, `<FieldGroup.Footer>`,
 * `<FieldGroup.Label>` and `<FieldGroup.Description>` are the same parts as
 * elements, for when the content needs its own className or markup. When both
 * are given the slot wins: the element form is the more deliberate of the two,
 * and an element carrying its own props cannot be expressed by a string.
 * Slots are detected by partitioning the direct children at render time, which
 * is synchronous and SSR-safe. So a slot MUST be a direct child of its Section
 * or Row; wrapping one in a fragment or a component that renders it later
 * hides it, and it falls through as ordinary content.
 *
 * ## Accessibility
 *
 * A Section with a header is `aria-labelledby` the header's id (generated, or
 * the id the Header slot already carries). A Section without one carries no
 * `aria-labelledby`, rather than pointing at nothing. A Row's `disabled` stamps
 * `data-disabled` and `aria-disabled="true"` on the row only; it deliberately
 * does not reach into the control, which owns its own `disabled`.
 *
 * | Attribute | Where | When |
 * |-----------|-------|------|
 * | `data-adaptv="field-group"` | the root `<div>` | always |
 * | `data-part="root"` | the root `<div>` | always |
 * | `data-part="section"` | each `<section>` | always |
 * | `data-part="header"` | the section title `<div>`, id'd | a `title` or `Header` exists |
 * | `data-part="rows"` | the `<div>` whose only children are rows | always |
 * | `data-part="footer"` | the section footer `<div>` | a `footer` or `Footer` exists |
 * | `data-adaptv="field-group-row"` | each row (or the `render` element) | always |
 * | `data-part="row"` | each row (or the `render` element) | always |
 * | `data-adaptv="field-group-label"` | the row's leading column | a label, description or slot exists |
 * | `data-part="label"` | the row's leading column | a label, description or slot exists |
 * | `data-part="title"` | the `<span>` inside the label column | a `label` or `Label` exists |
 * | `data-part="description"` | the `<span>` inside the label column | a `description` or `Description` exists |
 * | `data-disabled` | the row | `disabled` |
 *
 * @example
 * ```tsx
 * <FieldGroup className="flex flex-col gap-8 px-4">
 *   <FieldGroup.Section
 *     title="Notifications"
 *     footer="Sounds play even while the app is in the background."
 *     className="[&_[data-part=header]]:px-4 [&_[data-part=header]]:text-sm"
 *   >
 *     <FieldGroup.Row
 *       label="Sounds"
 *       description="Play a tone when a message arrives"
 *       render={<label />}
 *       className="gap-4 bg-surface px-4 py-3 first:rounded-t-xl last:rounded-b-xl"
 *     >
 *       <Switch name="sounds" />
 *     </FieldGroup.Row>
 *     <FieldGroup.Row
 *       label="Ringtone"
 *       render={<Link to="/settings/ringtone" />}
 *       className="gap-4 bg-surface px-4 py-3 first:rounded-t-xl last:rounded-b-xl"
 *     >
 *       <ChevronIcon />
 *     </FieldGroup.Row>
 *   </FieldGroup.Section>
 * </FieldGroup>
 * ```
 * ============================================================================= */

//LOCKED: a row is a flex container or its label and control are not leading and
//trailing; a label column is a flex column or the title and description sit on
//one line. Alignment is a DEFAULT (field-group.css), so `items-start` on a tall
//row wins.
const FIELD_ROW_LOCKED_STYLE: CSSProperties = Object.freeze({
  display: "flex",
})
const FIELD_LABEL_LOCKED_STYLE: CSSProperties = Object.freeze({
  display: "flex",
  flexDirection: "column",
})

type SlotComponent = { displayName?: string }

/**
 * A slot is matched by identity, or by `displayName` so a Tier 2 wrapper that
 * calls itself `FieldGroup.Header` is still found (the Switch.Thumb convention).
 */
function isSlot(
  child: unknown,
  slot: SlotComponent,
): child is ReactElement<Record<string, unknown>> {
  if (!isValidElement(child)) return false
  const type = child.type
  if (type === slot) return true
  return (
    typeof type === "function" &&
    (type as SlotComponent).displayName === slot.displayName
  )
}

/**
 * Split `children` into one element per slot (the last match wins, like a
 * later prop) and everything else, in source order. `Children.toArray` keys
 * the rest, so it renders as an array without a key warning.
 */
function partitionSlots(
  children: ReactNode,
  slots: readonly SlotComponent[],
): {
  slotted: (ReactElement<Record<string, unknown>> | undefined)[]
  rest: ReactNode[]
} {
  const slotted = new Array<
    ReactElement<Record<string, unknown>> | undefined
  >(slots.length)
  const rest: ReactNode[] = []
  for (const child of Children.toArray(children)) {
    const at = slots.findIndex((slot) => isSlot(child, slot))
    if (at === -1) rest.push(child)
    else slotted[at] = child as ReactElement<Record<string, unknown>>
  }
  return { slotted, rest }
}

/** `false`, `null` and `undefined` are "no content"; `0` and `""` are content. */
function hasContent(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false
}

/* =============================================================================
 * Root
 * ============================================================================= */

/** Props for {@link FieldGroup}. Plain `<div>` props; layout between sections is `className`. */
export interface FieldGroupProps extends ComponentPropsWithRef<"div"> {}

function FieldGroupRoot({
  className,
  style,
  children,
  ref,
  ...props
}: FieldGroupProps) {
  const merged = composeStyles({ className, style })
  return (
    <div
      {...props}
      ref={ref}
      data-adaptv="field-group"
      data-part="root"
      className={merged.className || undefined}
      style={merged.style}
    >
      {children}
    </div>
  )
}

FieldGroupRoot.displayName = "FieldGroup"

/* =============================================================================
 * Section: header, rows, footer
 * ============================================================================= */

/** Props for `FieldGroup.Header`. Must be a direct child of `FieldGroup.Section`. */
export interface FieldGroupHeaderProps
  extends ComponentPropsWithRef<"div"> {}

function FieldGroupHeader({
  className,
  style,
  children,
  ref,
  ...props
}: FieldGroupHeaderProps) {
  const merged = composeStyles({ className, style })
  return (
    <div
      {...props}
      ref={ref}
      data-part="header"
      className={merged.className || undefined}
      style={merged.style}
    >
      {children}
    </div>
  )
}

FieldGroupHeader.displayName = "FieldGroup.Header"

/** Props for `FieldGroup.Footer`. Must be a direct child of `FieldGroup.Section`. */
export interface FieldGroupFooterProps
  extends ComponentPropsWithRef<"div"> {}

function FieldGroupFooter({
  className,
  style,
  children,
  ref,
  ...props
}: FieldGroupFooterProps) {
  const merged = composeStyles({ className, style })
  return (
    <div
      {...props}
      ref={ref}
      data-part="footer"
      className={merged.className || undefined}
      style={merged.style}
    >
      {children}
    </div>
  )
}

FieldGroupFooter.displayName = "FieldGroup.Footer"

/**
 * Props for `FieldGroup.Section`. Extends native `<section>` props.
 *
 * `title` and `footer` are shorthand for a `FieldGroup.Header` / `FieldGroup.Footer`
 * child; the child wins when both are present. Everything else in `children`
 * is a row and lands inside `[data-part="rows"]`.
 */
export interface FieldGroupSectionProps
  extends Omit<ComponentPropsWithRef<"section">, "title"> {
  /**
   * Section heading. Shorthand for a `<FieldGroup.Header>` child. Replaces the
   * native `title` tooltip attribute, which a settings section has no use for.
   */
  title?: ReactNode
  /** Fine print under the rows. Shorthand for a `<FieldGroup.Footer>` child. */
  footer?: ReactNode
}

function FieldGroupSection({
  title,
  footer,
  className,
  style,
  children,
  ref,
  ...props
}: FieldGroupSectionProps) {
  const generatedId = useId()
  const {
    slotted: [headerSlot, footerSlot],
    rest: rows,
  } = partitionSlots(children, [FieldGroupHeader, FieldGroupFooter])

  //The slot's own id wins so a consumer can link to the heading from elsewhere;
  //otherwise the generated one is stamped on it, and the section points there.
  const header =
    headerSlot ??
    (hasContent(title) ? (
      <FieldGroupHeader>{title}</FieldGroupHeader>
    ) : null)
  const headerId =
    header && typeof header.props.id === "string"
      ? header.props.id
      : generatedId
  const footerNode =
    footerSlot ??
    (hasContent(footer) ? (
      <FieldGroupFooter>{footer}</FieldGroupFooter>
    ) : null)

  const merged = composeStyles({ className, style })

  return (
    <section
      {...props}
      ref={ref}
      data-part="section"
      aria-labelledby={header ? headerId : undefined}
      className={merged.className || undefined}
      style={merged.style}
    >
      {header ? cloneElement(header, { id: headerId }) : null}
      <div data-part="rows">{rows}</div>
      {footerNode}
    </section>
  )
}

FieldGroupSection.displayName = "FieldGroup.Section"

/* =============================================================================
 * Row: label column + trailing control
 * ============================================================================= */

/** Props for `FieldGroup.Label`. Must be a direct child of `FieldGroup.Row`. */
export interface FieldGroupLabelProps
  extends ComponentPropsWithRef<"span"> {}

function FieldGroupLabel({
  className,
  style,
  children,
  ref,
  ...props
}: FieldGroupLabelProps) {
  const merged = composeStyles({ className, style })
  return (
    <span
      {...props}
      ref={ref}
      data-part="title"
      className={merged.className || undefined}
      style={merged.style}
    >
      {children}
    </span>
  )
}

FieldGroupLabel.displayName = "FieldGroup.Label"

/** Props for `FieldGroup.Description`. Must be a direct child of `FieldGroup.Row`. */
export interface FieldGroupDescriptionProps
  extends ComponentPropsWithRef<"span"> {}

function FieldGroupDescription({
  className,
  style,
  children,
  ref,
  ...props
}: FieldGroupDescriptionProps) {
  const merged = composeStyles({ className, style })
  return (
    <span
      {...props}
      ref={ref}
      data-part="description"
      className={merged.className || undefined}
      style={merged.style}
    >
      {children}
    </span>
  )
}

FieldGroupDescription.displayName = "FieldGroup.Description"

/**
 * The element a {@link FieldGroupRowProps.render row} should render instead of
 * its default `<div>`. Element-only, exactly {@link TextRender}'s shape and for
 * the same reason: a row publishes no state to branch on.
 *
 * `render={<label />}` makes the whole row the control's label, so a tap on the
 * text toggles the switch. `render={<Link to="…" />}` makes a navigation row.
 */
export type FieldGroupRowRender = ReactElement<{
  className?: string
  style?: CSSProperties
  children?: ReactNode
}>

/**
 * What a row hands to the element passed to `render`. The `data-*` index
 * signature lets the presence attributes live in a plain object.
 */
export type FieldGroupRowSlotProps = ComponentPropsWithRef<"div"> & {
  [attribute: `data-${string}`]: string | undefined
}

/**
 * Props for `FieldGroup.Row`. Extends native `<div>` props.
 *
 * `children` is the control, laid out trailing. `label` and `description` are
 * shorthand for `FieldGroup.Label` / `FieldGroup.Description` children, which
 * win when present. With none of the four, the row renders only its children.
 */
export interface FieldGroupRowProps extends ComponentPropsWithRef<"div"> {
  /** The row's title. Shorthand for a `<FieldGroup.Label>` child. */
  label?: ReactNode
  /** Secondary line under the title. Shorthand for a `<FieldGroup.Description>` child. */
  description?: ReactNode
  /**
   * Stamps `data-disabled` and `aria-disabled="true"` on the row, for the
   * consumer's `data-disabled:opacity-40`. It does NOT disable the control in
   * `children`; that control owns its own `disabled`.
   */
  disabled?: boolean
  /** Render something other than a `<div>`. → `docs/decisions/styling.md` §3.3. */
  render?: FieldGroupRowRender
}

function FieldGroupRow({
  label,
  description,
  disabled = false,
  render,
  className,
  style,
  children,
  ref,
  ...props
}: FieldGroupRowProps) {
  const {
    slotted: [labelSlot, descriptionSlot],
    rest: control,
  } = partitionSlots(children, [FieldGroupLabel, FieldGroupDescription])

  const titleNode =
    labelSlot ??
    (hasContent(label) ? <FieldGroupLabel>{label}</FieldGroupLabel> : null)
  const descriptionNode =
    descriptionSlot ??
    (hasContent(description) ? (
      <FieldGroupDescription>{description}</FieldGroupDescription>
    ) : null)

  //Text's composition rule: the render element's className/style and the row's
  //own are both the CONSUMER tier, merged rather than concatenated, the row's
  //last so it wins the per-property tie (§3.3).
  const merged = composeStyles({
    className: [render?.props.className, className],
    style: { ...render?.props.style, ...style },
    lockedStyle: FIELD_ROW_LOCKED_STYLE,
  })

  const slotProps: FieldGroupRowSlotProps = {
    ...props,
    ref,
    className: merged.className || undefined,
    style: merged.style,
    "data-adaptv": "field-group-row",
    "data-part": "row",
    //presence attribute (§3.1): `""`, never `true`, which React would stringify
    "data-disabled": disabled ? "" : undefined,
    "aria-disabled": disabled ? "true" : undefined,
  }

  const hasLabelColumn = titleNode !== null || descriptionNode !== null
  const content = (
    <>
      {hasLabelColumn ? (
        <div
          data-adaptv="field-group-label"
          data-part="label"
          style={FIELD_LABEL_LOCKED_STYLE}
        >
          {titleNode}
          {descriptionNode}
        </div>
      ) : null}
      {control}
    </>
  )

  if (render) {
    return cloneElement(render, slotProps, content)
  }

  return <div {...slotProps}>{content}</div>
}

FieldGroupRow.displayName = "FieldGroup.Row"

/* =============================================================================
 * Helper: grouped-list position, for rows built outside the component
 * ============================================================================= */

/** Where a row sits in its group, for the corner radii of a grouped list. */
export type FieldItemPosition = "leading" | "middle" | "trailing" | "only"

/**
 * Classify a row by its index in a group of `total`, for consumers building
 * rows of their own (a virtualised list, a table) where there is no
 * `[data-part="rows"]` box for `first:` / `last:` to read. Inside a Section
 * those variants already spell this; this is the same answer as a value.
 *
 * Pure. Throws a `RangeError` for a negative, non-integer or out-of-range
 * index, so a bad loop bound is a loud failure and not a row with no corners.
 */
export function getFieldItemPosition(
  index: number,
  total: number,
): FieldItemPosition {
  if (
    !Number.isInteger(index) ||
    !Number.isInteger(total) ||
    index < 0 ||
    index >= total
  ) {
    throw new RangeError(
      `getFieldItemPosition: index ${index} is not a position in a group of ${total}`,
    )
  }
  if (total === 1) return "only"
  if (index === 0) return "leading"
  if (index === total - 1) return "trailing"
  return "middle"
}

/* =============================================================================
 * Compound export
 * ============================================================================= */

/**
 * Grouped settings form. See the module comment above for the structure it
 * locks, the styling it leaves to `className`, and why there is no
 * `data-position`.
 */
export const FieldGroup = Object.assign(FieldGroupRoot, {
  Section: FieldGroupSection,
  Header: FieldGroupHeader,
  Footer: FieldGroupFooter,
  Row: FieldGroupRow,
  Label: FieldGroupLabel,
  Description: FieldGroupDescription,
})

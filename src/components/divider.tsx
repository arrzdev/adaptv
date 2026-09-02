import type {
  ComponentPropsWithRef,
  CSSProperties,
  ReactElement,
  ReactNode,
} from "react"
import { cloneElement } from "react"
import { mergeStyles } from "#adaptv/utils/styles"

/** Which way the rule runs — and therefore which edge carries the hairline. */
export type DividerOrientation = "horizontal" | "vertical"

/**
 * The element {@link Divider} should render instead of its default `<div>` — an `<li>`
 * between list items, say. Element-only, like {@link Text}'s: a rule has no content for a
 * function form to render. → `docs/decisions/styling.md §3.3`.
 */
export type DividerRender = ReactElement<{
  className?: string
  style?: CSSProperties
  children?: ReactNode
}>

/** What {@link Divider} hands to the element passed to `render`. */
export type DividerSlotProps = ComponentPropsWithRef<"div"> & {
  [attribute: `data-${string}`]: string | undefined
}

/**
 * Props for {@link Divider}. Extends native `<div>` props. Behaviour is props; the
 * colour, the inset and the spacing are `className`.
 */
export interface DividerProps extends ComponentPropsWithRef<"div"> {
  /** `"horizontal"` (the default) rules across; `"vertical"` rules down a flex row. */
  orientation?: DividerOrientation
  /**
   * A rule that only separates visually — between two chips, inside a toolbar — and
   * should not be announced. Renders `role="none"` and no orientation.
   */
  decorative?: boolean
  /** Render something other than a `<div>`. → `docs/decisions/styling.md §3.3`. */
  render?: DividerRender
}

//BASE: the theme's border colour, fully the consumer's to repaint. The rule is a BORDER,
//never a background — see the second quirk below — so `border-*` colour utilities are
//the vocabulary that repaints it and tailwind-merge's `border-color` group is what
//`border-red-500` beats this through.
const DIVIDER_BASE_CLASS = "border-border"
//LOCKED: nothing on the class tier, and that is a decision — the hairline's width, its
//edge and the vertical stretch live in styles/divider.css keyed on the identity attribute,
//where a consumer's className has no class to drop them against.
const DIVIDER_LOCKED_CLASS = undefined

/**
 * A hairline rule between things — and the three platform rules every hand-rolled
 * `<div className="h-px bg-gray-200">` gets wrong.
 *
 * ```tsx
 * <Divider />                                  // across, the theme's border colour
 * <Divider className="ms-4" />                 // inset from the leading edge, iOS-list style
 * <Divider orientation="vertical" />           // down a flex row; stretches to the row's height
 * <Divider decorative />                       // seen, not announced
 * <Divider render={<li />} />                  // as a list item, between list items
 * ```
 *
 * ## The three quirks it owns (the admission test, `docs/roadmap/component-gaps.md`)
 *
 * **1. A hairline is one DEVICE pixel, not one CSS pixel.** `1px` is three device pixels
 * on a 3x iPhone and two and a half on a Pixel — a rule the platform draws at a third of
 * that. A sub-pixel border width cannot say so — Chromium rounds anything under `1px` up
 * to a full CSS pixel, WebKit floors a third at 3x to nothing — so `styles/divider.css`
 * keeps a whole `1px` border and scales the element to one device pixel with a
 * transform, `scaleY(1 / floor(dpr))` — the floor because both engines first snap a `1px`
 * border down to whole device pixels — from `min-resolution` buckets the stylesheet
 * answers before the first paint. The rule takes 1 CSS px in layout; only the paint thins.
 *
 * **2. It is a border, not a background.** Under forced colours (`forced-colors: active`)
 * the engine replaces every author background with `Canvas`, so a `bg-*` rule vanishes
 * and two sections read as one. A border is recoloured to `CanvasText` instead, and
 * stays visible on whatever palette the user chose. Recolour it with `border-*`.
 *
 * **3. It says what it is.** `role="separator"` by default, with `aria-orientation`
 * when vertical (horizontal is the ARIA default and is left unsaid); `decorative` turns
 * both off for a rule that is only a look.
 *
 * ## Tiers
 *
 * | Tier | Classes | Why |
 * |------|---------|-----|
 * | base | `border-border` | the colour; repaint it with any `border-*` colour |
 * | className | yours | inset (`ms-4`), spacing (`my-2`), colour |
 * | locked | — | width, edge and stretch are CSS on `data-adaptv`, not classes |
 *
 * There is no `inset` prop and no `thickness` prop (`docs/decisions/styling.md §5.4.1`):
 * an inset is `ms-4`, and a thicker rule is not a hairline.
 *
 * | Attribute | When |
 * |-----------|------|
 * | `data-adaptv="divider"` | always |
 * | `data-orientation="vertical"` | vertical |
 * | `role="separator"` / `aria-orientation="vertical"` | unless `decorative` |
 * | `role="none"` | `decorative` |
 */
export function Divider({
  orientation = "horizontal",
  decorative = false,
  render,
  className,
  style,
  children,
  ref,
  ...props
}: DividerProps) {
  const merged = mergeStyles({
    base: DIVIDER_BASE_CLASS,
    className: [render?.props.className, className],
    locked: DIVIDER_LOCKED_CLASS,
    style: { ...render?.props.style, ...style },
  })

  const vertical = orientation === "vertical"
  const slotProps: DividerSlotProps = {
    ...props,
    ref,
    className: merged.className,
    style: merged.style,
    "data-adaptv": "divider",
    "data-orientation": vertical ? "vertical" : undefined,
    role: decorative ? "none" : "separator",
    "aria-orientation": !decorative && vertical ? "vertical" : undefined,
  }

  //A rule has nothing inside it. A `render` element keeps its own children; Divider
  //adds none and drops any it was given, so a stray child cannot give the hairline a height.
  if (render) return cloneElement(render, slotProps)

  return <div {...slotProps} />
}

Divider.displayName = "Divider"

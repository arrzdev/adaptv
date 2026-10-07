import type {
  ComponentPropsWithRef,
  CSSProperties,
  ReactElement,
  ReactNode,
} from "react"
import { cloneElement } from "react"
import { composeStyles } from "#adaptv/utils/styles"

/**
 * The element {@link Skeleton} should render instead of its default `<div>` — a
 * `<span>` inside a line of text, an `<li>` in a list. → `docs/decisions/styling.md §3.3`
 * (a prop, not `asChild`).
 *
 * **Element-only, like {@link Text}'s.** The function form of `render` earns its keep
 * by rendering state-dependent *content*, and a placeholder has no content: it is a
 * shape, and every prop it takes is already expressible on the element you pass in.
 */
export type SkeletonRender = ReactElement<{
  className?: string
  style?: CSSProperties
  children?: ReactNode
}>

/**
 * What {@link Skeleton} hands to the element passed to `render`. The `data-*` index
 * signature is what lets the attributes below live in a plain object rather than only
 * in JSX.
 */
export type SkeletonSlotProps = ComponentPropsWithRef<"div"> & {
  [attribute: `data-${string}`]: string | undefined
}

/**
 * Props for {@link Skeleton}. Extends native `<div>` props, so it drops in anywhere a
 * `<div>` would. Behaviour is props; look — the shape and the size — is `className`.
 */
export interface SkeletonProps extends ComponentPropsWithRef<"div"> {
  /**
   * Whether to show the placeholder. `true` by default, so a bare `<Skeleton />` is a
   * box. `false` renders `children` exactly as written — no element, no wrapper, no
   * attribute — so the loaded tree is the tree you would have rendered without this
   * component at all.
   */
  loading?: boolean
  /** Render something other than a `<div>`. → `docs/decisions/styling.md §3.3`. */
  render?: SkeletonRender
}

/**
 * Props for {@link Skeleton.Region}. Extends native `<div>` props.
 */
export interface SkeletonRegionProps extends ComponentPropsWithRef<"div"> {
  /**
   * Whether the region's content is still arriving. Required rather than defaulted:
   * a region exists to publish this one bit to assistive technology, so there is no
   * sensible value to assume.
   */
  loading: boolean
  /**
   * What a screen reader hears when the region starts loading — once, for the whole
   * region, however many placeholder rows it holds. Defaults to `"Loading"`; say what
   * is loading (`"Loading tasks"`) when the screen has more than one region.
   */
  label?: string
}

//The neutral placeholder look (`border-radius: var(--radius-md)`, a gray-200 fill) and
//the region's visually-hidden status line are default rules in styles/skeleton.css,
//keyed on `data-adaptv` / `data-part` — the "why" of each value is recorded there.
//Nothing is locked, and that is a decision — see the note at the `composeStyles` call.

/**
 * A placeholder box for content that has not arrived — and the three platform rules
 * every hand-rolled `<div className="animate-pulse">` gets wrong.
 *
 * ```tsx
 * <Skeleton className="h-4 w-40 rounded-md" />
 *
 * <Skeleton loading={isLoading} className="h-4 w-40">
 *   <Text>{task.title}</Text>          // loading=false: rendered as-is, no wrapper
 * </Skeleton>
 *
 * <Skeleton.Region loading={isLoading} label="Loading tasks">
 *   {rows}                              // announced ONCE, however many rows shimmer
 * </Skeleton.Region>
 * ```
 *
 * ## The three quirks it owns (the admission test, `docs/roadmap/component-gaps.md`)
 *
 * **1. `prefers-reduced-motion` stops the shimmer before the first paint.** The
 * pulse is a `@keyframes` rule in `styles/skeleton.css`, and the reduced-motion
 * `animation: none` sits beside it as a `@media` rule — NOT the `useReducedMotion`
 * hook. That hook is `false` on the server and during hydration, so a class it
 * toggled would ship an animated frame to the one user who asked for none, and then
 * mismatch. The stylesheet has no such gap: the engine answers the query on the first
 * style resolution, with no JavaScript in the loop.
 *
 * **2. Forced colors paint a background-only box as nothing.** Under Windows High
 * Contrast (`forced-colors: active`) the engine swaps every author background for
 * `Canvas`, so a skeleton that is only a `bg-*` vanishes and the layout reads as empty
 * rather than loading. The box carries `forced-color-adjust: none` and, in that mode,
 * a `1px solid CanvasText` border — the system text colour, guaranteed visible on
 * whatever palette the user chose.
 *
 * **3. Assistive technology hears the state once, not per row.** The box is
 * `aria-hidden="true"`: a screen reader that read a list of empty pulsing divs would
 * announce twenty nothings. What announces is {@link Skeleton.Region}: it marks its
 * subtree `aria-busy` while loading and speaks `label` through a polite live region —
 * one sentence for the whole region, however many rows are inside it.
 *
 * ## Tiers
 *
 * | Tier | Where | What |
 * |------|-------|------|
 * | default | styles/skeleton.css | `border-radius: var(--radius-md)`, a gray-200 fill — the neutral look; repaint it freely |
 * | className | yours | the SHAPE and the SIZE — `h-4 w-40`, `rounded-full`, `size-12` |
 * | locked | — | see below |
 *
 * There is no shape prop and no size prop (`docs/decisions/styling.md §5.4.1`): a
 * circle is `rounded-full`, a line is `h-4 w-40`, and Tailwind already spells both.
 *
 * The animation and the forced-colors rules are not locked inline style either. They
 * are CSS on the identity attribute (`§2`'s escape hatch), because all three are
 * `@media` conditions the stylesheet must answer without React. A consumer who wants a still
 * placeholder writes `animate-none`; `utilities` is a later layer than adaptv's, so
 * it wins, and that is deliberate.
 *
 * | Attribute | On | When |
 * |-----------|----|------|
 * | `data-adaptv="skeleton"` + `data-part="root"` | the box | while loading |
 * | `aria-hidden="true"` | the box | while loading |
 * | `data-adaptv="skeleton-region"` + `data-part="root"` | the region | always |
 * | `data-adaptv="skeleton-region-status"` + `data-part="status"` | the live region inside it | always |
 * | `aria-busy="true"` | the region | while loading |
 *
 * ⚠︎ **`loading={false}` renders no element.** `className`, `style`, `ref` and every
 * other prop on the box are dropped with it — the children are returned as written.
 * Put the loaded look on the children, not on the `Skeleton`.
 */
function SkeletonRoot({
  loading = true,
  render,
  className,
  style,
  children,
  ref,
  ...props
}: SkeletonProps) {
  //The loaded tree is the consumer's own, untouched: a wrapper here would be one more
  //flex child for every line of text on the page, and a `contents` div is a wrapper
  //that only PRETENDS not to be one (it still breaks `:only-child`, still carries
  //the props nowhere). A fragment is the honest shape.
  if (!loading) return <>{children}</>

  //An element passed to `render` carries its own className/style, written at the
  //same call site as Skeleton's own — both are the CONSUMER tier. §3.3: the two class
  //lists are joined, the render element's first, and nothing of adaptv's is in the
  //join. Skeleton's own `style` goes last, so it wins the per-property tie — Base
  //UI's order, and the more local of the two.
  //
  //No `lockedStyle`, EXPLICITLY (B8, style-precedence.test.tsx): the only structural
  //styling — the pulse, its reduced-motion stop, the forced-colors outline — lives in
  //styles/skeleton.css keyed on `data-adaptv`, so there is nothing here that a
  //consumer's className could accidentally cancel.
  const merged = composeStyles({
    className: [render?.props.className, className],
    style: { ...render?.props.style, ...style },
  })

  const slotProps: SkeletonSlotProps = {
    ...props,
    ref,
    className: merged.className || undefined,
    style: merged.style,
    "data-adaptv": "skeleton",
    "data-part": "root",
    //A placeholder has nothing to say. Twenty of them in a list would otherwise be
    //twenty "group" or "blank" announcements; the REGION speaks, once.
    "aria-hidden": "true",
  }

  //The box never renders `children` — they are the LOADED content, and showing them
  //inside the placeholder would leak the very thing the skeleton stands in for. A
  //`render` element keeps its own children (an icon glyph, say); Skeleton adds none.
  if (render) return cloneElement(render, slotProps)

  return <div {...slotProps} />
}

SkeletonRoot.displayName = "Skeleton"

/**
 * The element that speaks for a group of skeletons — see the third quirk on
 * {@link Skeleton}. Marks its subtree `aria-busy` while `loading` and announces
 * `label` once through a polite live region. `children` render in both states, so
 * the region is a stable wrapper around the rows, loading or loaded.
 *
 * The live region is mounted in BOTH states and only its TEXT changes. A screen
 * reader announces changes to an existing live region; a region that mounts with its
 * text already inside is not reliably read at all — so a `{loading && <output>}`
 * would be silent exactly when it mattered. Emptying it on load is announced as
 * nothing, which is the intent: the content itself is the news.
 */
function SkeletonRegion({
  loading,
  label = "Loading",
  children,
  ...props
}: SkeletonRegionProps) {
  return (
    <div
      {...props}
      data-adaptv="skeleton-region"
      data-part="root"
      //`undefined` rather than `false`: React would stringify to `aria-busy="false"`,
      //which is a value assistive technology has to parse. Absent is the resting state.
      aria-busy={loading || undefined}
    >
      {/* `<output>` IS `role="status"` (implicitly `aria-live="polite"`) — the
          semantic element, rather than a span wearing the role. */}
      <output data-adaptv="skeleton-region-status" data-part="status">
        {loading ? label : null}
      </output>
      {children}
    </div>
  )
}

SkeletonRegion.displayName = "Skeleton.Region"

const SkeletonCompound = Object.assign(SkeletonRoot, {
  Region: SkeletonRegion,
})

export { SkeletonCompound as Skeleton }

import type { ComponentPropsWithRef, CSSProperties, Ref } from "react"
import { useCallback, useRef } from "react"
import { TOUCH_PASSTHROUGH_CLASS } from "#adaptv/components/press-core"
import { useScrollEdgeFade } from "#adaptv/hooks/use-scroll-edge-fade"
import { mergeStyles } from "#adaptv/utils/styles"

/* =============================================================================
 * TYPES
 * ============================================================================= */

/**
 * Props for {@link ScrollView}. Extends native `<div>` props (`className`,
 * `style`, `ref`, `onScroll`, `data-*`, …) so it drops in anywhere a scrollable
 * `<div>` would. The boolean axis + behavior flags mirror React Native /
 * Expo's `ScrollView`.
 */
export interface ScrollViewProps extends ComponentPropsWithRef<"div"> {
  /** Scroll horizontally instead of vertically (RN `horizontal`). Default `false`. */
  horizontal?: boolean
  /**
   * Grow to fill the parent flex line — `flex-1`. Default `false`, matching
   * {@link View}.
   *
   * **Not needed at a page's root.** The shell stretches a route's only root element
   * (`styles/screen.css`), so `<ScrollView>` alone fills the screen and scrolls. Reach
   * for `fill` when the scroller is one of SEVERAL children of a flex parent and it is
   * the one that should absorb the leftover space.
   *
   * ⚠︎ A scroller only scrolls if something constrains its height, and there are
   * exactly two ways to get that: fill a sized flex parent, or be given an explicit
   * height. Picking one for the consumer silently defeats the other — this used to
   * be an unconditional `flex-1`, and `<ScrollView className="h-40">` then rendered
   * at its content height and did not scroll at all. `flex-grow` and `height` are
   * different properties, so tailwind-merge cannot see the conflict and the
   * three-layer contract never fires; the `className` simply loses in the cascade.
   * Making it a prop is the same fix `View` already had (`VISION.md` L6 — behaviour
   * is props, presentation is className).
   */
  fill?: boolean
  /** Allow scrolling; `false` clips instead (RN `scrollEnabled`). Default `true`. */
  scrollEnabled?: boolean
  /** Show the vertical scrollbar (RN `showsVerticalScrollIndicator`). Default `false` — a
   * scrollbar is desktop-browser chrome, and the whole point of this layer is that the
   * same code feels native on every target. Opt in per scroller when the indicator is
   * genuinely informative (a long settings pane on desktop). Beats `ui.hideScrollbars`. */
  showsVerticalScrollIndicator?: boolean
  /** Show the horizontal scrollbar (RN `showsHorizontalScrollIndicator`). Default `false`. */
  showsHorizontalScrollIndicator?: boolean
  /**
   * Dissolve the content at the scroller's edges, so it reads as continuing past
   * the frame instead of being chopped off. Default `false`.
   *
   * `true` fades both ends; `"start"` and `"end"` fade one. The names are LOGICAL to
   * the scroll axis — on a vertical scroller `start` is the top, on a horizontal one
   * it is the inline start (the left in LTR, the right in RTL) — so the same prop
   * reads correctly in both orientations and both writing directions. That is the
   * split SwiftUI's `scrollEdgeEffectStyle(_:for:)` and shadcn's `scroll-fade-s/-e`
   * both landed on; Android and React Native only ever offered all-or-nothing.
   *
   * **Each end fades only while there is content that way.** Parked at the top, the
   * top fade is off and the first row is fully crisp; it ramps to full strength over
   * the first 24px of scroll. Without that a tall fade permanently greys out the
   * content you are looking at, which is why the depth had to stay small before.
   *
   * Depth is {@link ScrollViewProps.fadeSize}.
   *
   * There is no colour, deliberately — this masks the content rather than painting a
   * band over it, so whatever is behind the scroller shows through and there is no
   * colour to keep in sync with the theme. See `styles/scroll-fade.css`.
   */
  fade?: boolean | "start" | "end"
  /**
   * How deep the fade reaches. Any CSS length or percentage — `"3rem"`, `"10%"`,
   * `"48px"`. Default `2rem`.
   *
   * This is the whole depth API. There is no companion class and no variable to
   * learn: a consumer should not have to know that the mask reads `--fade-length`
   * any more than they have to know it is a mask at all. If a depth that changes
   * with a breakpoint ever turns out to be a real need, it belongs here as a typed
   * value — not as a class name to guess.
   */
  fadeSize?: string
}

/* =============================================================================
 * CLASSES
 * ============================================================================= */

const SCROLL_VIEW_BASE_CLASS = "flex min-h-0 min-w-0"
//Direction is unconditional; GROWTH is the `fill` prop. Keeping `flex-1` here
//meant a consumer height could never win — see the `fill` docblock.
const SCROLL_VIEW_COLUMN_CLASS = "flex-col"
const SCROLL_VIEW_FILL_CLASS = "flex-1"

/* =============================================================================
 * ROOT
 * ============================================================================= */

/**
 * Managed scroll surface for the native-feel viewport contract (the document
 * never scrolls; panes do) — reach for this instead of a `<div className=
 * "scrollable-y">`. Sets the directional `scrollable-*` utility for you, opts
 * hides scrollbars on request, and dissolves the edges on request — all on a
 * plain, fully styleable `<div>`.
 *
 * Neutral Tier-1: no brand padding, max-width, or background — wrap it (`Page`,
 * a chip row, …) to add those.
 *
 * @example
 * ```tsx
 * <ScrollView className="px-6">{rows}</ScrollView>
 * <ScrollView horizontal className="gap-x-2">{chips}</ScrollView>
 * <ScrollView fade fadeSize="3rem">{content}</ScrollView>
 * <ScrollView horizontal fade="end">{chips}</ScrollView>
 * ```
 */
export function ScrollView({
  horizontal = false,
  fill = false,
  scrollEnabled = true,
  showsVerticalScrollIndicator = false,
  showsHorizontalScrollIndicator = false,
  fade = false,
  fadeSize,
  className,
  style,
  children,
  ref,
  ...props
}: ScrollViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const axis = horizontal ? "x" : "y"

  const fadeStart = fade === true || fade === "start"
  const fadeEnd = fade === true || fade === "end"
  useScrollEdgeFade(scrollRef, fadeStart || fadeEnd, {
    start: fadeStart,
    end: fadeEnd,
    horizontal,
  })

  // forward the consumer ref while keeping our own handle on the scroll node
  const mergeRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node
      assignRef(ref, node)
    },
    [ref],
  )

  /*
   * The prop owns the indicator in BOTH directions, which is why there are two
   * utilities rather than one. `ui.hideScrollbars` hides scrollbars app-wide from
   * `adaptv.reset`; a component that could only ever ADD `scrollbar-hidden` had no
   * way to say "show mine" once that reset had spoken, so the prop worked in a
   * browser tab and did nothing at all in an installed PWA. `scrollbar-visible`
   * compiles into Tailwind's `utilities` layer, which outranks `adaptv.reset`.
   */
  const showIndicator = horizontal
    ? showsHorizontalScrollIndicator
    : showsVerticalScrollIndicator
  const scrollbarClass = showIndicator
    ? "scrollbar-visible"
    : "scrollbar-hidden"

  /*
   * Raw Tailwind, not a `scrollable-*` utility of our own.
   *
   * The three `touch-*` classes each set one `--tw-*` var and share one `touch-action`
   * declaration, so together they emit exactly the `pan-x pan-y pinch-zoom` longhand
   * the old utility hard-coded. The win is not brevity — it is that tailwind-merge
   * already OWNS these groups. A consumer's `overflow-hidden` conflicts with
   * `overflow-y-auto` natively, so the `locked` tier resolves it without the
   * hand-written `conflictingClassGroups` table the custom utility needed, and without
   * anyone having to remember to keep that table in step with the CSS.
   */
  const scrollClass = !scrollEnabled
    ? "overflow-hidden"
    : horizontal
      ? [
          "overflow-x-auto",
          "overflow-y-hidden",
          "overscroll-x-contain",
          TOUCH_PASSTHROUGH_CLASS,
        ]
      : [
          "overflow-y-auto",
          "overflow-x-hidden",
          "overscroll-y-contain",
          TOUCH_PASSTHROUGH_CLASS,
        ]

  //`scrollClass` is LOCKED, not base: the scroll axis is owned by the `horizontal`
  //and `scrollEnabled` PROPS (L6 — behaviour is props, presentation is className),
  //so a consumer's `overflow-hidden` must not be able to silently defeat it. The
  //failure is invisible until someone cannot scroll.
  const scrollNodeClass = mergeStyles({
    base: [
      SCROLL_VIEW_BASE_CLASS,
      !horizontal && SCROLL_VIEW_COLUMN_CLASS,
      fill && SCROLL_VIEW_FILL_CLASS,
    ],
    className,
    locked: [scrollClass, scrollbarClass],
  })

  return (
    <div
      ref={mergeRef}
      data-scroll-view={axis}
      //the component the CONSUMER wrote; a composing primitive (List) overrides it
      //by passing its own, which is why this sits ahead of the `{...props}` spread
      data-adaptv="scroll-view"
      //presence + which ends, so the mask rule has a hook and a test has something
      //to read; the STRENGTHS are custom properties written by the hook (STYLING.md
      //§3 — enumerable state is an attribute, measured scalars are variables)
      data-fade={
        fade === true ? "both" : fade === false ? undefined : fade
      }
      className={scrollNodeClass}
      //the consumer's own `style` still wins over the depth, because a caller who
      //writes the variable by hand has been more specific than one who passed a prop
      style={
        fadeSize === undefined
          ? style
          : ({ "--fade-length": fadeSize, ...style } as CSSProperties)
      }
      {...props}
    >
      {children}
    </div>
  )
}

function assignRef(
  ref: Ref<HTMLDivElement> | undefined,
  node: HTMLDivElement | null,
) {
  if (typeof ref === "function") {
    ref(node)
    return
  }
  if (ref) ref.current = node
}

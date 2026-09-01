import type { ComponentPropsWithRef, CSSProperties, Ref } from "react"
import { useCallback, useRef } from "react"
import { TOUCH_PASSTHROUGH_CLASS } from "#adaptv/components/press-core"
import { useScrollEdgeFade } from "#adaptv/hooks/use-scroll-edge-fade"
import { mergeStyles } from "#adaptv/utils/styles"

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

const SCROLL_VIEW_BASE_CLASS = "flex min-h-0 min-w-0"
//Direction is unconditional; GROWTH is the `fill` prop. Keeping `flex-1` here
//meant a consumer height could never win — see the `fill` docblock.
const SCROLL_VIEW_COLUMN_CLASS = "flex-col"
const SCROLL_VIEW_FILL_CLASS = "flex-1"

/**
 * Managed scroll surface for the native-feel viewport contract (the document
 * never scrolls; panes do) — reach for this instead of hand-rolling a scrolling
 * `<div>`. It owns the scroll axis (and pins the cross one), contains the
 * overscroll, keeps touch panning alive on both axes, hides scrollbars on
 * request, and dissolves the edges on request — all on a plain, fully styleable
 * `<div>`. The `scrollClass` comment below is why each of those is not optional.
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
   * Raw Tailwind, not a scroll utility of our own — and every class here is
   * load-bearing. This used to be a pair of `@utility` rules in `styles/utils.css`;
   * the reasoning moved here with them.
   *
   * WHY RAW TAILWIND. The three `touch-*` classes each set one `--tw-*` var and share
   * one `touch-action` declaration, so together they emit exactly the
   * `pan-x pan-y pinch-zoom` longhand the old utility hard-coded. The win is not
   * brevity — it is that tailwind-merge already OWNS these groups. A consumer's
   * `overflow-hidden` conflicts with `overflow-y-auto` natively, so the `locked` tier
   * resolves it without the hand-written `conflictingClassGroups` table the custom
   * utility needed, and without anyone having to remember to keep that table in step
   * with the CSS.
   *
   * WHY THE CROSS AXIS IS PINNED `hidden`. Setting overflow on one axis forces the
   * other from `visible` to `auto` (CSS overflow spec), so a single-axis scroller that
   * only names its own axis silently becomes scrollable both ways — a child that
   * overflows the cross axis then rubber-bands the container off-axis. `hidden` clips
   * identically to the implicit `auto` but kills the stray scroll.
   *
   * WHY `touch-action` ALLOWS BOTH PAN AXES. This looks wrong and is not. It was once
   * single-axis (`pan-x` horizontal, `pan-y` vertical), which reads as obviously
   * correct and is a serious bug: `touch-action` restricts the WHOLE gesture that
   * starts on the element, not just that element's own scrolling. A horizontal strip
   * with `pan-x` therefore made a vertical swipe starting on it scroll NOTHING — not
   * the strip, not the page behind it. Measured with CDP touch injection
   * (`playground/e2e/scroll-axis.spec.ts`): page moved 0px with `pan-x`, 195px with
   * both axes. Allowing both costs no cross-axis bleed, because the browser performs
   * directional lock itself — same measurement, diagonal drag dominated by horizontal:
   * the strip moved 200px and the page moved 0. That is why adaptv has no JS
   * directional lock; it had one, it was iOS-only, and it solved a problem the platform
   * had already solved while this CSS created a worse one. The longhand rather than
   * `manipulation` is WebKit 240917 — see TOUCH_PASSTHROUGH_CLASS in `press-core.ts`.
   *
   * WHY THERE IS NO LAYER-PROMOTION HINT. Deliberately no `will-change`, no
   * `translate3d`. Both target engines already composite every scroller: WebKit
   * accelerates all `overflow: scroll` since Safari 13 / iOS 13 (which is why
   * `-webkit-overflow-scrolling: touch` became a no-op), and Chromium's scroll
   * unification hands every scroller to the compositor in `cc/input`. So a hint buys a
   * layer the scroller already has, and pays for it: any of `will-change: transform` /
   * `transform` / `perspective` / `backface-visibility` makes the scroller a containing
   * block for its `position: fixed` and `absolute` descendants (css-transforms-1 §3,
   * css-will-change §2) — a fixed child inside a scroller stops being fixed. Ionic goes
   * further and documents that `translate3d` on a scroll container DEFEATS WebKit's
   * layer-backing-sharing optimisation and degrades scrolling (WebKit bug 216701); they
   * use `z-index: 0` instead. → docs/design/performance-boost.md, guarded by `styles/utils.test.ts`.
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
      //to read; the STRENGTHS are custom properties written by the hook (docs/decisions/styling.md
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

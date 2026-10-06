import type { ComponentPropsWithRef, CSSProperties, Ref } from "react"
import { useCallback, useRef } from "react"
import { TOUCH_PASSTHROUGH_STYLE } from "#adaptv/components/press-core"
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

/*
 * The scroll lock, as inline style (docs/decisions/styling.md §2.0) — every declaration
 * here is load-bearing. This used to be a pair of `@utility` rules in `styles/utils.css`,
 * then raw Tailwind classes on the `locked` tier; the reasoning moved with it.
 *
 * WHY INLINE. The scroll axis is owned by the `horizontal` and `scrollEnabled` PROPS
 * (L6 — behaviour is props, presentation is className), so a consumer's
 * `overflow-hidden` must not be able to silently defeat it; the failure is invisible
 * until someone cannot scroll. Inline style is the one author tier above an unlayered
 * consumer class, so the lock holds whatever dialect the consumer styles in, and
 * object spread resolves it per property with no conflict table to keep in step.
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
 * `manipulation` is WebKit 240917 — see TOUCH_PASSTHROUGH_STYLE in `press-core.ts`.
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
 *
 * WHY THE INDICATOR IS LOCKED IN BOTH DIRECTIONS. The prop owns it either way.
 * `ui.hideScrollbars` hides scrollbars app-wide from `adaptv.reset`; a component that
 * could only ever HIDE had no way to say "show mine" once that reset had spoken, so the
 * prop worked in a browser tab and did nothing at all in an installed PWA. Inline
 * `scrollbar-width` beats the reset outright; the `::-webkit-scrollbar` half is a
 * pseudo-element inline style cannot reach, so it is a rule in styles/scroll-view.css
 * keyed on `data-scroll-view` and `data-scroll-view-indicator`, in a later layer than
 * the reset.
 */
type ScrollMode = "x" | "y" | "off"

const SCROLL_MODE_STYLE: Record<ScrollMode, CSSProperties> = {
  x: {
    overflowX: "auto",
    overflowY: "hidden",
    overscrollBehaviorX: "contain",
    ...TOUCH_PASSTHROUGH_STYLE,
  },
  y: {
    overflowY: "auto",
    overflowX: "hidden",
    overscrollBehaviorY: "contain",
    ...TOUCH_PASSTHROUGH_STYLE,
  },
  //`scrollEnabled={false}`: clipped on both axes, and a consumer cannot force
  //scrolling back on either
  off: { overflowX: "hidden", overflowY: "hidden" },
}

/** Every lock a ScrollView can carry, built once so React never sees a new object per render. */
const SCROLL_LOCKED_STYLE: Record<
  ScrollMode,
  Record<"shown" | "hidden", CSSProperties>
> = Object.freeze(
  Object.fromEntries(
    (Object.keys(SCROLL_MODE_STYLE) as ScrollMode[]).map((mode) => [
      mode,
      Object.freeze({
        shown: Object.freeze({
          ...SCROLL_MODE_STYLE[mode],
          scrollbarWidth: "auto",
        }),
        hidden: Object.freeze({
          ...SCROLL_MODE_STYLE[mode],
          scrollbarWidth: "none",
        }),
      }),
    ]),
  ) as Record<ScrollMode, Record<"shown" | "hidden", CSSProperties>>,
)

/**
 * Managed scroll surface for the native-feel viewport contract (the document
 * never scrolls; panes do) — reach for this instead of hand-rolling a scrolling
 * `<div>`. It owns the scroll axis (and pins the cross one), contains the
 * overscroll, keeps touch panning alive on both axes, hides scrollbars on
 * request, and dissolves the edges on request — all on a plain, fully styleable
 * `<div>`. The `SCROLL_MODE_STYLE` comment above is why each of those is not optional.
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

  const showIndicator = horizontal
    ? showsHorizontalScrollIndicator
    : showsVerticalScrollIndicator
  const mode: ScrollMode = !scrollEnabled ? "off" : axis

  const merged = mergeStyles({
    className,
    //the depth is a default the consumer's own `style` still wins over, because a
    //caller who writes the variable by hand has been more specific than one who
    //passed a prop
    baseStyle:
      fadeSize === undefined
        ? undefined
        : ({ "--fade-length": fadeSize } as CSSProperties),
    style,
    lockedStyle:
      SCROLL_LOCKED_STYLE[mode][showIndicator ? "shown" : "hidden"],
  })

  return (
    <div
      ref={mergeRef}
      data-scroll-view={axis}
      //the component the CONSUMER wrote; a composing primitive (List) overrides it
      //by passing its own, which is why this sits ahead of the `{...props}` spread
      data-adaptv="scroll-view"
      data-part="root"
      //the props as presence attributes, for the default rule (`fill`) and the
      //`::-webkit-scrollbar` half of the indicator lock (styles/scroll-view.css)
      data-scroll-view-fill={fill ? "" : undefined}
      data-scroll-view-indicator={showIndicator ? "" : undefined}
      //presence + which ends, so the mask rule has a hook and a test has something
      //to read; the STRENGTHS are custom properties written by the hook (docs/decisions/styling.md
      //§3 — enumerable state is an attribute, measured scalars are variables)
      data-fade={
        fade === true ? "both" : fade === false ? undefined : fade
      }
      className={merged.className || undefined}
      style={merged.style}
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

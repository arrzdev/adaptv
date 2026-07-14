import type { ComponentPropsWithRef, CSSProperties, Ref } from "react"
import { useCallback, useRef } from "react"
import { useScrollDirectionLock } from "#nativ/hooks/use-scroll-direction-lock"
import { cn } from "#nativ/utils/cn"

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
  /** Allow scrolling; `false` clips instead (RN `scrollEnabled`). Default `true`. */
  scrollEnabled?: boolean
  /**
   * Lock dragging to the dominant axis so a diagonal gesture doesn't bleed into
   * the cross axis — the native-feel heavy lifting (RN `directionalLockEnabled`,
   * iOS-only effect; no-op elsewhere). See {@link useScrollDirectionLock}.
   * Default `false` (matches RN) — opt in per surface, or flip app-wide once
   * tuned on a real device.
   */
  directionalLockEnabled?: boolean
  /** Show the vertical scrollbar (RN `showsVerticalScrollIndicator`). Default `true`. */
  showsVerticalScrollIndicator?: boolean
  /** Show the horizontal scrollbar (RN `showsHorizontalScrollIndicator`). Default `true`. */
  showsHorizontalScrollIndicator?: boolean
  /**
   * Soft fade masks at the top and bottom edges so content dissolves under the
   * safe areas (package extra, not RN). Vertical only; ignored when `horizontal`.
   * Default `false`.
   */
  edgeFades?: boolean
  /** Brand background utilities for the fade bands (e.g. `bg-background`). */
  edgeClassName?: string
}

/* =============================================================================
 * CLASSES
 * ============================================================================= */

const SCROLL_VIEW_BASE_CLASS = "flex min-h-0 min-w-0"
const SCROLL_VIEW_COLUMN_CLASS = "flex-1 flex-col"

const EDGE_FADE_WRAPPER_CLASS =
  "relative flex min-h-0 min-w-0 w-full flex-1 flex-col"
const EDGE_FADE_BAND_CLASS = "pointer-events-none absolute inset-x-0 z-20"

// One soft fade band sized to the top safe-area inset, so it fades content exactly
// under the status-bar region and stops at the content's top padding
// (`p-safe-offset-2` = inset + 0.5rem) — never over the page header.
//
// The old `max(2rem, …)` floor assumed a large inset (iOS notch). On Android an
// installed PWA's status bar is a separate strip, so `env(safe-area-inset-top)` is
// 0 and the floor forced a 32px band that sat ON TOP of the title + action buttons
// (they render ~8px from the top). Tracking the inset (+0.5rem to match the content
// padding) keeps iOS unchanged and shrinks the band to a soft ~8px edge on Android,
// clear of the header.
const TOP_FADE_HEIGHT =
  "web:h-4 app:h-[calc(env(safe-area-inset-top,0px)+0.5rem)]"
const BOTTOM_FADE_HEIGHT =
  "web:h-[calc(env(safe-area-inset-bottom,0px)+1.125rem)] app:h-[calc(env(safe-area-inset-bottom,0px)+0.625rem)]"

const smoothMask: CSSProperties = {
  maskSize: "100% 100%",
  WebkitMaskSize: "100% 100%",
}

const topEdgeMask: CSSProperties = {
  ...smoothMask,
  maskImage:
    "linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.82) 35%, rgba(0,0,0,0.48) 65%, transparent 100%)",
  WebkitMaskImage:
    "linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.82) 35%, rgba(0,0,0,0.48) 65%, transparent 100%)",
}

const bottomEdgeMask: CSSProperties = {
  ...smoothMask,
  maskImage:
    "linear-gradient(to top, #000 0%, #000 10%, rgba(0,0,0,0.9) 32%, rgba(0,0,0,0.58) 60%, rgba(0,0,0,0.22) 84%, transparent 100%)",
  WebkitMaskImage:
    "linear-gradient(to top, #000 0%, #000 10%, rgba(0,0,0,0.9) 32%, rgba(0,0,0,0.58) 60%, rgba(0,0,0,0.22) 84%, transparent 100%)",
}

/* =============================================================================
 * ROOT
 * ============================================================================= */

/**
 * Managed scroll surface for the native-feel viewport contract (the document
 * never scrolls; panes do) — reach for this instead of a `<div className=
 * "scrollable-y">`. Sets the directional `scrollable-*` utility for you, opts
 * into the iOS directional lock, hides scrollbars on request, and (vertically)
 * masks the safe-area edges — all on a plain, fully styleable `<div>`.
 *
 * Neutral Tier-1: no brand padding, max-width, or background — wrap it (`Page`,
 * a chip row, …) to add those.
 *
 * @example
 * ```tsx
 * <ScrollView className="px-6">{rows}</ScrollView>
 * <ScrollView horizontal className="gap-x-2">{chips}</ScrollView>
 * <ScrollView edgeFades edgeClassName="bg-background">{content}</ScrollView>
 * ```
 */
export function ScrollView({
  horizontal = false,
  scrollEnabled = true,
  directionalLockEnabled = false,
  showsVerticalScrollIndicator = true,
  showsHorizontalScrollIndicator = true,
  edgeFades = false,
  edgeClassName,
  className,
  children,
  ref,
  ...props
}: ScrollViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const axis = horizontal ? "x" : "y"

  useScrollDirectionLock(scrollRef, {
    axis,
    enabled: directionalLockEnabled && scrollEnabled,
  })

  // forward the consumer ref while keeping our own handle on the scroll node
  const mergeRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node
      assignRef(ref, node)
    },
    [ref],
  )

  const hideScrollbar = horizontal
    ? !showsHorizontalScrollIndicator
    : !showsVerticalScrollIndicator

  const scrollClass = !scrollEnabled
    ? "overflow-hidden"
    : horizontal
      ? "scrollable-x"
      : "scrollable-y"

  const scrollNodeClass = cn(
    SCROLL_VIEW_BASE_CLASS,
    !horizontal && SCROLL_VIEW_COLUMN_CLASS,
    scrollClass,
    hideScrollbar && "scrollbar-hidden",
    className,
  )

  if (edgeFades && !horizontal) {
    return (
      <div className={EDGE_FADE_WRAPPER_CLASS}>
        <div
          ref={mergeRef}
          data-scroll-view={axis}
          className={cn(
            "relative z-0",
            SCROLL_VIEW_BASE_CLASS,
            SCROLL_VIEW_COLUMN_CLASS,
            scrollClass,
            hideScrollbar && "scrollbar-hidden",
            className,
          )}
          {...props}
        >
          {children}
        </div>
        <div
          aria-hidden
          className={cn(
            EDGE_FADE_BAND_CLASS,
            "top-0",
            TOP_FADE_HEIGHT,
            edgeClassName,
          )}
          style={topEdgeMask}
        />
        <div
          aria-hidden
          className={cn(
            EDGE_FADE_BAND_CLASS,
            "bottom-0",
            BOTTOM_FADE_HEIGHT,
            edgeClassName,
          )}
          style={bottomEdgeMask}
        />
      </div>
    )
  }

  return (
    <div
      ref={mergeRef}
      data-scroll-view={axis}
      className={scrollNodeClass}
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

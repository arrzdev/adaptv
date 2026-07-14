import type { ComponentPropsWithRef } from "react"
import { cn } from "#nativ/utils/cn"

/* =============================================================================
 * TYPES
 * ============================================================================= */

const SCREEN_INSET_CLASS = {
  //truly flush — the surface bleeds to every edge (default).
  none: "",
  //safe-area padding on all sides.
  safe: "p-safe",
  //safe-area padding on the horizontal edges only (top/bottom owned by chrome).
  "safe-x": "px-safe",
} as const

/**
 * Props for {@link Screen}. Extends native `<div>` props so it drops in as a
 * plain, fully styleable surface.
 */
export interface ScreenProps extends ComponentPropsWithRef<"div"> {
  /**
   * Neutral safe-area padding applied to the surface. Default `"none"` — the
   * surface is edge-to-edge and any inset is the caller's (chrome owns it, or the
   * scroller fades under it). Use `"safe"` for a static full-screen surface that
   * should clear the notch / home indicator on every side.
   */
  inset?: keyof typeof SCREEN_INSET_CLASS
}

/* =============================================================================
 * ROOT
 * ============================================================================= */

const SCREEN_BASE_CLASS = "flex min-h-0 w-full flex-1 flex-col"

/**
 * The route-level surface. Fills the app shell edge-to-edge and owns the flex
 * chain a page needs (`flex min-h-0 flex-1 flex-col`) so screens stop hand-rolling
 * it. Pair it with a {@link ScrollView} for a scrolling page, or use it directly
 * for static full-screen content (404, empty states, a rotate prompt).
 *
 * Neutral Tier-1: no background, spacing, or alignment — add those at the call
 * site. Safe-area handling is explicit via {@link ScreenProps.inset}, never
 * implied by where the component sits in the tree.
 *
 * @example
 * ```tsx
 * <Screen inset="safe" className="items-center justify-center bg-background">
 *   <EmptyState />
 * </Screen>
 * ```
 */
export function Screen({
  inset = "none",
  className,
  ...props
}: ScreenProps) {
  return (
    <div
      className={cn(
        SCREEN_BASE_CLASS,
        SCREEN_INSET_CLASS[inset],
        className,
      )}
      {...props}
    />
  )
}

import type { ComponentPropsWithRef } from "react"
import { mergeStyles } from "#adaptv/utils/styles"

/* =============================================================================
 * TYPES
 * ============================================================================= */

/** Which safe-area edge(s) to pad. Resolves to 0 in a browser tab, the real inset in standalone/native. */
type SafeEdges = "top" | "bottom" | "x" | "y" | "all"

const SAFE_CLASS: Record<SafeEdges, string> = {
  top: "pt-safe",
  bottom: "pb-safe",
  x: "px-safe",
  y: "py-safe",
  all: "p-safe",
}

/**
 * Props for {@link View}. Extends native `<div>` props so it drops in anywhere a
 * `<div>` would. Behaviour is props; look is `className`.
 */
export interface ViewProps extends ComponentPropsWithRef<"div"> {
  /** Lay children out in a row instead of the default column (RN parity). */
  row?: boolean
  /** Center children on both axes. */
  center?: boolean
  /**
   * Grow to fill the parent flex line — `flex-1` + `min-h-0` (so nested scroll works).
   *
   * **Not needed at a page's root**: the shell stretches a route's only root element
   * (`styles/screen.css`), so a bare `<View>` is already a full-screen, non-scrolling
   * page. Use it when this box is one of several children and should take the slack.
   */
  fill?: boolean
  /** Pad the given safe-area edge(s). Wins over `className` (structural). */
  safe?: SafeEdges
}

/* =============================================================================
 * ROOT
 * ============================================================================= */

/**
 * The base box primitive — a flex container (RN parity: **column by default**) that
 * lays out consistently on web, PWA, and native. **Non-scrolling**: for a scroll
 * surface use `ScrollView`; for a long list use `List` (virtualized).
 *
 * Behaviour is props (`row` / `center` / `fill` / `safe`); look is `className`. The
 * safe-area padding is structural — it wins over a conflicting `className` — while
 * the default `flex flex-col` is an overridable base (set `className="grid"` etc.).
 *
 * @example
 * ```tsx
 * <View className="gap-3 px-4">{rows}</View>
 * <View row center className="gap-2">{a}{b}</View>
 * <View fill safe="bottom">{content}</View>
 * ```
 */
export function View({
  row = false,
  center = false,
  fill = false,
  safe,
  className,
  children,
  ...props
}: ViewProps) {
  return (
    <div
      data-adaptv="view"
      className={mergeStyles({
        base: [
          "flex",
          row ? "flex-row" : "flex-col",
          center && "items-center justify-center",
          fill && "min-h-0 flex-1",
        ],
        className,
        locked: safe && SAFE_CLASS[safe],
      })}
      {...props}
    >
      {children}
    </div>
  )
}

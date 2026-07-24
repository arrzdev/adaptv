import { useVirtualizer } from "@tanstack/react-virtual"
import type { CSSProperties, ReactNode } from "react"
import { useEffect, useRef } from "react"
import { ScrollView } from "#adaptv/components/scroll-view"

/* =============================================================================
 * TYPES
 * ============================================================================= */

export interface ListProps<T> {
  /** Row data. */
  data: readonly T[]
  /** Stable key per row. */
  keyExtractor: (item: T, index: number) => string
  /** Render one row. */
  renderItem: (item: T, index: number) => ReactNode
  /** Estimated row height (px) — the virtualizer refines it by measuring. Default `56`. */
  estimateSize?: number
  /** Rows rendered beyond the viewport each side. Default `6`. */
  overscan?: number
  /** Rendered instead of the list when `data` is empty. */
  emptyState?: ReactNode
  /** Fired once the last row enters the window — wire infinite scroll here. */
  onEndReached?: () => void
  /** Masked safe-area edge fades (top + bottom). */
  edgeFades?: boolean
  /** Brand background for the fade bands (e.g. `bg-background`). */
  edgeClassName?: string
  /** Classes for the scroll surface. */
  className?: string
}

const ROW_STYLE_BASE: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
}

/* =============================================================================
 * ROOT
 * ============================================================================= */

/**
 * Virtualized list — only the visible rows are in the DOM, so a 10k-row list scrolls
 * as cheaply as a screenful. Data-driven (`data` + `renderItem` + `keyExtractor`),
 * built on TanStack Virtual over a {@link ScrollView} scroll host (momentum,
 * safe-area, direction lock all inherited). For a handful of arbitrary children use
 * `ScrollView` directly; for a non-scrolling box use `View`.
 *
 * @example
 * ```tsx
 * <List
 *   data={todos}
 *   keyExtractor={(t) => t.id}
 *   renderItem={(t) => <TodoRow todo={t} />}
 *   onEndReached={loadMore}
 *   emptyState={<Empty />}
 *   edgeFades
 * />
 * ```
 */
export function List<T>({
  data,
  keyExtractor,
  renderItem,
  estimateSize = 56,
  overscan = 6,
  emptyState,
  onEndReached,
  edgeFades,
  edgeClassName,
  className,
}: ListProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateSize,
    overscan,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const lastIndex = virtualItems.at(-1)?.index ?? -1

  //infinite scroll: fire when the last row is windowed (effect, not during render)
  useEffect(() => {
    if (onEndReached && data.length > 0 && lastIndex >= data.length - 1) {
      onEndReached()
    }
  }, [onEndReached, lastIndex, data.length])

  if (data.length === 0) {
    return <>{emptyState ?? null}</>
  }

  return (
    <ScrollView
      ref={scrollRef}
      edgeFades={edgeFades}
      edgeClassName={edgeClassName}
      className={className}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {virtualItems.map((virtualRow) => {
          const item = data[virtualRow.index]
          if (item === undefined) return null
          return (
            <div
              key={keyExtractor(item, virtualRow.index)}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                ...ROW_STYLE_BASE,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {renderItem(item, virtualRow.index)}
            </div>
          )
        })}
      </div>
    </ScrollView>
  )
}

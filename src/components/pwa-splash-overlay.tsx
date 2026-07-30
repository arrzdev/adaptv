import type { CSSProperties, ReactNode } from "react"
import { mergeStyles } from "#adaptv/utils/styles"

export type PwaSplashOverlayProps = {
  /** Classes for the full-viewport coverage box (the painted backdrop). */
  className?: string
  style?: CSSProperties
  /**
   * Classes for the inner centering region that holds the content. Constrain it
   * here (e.g. anchor a frozen launch height) to keep the content from shifting
   * without shrinking the coverage box.
   */
  centerClassName?: string
  centerStyle?: CSSProperties
  children?: ReactNode
}

/**
 * Full-viewport splash frame with centered content.
 *
 * Two layers: an outer **coverage** box pinned to `inset-0` — it always spans the live
 * viewport, so app content can never leak past its edges — and an inner **centering**
 * region that positions the content. Pass `centerClassName` to constrain that region
 * (e.g. a frozen launch height on an iOS standalone cold start) without shrinking the
 * coverage box, so the content stays put while the backdrop still covers everything.
 */
export function PwaSplashOverlay({
  className,
  style,
  centerClassName,
  centerStyle,
  children,
}: PwaSplashOverlayProps) {
  //LOCKED on the coverage box: `fixed inset-0` and the z-index ARE the coverage
  //guarantee — this element exists to make it impossible for app content to be
  //visible during boot, and a consumer's `relative` or `z-0` would silently let the
  //un-hydrated app show through, which is the exact flash the splash prevents.
  //Background stays base — the point is to paint the app's own colour (§7:
  //`bg-background` resolves against the consumer's theme).
  const cover = mergeStyles({
    base: "bg-background",
    className,
    locked: "fixed inset-0 z-[100]",
    style,
    lockedStyle: undefined,
  })

  //Only `absolute` is locked here, and the distinction matters: taking this region
  //out of flow is what lets `centerClassName` constrain it (a frozen launch height,
  //`bottom-auto`) WITHOUT shrinking the coverage box — which is the region's entire
  //reason to exist. The insets are the default extent, so they stay `base` and a
  //consumer can move any single edge; locking them would silently delete exactly
  //the override the prop is documented to accept.
  const center = mergeStyles({
    base: "inset-0 flex flex-col items-center justify-center",
    className: centerClassName,
    locked: "absolute",
    style: centerStyle,
    lockedStyle: undefined,
  })

  return (
    <div
      data-adaptv-splash
      className={cover.className}
      style={cover.style}
    >
      <div className={center.className} style={center.style}>
        {children && (
          <div className="flex flex-col items-center gap-8">
            {children}
          </div>
        )}
      </div>
    </div>
  )
}

import type { CSSProperties, ReactNode } from "react"
import { cn } from "#adaptv/utils/cn"

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
  return (
    <div
      data-adaptv-splash
      className={cn(
        "fixed inset-0 z-[100] bg-background hardware-boosted",
        className,
      )}
      style={style}
    >
      <div
        className={cn(
          "absolute inset-0 flex flex-col items-center justify-center",
          centerClassName,
        )}
        style={centerStyle}
      >
        {children && (
          <div className="flex flex-col items-center gap-8">
            {children}
          </div>
        )}
      </div>
    </div>
  )
}

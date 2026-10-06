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

/*
 * LOCKED on the coverage box, inline (docs/decisions/styling.md §2.0): `position: fixed`,
 * all four insets at 0 and the z-index ARE the coverage guarantee — this element exists
 * to make it impossible for app content to be visible during boot, and a consumer's
 * `relative` or `z-0` would silently let the un-hydrated app show through, which is the
 * exact flash the splash prevents. The background stays a default (styles/
 * pwa-splash-overlay.css) — the point is to paint the app's own colour (§7).
 */
const COVER_LOCKED_STYLE: CSSProperties = Object.freeze({
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: 100,
})

/*
 * Only `position: absolute` is locked on the centering region, and the distinction
 * matters: taking this region out of flow is what lets `centerClassName` constrain it
 * (a frozen launch height, `bottom-auto`) WITHOUT shrinking the coverage box — which is
 * the region's entire reason to exist. The insets are the default extent, so they are a
 * layered default and a consumer can move any single edge; locking them would silently
 * delete exactly the override the prop is documented to accept.
 */
const CENTER_LOCKED_STYLE: CSSProperties = Object.freeze({
  position: "absolute",
})

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
  const cover = mergeStyles({
    className,
    style,
    lockedStyle: COVER_LOCKED_STYLE,
  })

  const center = mergeStyles({
    className: centerClassName,
    style: centerStyle,
    lockedStyle: CENTER_LOCKED_STYLE,
  })

  return (
    <div
      data-adaptv-splash
      data-adaptv="pwa-splash-overlay"
      data-part="root"
      className={cover.className || undefined}
      style={cover.style}
    >
      <div
        data-adaptv="pwa-splash-overlay"
        data-part="center"
        className={center.className || undefined}
        style={center.style}
      >
        {children && (
          <div data-adaptv="pwa-splash-overlay" data-part="content">
            {children}
          </div>
        )}
      </div>
    </div>
  )
}

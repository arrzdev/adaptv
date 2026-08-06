/* =============================================================================
 * iOS Dynamic Type — the scalar
 *
 * The multiplier a `<Text scaleWithSystem>` applies to its BUILT font size, so
 * `text-4xl` stays `text-4xl` × the user's accessibility text-size factor rather than
 * being replaced by a system body face. It is a runtime measurement because WebKit
 * exposes the setting through nothing but the `-apple-system-body` font keyword — there
 * is no media query and no JS API for Dynamic Type.
 *
 * Read {@link measureDynamicTypeScale} once and multiply; the value only changes on a
 * reload (WebKit resolves the keyword at page load), so it is measured once and cached.
 * ============================================================================= */

/**
 * `-apple-system-body` resolves to **17px** at the default "Large" content size on iOS,
 * and every larger accessibility step scales UP from there. Dividing the measured size
 * by 17 therefore yields a factor that is `1` at the default and grows past it — the
 * exact multiplier Dynamic Type means. (Ionic hardcodes the same 17.)
 */
const DEFAULT_BODY_PX = 17

/**
 * Module-level cache: the keyword only re-resolves on a full reload, which WebKit
 * requires for a text-size change to take effect anyway, so a single measurement per
 * page load is both correct and free to repeat.
 */
let cachedScale: number | undefined

/**
 * The iOS Dynamic Type multiplier for the current page load, `≥ 1`.
 *
 * Returns `1` everywhere it cannot or should not apply — non-iOS engines, desktop
 * Safari, SSR — so a caller can multiply unconditionally and get the class size back
 * untouched off iOS.
 */
export function measureDynamicTypeScale(): number {
  if (cachedScale === undefined) cachedScale = computeDynamicTypeScale()
  return cachedScale
}

function computeDynamicTypeScale(): number {
  // SSR / no DOM: nothing to measure, and no setting to track.
  if (typeof document === "undefined") return 1

  // iOS-WebKit only, the SAME gate the old text.css rule used: `-webkit-touch-callout`
  // is WebKit-only (Blink never shipped it) and macOS Safari does not support it either.
  // Off iOS the keyword is either unknown or resolves to the 13px macOS system body
  // face, which would SHRINK the text — so anywhere but iOS the factor must be 1.
  if (
    typeof CSS === "undefined" ||
    !CSS.supports("-webkit-touch-callout", "none")
  ) {
    return 1
  }

  const probe = document.createElement("span")
  // The keyword only works through the `font` SHORTHAND — `font-size: -apple-system-body`
  // is an invalid declaration and is dropped (a system font "can only be set with the
  // font property", per CSS Fonts).
  probe.style.font = "-apple-system-body"
  probe.style.position = "absolute"
  probe.style.visibility = "hidden"
  probe.setAttribute("aria-hidden", "true")
  document.body.appendChild(probe)
  const px = Number.parseFloat(getComputedStyle(probe).fontSize)
  probe.remove()

  if (!Number.isFinite(px) || px <= 0) return 1
  return px / DEFAULT_BODY_PX
}

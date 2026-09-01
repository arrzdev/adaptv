/**
 * Carrying the drawer's dim past the top of the viewport, into the browser's own toolbar.
 *
 * In a mobile browser tab the scrim stops at the edge of the page, and the chrome above it stays
 * the app's undimmed theme colour — the sheet reads as a thing happening *inside* a web page
 * rather than to the whole screen. This extends the same dim over the toolbar by animating
 * `<meta name="theme-color">` alongside the backdrop's opacity, on the backdrop's own curve.
 *
 * It runs everywhere and matters in a browser tab. An installed PWA and a native build have no
 * toolbar for this to reach, so the write lands on a tag nobody reads and nothing happens — which
 * is why there is no platform branch on this path either (`capabilities/theme-color.ts` carries
 * the full matrix and the reasoning).
 *
 * **The scrim's colour is the consumer's**, read off the rendered backdrop rather than
 * configured: the engine owns where the overlay sits and nothing about how it looks
 * (`docs/decisions/styling.md`), so a `bg-black/40` and a `bg-slate-900/60` must both come out right. What the
 * chrome shows is that colour composited over the theme colour underneath it — the pixel the
 * scrim would produce if the toolbar were part of the page.
 */

import {
  getChromeTintBase,
  restoreChromeTint,
  setChromeTint,
  transitionChromeTint,
} from "#adaptv/capabilities/theme-color"
import type { DrawerTransition } from "#adaptv/components/drawer/drawer-constants"
import type { Rgb } from "#adaptv/utils/color"
import {
  compositeOver,
  formatHex,
  mixRgb,
  parseCssColor,
} from "#adaptv/utils/color"

type DrawerTint = {
  /** the theme's own colour — where the chrome sits with the sheet closed */
  base: Rgb
  /** that colour under the scrim at full strength */
  dimmed: Rgb
}

/**
 * Resolved once per open and reused for the rest of it. A drag writes the tint every frame, and
 * `getComputedStyle` on every one of those frames is a forced style recalc landing in exactly the
 * frames the sheet cannot afford to drop.
 */
let active: DrawerTint | null = null

function resolveTint(backdrop: HTMLElement | null): DrawerTint | null {
  if (!backdrop) return null
  const baseColor = getChromeTintBase()
  if (!baseColor) return null

  const base = parseCssColor(baseColor)
  const scrim = parseCssColor(getComputedStyle(backdrop).backgroundColor)
  //a scrim we cannot read (`oklch()`, wide gamut) or one that is not there at all
  if (!base || !scrim || scrim.a <= 0) return null

  return { base, dimmed: compositeOver(scrim, base) }
}

/** The chrome colour for a backdrop sitting at `opacity`. */
function tintAt(tint: DrawerTint, opacity: number): string {
  return formatHex(mixRgb(tint.base, tint.dimmed, opacity))
}

/**
 * Move the tint to where a backdrop at `targetOpacity` would put it, on the backdrop's curve.
 * Paired with `transitionDrawerBackdropOpacity` so the two can never be armed apart.
 */
export function transitionDrawerChromeTint(
  backdrop: HTMLElement | null,
  targetOpacity: number,
  config: DrawerTransition,
  duration: number,
): void {
  if (targetOpacity <= 0) {
    active = null
    restoreChromeTint({ duration, easing: config.bezier })
    return
  }

  active = resolveTint(backdrop)
  if (!active) return
  transitionChromeTint(tintAt(active, targetOpacity), {
    duration,
    easing: config.bezier,
  })
}

/**
 * Put the tint where a backdrop at `opacity` would put it, with no transition — the drag path,
 * where the finger owns the progress and a clock would only fight it.
 */
export function setDrawerChromeTint(
  backdrop: HTMLElement | null,
  opacity: number,
): void {
  const tint = active ?? resolveTint(backdrop)
  if (!tint) return
  active = tint
  setChromeTint(tintAt(tint, opacity))
}

/** Hand the chrome back at once — the paths that close with nothing animating. */
export function clearDrawerChromeTint(): void {
  active = null
  restoreChromeTint({ duration: 0 })
}

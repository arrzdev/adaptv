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
import type { Rgb, Rgba } from "#adaptv/utils/color"
import {
  compositeOver,
  formatHex,
  mixRgb,
  parseCssColor,
} from "#adaptv/utils/color"

type DrawerTint = {
  /** the colour under this scrim — the theme's own, or the dim of the sheet below this one */
  base: Rgb
  /** that colour under the scrim at full strength */
  dimmed: Rgb
}

type DrawerTintLayer = {
  backdrop: HTMLElement
  /** the scrim as rendered, read once when the layer is taken */
  scrim: Rgba
}

/**
 * One layer per backdrop that is dimming the chrome, in the order they opened.
 *
 * Each scrim is read once per open and reused for the rest of it. A drag writes the tint every
 * frame, and `getComputedStyle` on every one of those frames is a forced style recalc landing in
 * exactly the frames the sheet cannot afford to drop.
 *
 * It is a stack because sheets stack: a sheet opened from inside a sheet dims a page that is
 * already dimmed, and the toolbar has to show what the page shows — the inner scrim composited
 * over the outer's dim. Keyed on the backdrop, so each sheet hands back only its own layer: with
 * one shared slot, closing the inner sheet restored the theme colour over an outer sheet that was
 * still standing. The colours are folded from the theme up at each use rather than stored, so a
 * layer that leaves from the MIDDLE (a browser Back that unmounts the outer sheet before the
 * inner) leaves the ones above it composited over what is really under them now.
 */
const stack: DrawerTintLayer[] = []

/**
 * A backdrop that left the document without fading out or being cleared has no layer to hand
 * back any more; dropping it here keeps a page that tore a sheet down some other way from
 * dimming every later sheet over a ghost.
 */
function pruneStack() {
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    if (!stack[i].backdrop.isConnected) stack.splice(i, 1)
  }
}

/** The tint of the layer at `index`: its scrim over everything below it, down to the theme. */
function tintOfLayer(index: number): DrawerTint | null {
  const baseColor = getChromeTintBase()
  const themeBase = baseColor ? parseCssColor(baseColor) : null
  if (!themeBase) return null
  let base: Rgb = themeBase
  for (let i = 0; i < index; i += 1) {
    base = compositeOver(stack[i].scrim, base)
  }
  return { base, dimmed: compositeOver(stack[index].scrim, base) }
}

function topTint(): DrawerTint | null {
  pruneStack()
  return stack.length > 0 ? tintOfLayer(stack.length - 1) : null
}

/** This backdrop's layer, read on its first use in an open and reused after that. */
function acquireTint(backdrop: HTMLElement | null): DrawerTint | null {
  if (!backdrop) return null
  pruneStack()
  const held = stack.findIndex((layer) => layer.backdrop === backdrop)
  if (held >= 0) return tintOfLayer(held)

  const scrim = parseCssColor(getComputedStyle(backdrop).backgroundColor)
  //a scrim we cannot read (`oklch()`, wide gamut) or one that is not there at all
  if (!scrim || scrim.a <= 0) return null
  stack.push({ backdrop, scrim })
  return tintOfLayer(stack.length - 1)
}

function releaseTint(backdrop: HTMLElement | null) {
  const index = stack.findIndex((layer) => layer.backdrop === backdrop)
  if (index >= 0) stack.splice(index, 1)
}

/** The chrome colour for a backdrop sitting at `opacity`. */
function tintAt(tint: DrawerTint, opacity: number): string {
  return formatHex(mixRgb(tint.base, tint.dimmed, opacity))
}

/**
 * Move the tint to where a backdrop at `targetOpacity` would put it, on the backdrop's curve.
 * Paired with `transitionDrawerBackdropOpacity` so the two can never be armed apart.
 *
 * A fade to nothing hands the chrome back to whatever is under this sheet: the sheet below it,
 * at full dim, or the theme when this was the only one.
 */
export function transitionDrawerChromeTint(
  backdrop: HTMLElement | null,
  targetOpacity: number,
  config: DrawerTransition,
  duration: number,
): void {
  const options = { duration, easing: config.bezier }
  if (targetOpacity <= 0) {
    releaseTint(backdrop)
    const below = topTint()
    if (below) transitionChromeTint(tintAt(below, 1), options)
    else restoreChromeTint(options)
    return
  }

  const tint = acquireTint(backdrop)
  if (!tint) return
  transitionChromeTint(tintAt(tint, targetOpacity), options)
}

/**
 * Put the tint where a backdrop at `opacity` would put it, with no transition — the drag path,
 * where the finger owns the progress and a clock would only fight it.
 */
export function setDrawerChromeTint(
  backdrop: HTMLElement | null,
  opacity: number,
): void {
  const tint = acquireTint(backdrop)
  if (!tint) return
  setChromeTint(tintAt(tint, opacity))
}

/**
 * Hand this backdrop's layer back at once — the paths that close with nothing animating. What is
 * under it stays: the sheet below at full dim, or the theme.
 */
export function clearDrawerChromeTint(backdrop: HTMLElement): void {
  releaseTint(backdrop)
  const below = topTint()
  if (below) setChromeTint(tintAt(below, 1))
  else restoreChromeTint({ duration: 0 })
}

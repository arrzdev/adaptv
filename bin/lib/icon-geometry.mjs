// The numbers every icon slot is laid out from, and the one rule that turns a measurement into
// a scale. Pure — no sharp, no fs — so the geometry can be unit-tested without rendering.

/**
 * Android's adaptive-icon safe zone: the centre 72 of a 108dp foreground.
 *
 * NB: it is a **circle** of that diameter, not a square of that side, and the difference is the
 * whole reason {@link safeScale} exists. A launcher may mask to a circle, so only the inscribed
 * disc is guaranteed — art inset to a 72/108 SQUARE puts its corners at 0.667 × √2 = 0.94 of the
 * canvas, which every circular mask cuts. The web maskable spec uses the same ratio and the same
 * shape, which is not a coincidence: it was written to match Android's.
 */
export const SAFE_ZONE = 72 / 108

export const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

/**
 * How much of the safe ring's radius is left empty, as a percentage — the `--margin` default.
 *
 * The ring is the CROPPING limit, not a target. Art sized exactly to it survives every mask and
 * still looks wrong: it touches the circle on all sides, which reads as an icon that outgrew its
 * own tile, and any launcher whose mask is a hair tighter than the spec starts shaving it.
 * Leaving a tenth of the radius empty is the difference between "not cropped" and "sits
 * properly", and it is roughly where Material's own icon keylines put a product mark.
 *
 * A number rather than a constant because it is a taste call, and the one adaptv makes should be
 * the one a power user can take back — `--margin 0` to fill the ring, `--margin 20` for a
 * quieter mark. Only the DEFAULT is adaptv's opinion.
 */
export const DEFAULT_MARGIN = 10

/**
 * The share of the canvas half-width the art should reach: the ring, minus `marginPct` of it.
 * ≈0.6 at the default. The preview sheet draws this alongside the ring, so the gap is visible
 * rather than a number in a file.
 */
export function artTarget(marginPct = DEFAULT_MARGIN) {
  const pct = Number.isFinite(marginPct) ? marginPct : DEFAULT_MARGIN
  return SAFE_ZONE * (1 - Math.min(Math.max(pct, 0), 100) / 100)
}

/**
 * How much of the canvas the art may occupy for its furthest pixel to land on {@link artTarget}.
 *
 * `reach` is what `measureArtwork` returns: how far the art extends from its own centre, in
 * units of half its bounding square. The fit falls straight out of it — and every shape ends up
 * reaching the same distance, which is the point:
 *
 *   - a circular mark reaches `1.0` → `0.6`;
 *   - a square one reaches `√2` → `0.424`, which is what it actually needs and what a fixed
 *     inset never gave it;
 *   - the beaver that produced the bug report reaches ~`1.17` → `0.51`.
 *
 * Never above 1: art smaller than the target is left where it is rather than blown up to fill
 * it. `gen icons` reproduces a logo; it does not redesign one.
 */
export function safeScale(reach, target = artTarget()) {
  if (!Number.isFinite(reach) || reach <= 0) return target
  return Math.min(1, target / reach)
}

// The numbers every icon slot is laid out from, and the one rule that turns a measurement into
// a scale. Pure — no sharp, no fs — so the geometry can be unit-tested without rendering.

/**
 * Android's adaptive-icon safe zone: the centre 72 of a 108dp foreground.
 *
 * NB: it is a **circle** of that diameter, not a square of that side, and the difference is the
 * whole reason {@link fitScale} measures. A launcher may mask to a circle, so only the inscribed
 * disc is guaranteed — art inset to a 72/108 SQUARE puts its corners at 0.667 × √2 = 0.94 of the
 * canvas, which every circular mask cuts. The web maskable spec uses the same ratio and the same
 * shape, which is not a coincidence: it was written to match Android's.
 */
export const SAFE_ZONE = 72 / 108

export const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

/**
 * How much of a slot's LIMIT is left empty around the mark, as a percentage — `--margin`.
 *
 * One number, one meaning, every slot: *the share of what this slot allows that you don't use.*
 * What it allows differs, and that is the only thing that changes between them —
 *
 *   - a circle-masked slot is limited by the safe ring (0.667), so 10% leaves 0.6;
 *   - an unmasked one is limited by the tile itself (1.0), so 10% leaves 0.9.
 *
 * The limit is a cropping fact; the margin is taste. Art sized exactly to a limit survives and
 * still looks wrong — it touches the edge on all sides, which reads as an icon that outgrew its
 * tile, and any mask a hair tighter than the spec starts shaving it. A tenth is roughly where
 * Material's icon keylines and Apple's icon grid both put a product mark.
 */
export const DEFAULT_MARGIN = 10

/** What each slot's art is allowed to fill before any margin. → {@link fitScale} */
export const LIMIT = {
  /** Masked to a circle (Android's adaptive foreground, the web maskable pair). */
  circle: SAFE_ZONE,
  /** The tile itself — iOS, the favicons, the manifest's `any` icons. Nothing crops these. */
  box: 1,
}

/**
 * How much of the canvas the mark may occupy in a slot — the ONE placement rule.
 *
 * `artwork` is what `measureArtwork` returns:
 *   - `reach` how far the art extends from its own centre, in units of half its bounding square
 *     (`1` touches the inscribed circle, `√2` fills the corners);
 *   - `fill`  how much of the ORIGINAL frame that bounding square occupied.
 *
 * Two shapes of fit, because two shapes of mask:
 *   - `circle` measures the RADIUS, so a round mark and a square one both end up the same
 *     distance from the centre. This is what stops a mask cropping a logo's corners.
 *   - `box` measures the BOUNDING BOX, because nothing is being cut — the constraint is that the
 *     mark should not sit flush against the edge of its tile.
 *
 * Never larger than `fill`, and that is the half that respects the dev's own composition: art
 * that already had generous margins keeps them. adaptv only ever ADDS room, never takes a logo
 * the dev framed loosely and blows it up to fill the tile. `gen icons` reproduces a logo; it
 * does not redesign one.
 */
export function fitScale(
  artwork,
  { shape = "box", margin = DEFAULT_MARGIN },
) {
  const limit = LIMIT[shape] ?? LIMIT.box
  const pct = Number.isFinite(margin) ? margin : DEFAULT_MARGIN
  const target = limit * (1 - Math.min(Math.max(pct, 0), 100) / 100)

  const reach = Number.isFinite(artwork?.reach) ? artwork.reach : 1
  const fill = Number.isFinite(artwork?.fill) ? artwork.fill : 1
  const wanted = shape === "circle" ? target / (reach || 1) : target
  return Math.max(0.01, Math.min(fill, wanted))
}

/**
 * Where the art lands for a `circle` slot, as a share of the canvas half-width — the ring minus
 * its margin (≈0.6). The preview sheet draws this alongside the ring so the gap is visible
 * rather than a number in a file.
 */
export function artTarget(margin = DEFAULT_MARGIN) {
  const pct = Number.isFinite(margin) ? margin : DEFAULT_MARGIN
  return SAFE_ZONE * (1 - Math.min(Math.max(pct, 0), 100) / 100)
}

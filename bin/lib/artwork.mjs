// Where the artwork actually IS inside a source image, and how far it reaches.
//
// The bug this exists for: Android's safe zone is a **circle** of 72/108, and insetting art to a
// 72/108 **square** is not the same thing. That square's corners sit at 0.667 × √2 = 0.94 of the
// canvas — far outside a 0.667 circle — so any logo with content near its corners (ears, a
// wordmark's ascenders, a shield's points) was cut by every circular mask while the generator
// believed it had made room. Reported with a beaver whose ears crossed the safe ring.
//
// Guessing cannot fix that, because the right inset depends on the SHAPE of the art: a circular
// mark needs 0.667, a square one needs 0.471, and most logos are somewhere between. So adaptv
// measures instead — it reads the pixels, finds where the background stops, and scales the art
// so its furthest pixel lands exactly on the safe ring.
//
// "Background" is deliberately more than "transparent". A logo exported as a flat-coloured tile
// is the same problem wearing a different file: the mark inside it is what must survive the
// mask, and the colour around it is what should grow. So a uniform border colour is detected and
// treated exactly like transparency.
import { TRANSPARENT } from "./icon-geometry.mjs"

/** Alpha at or below this is background, not art. Catches anti-aliased edges' faint tails. */
const ALPHA_FLOOR = 8

/** Per-channel distance at which a pixel stops counting as "the same colour as the border". */
const COLOUR_TOLERANCE = 14

/**
 * The square the artwork is measured and cropped in. It is the largest slot in the set, so the
 * cropped mark is never upscaled by a later resize — and one rasterisation serves every slot.
 */
const MASTER_PX = 1024

/**
 * What `measureArtwork` returns.
 *
 * @typedef {object} Artwork
 * @property {Buffer|null} mark   The art alone — square, tightly cropped, centred, transparent
 *                                around it. `null` when the source has no detectable background
 *                                and is therefore a finished picture to be used whole.
 * @property {{r:number,g:number,b:number,alpha:number}|null} background
 *                                The colour the art sat on, when it sat on a uniform one.
 * @property {number} reach       How far the art reaches from its own centre, in units of half
 *                                the cropped square: `1` touches the inscribed circle, `√2`
 *                                fills the corners. This is what a CIRCLE fit is computed from.
 * @property {number} fill        How much of the original frame the art's bounding square
 *                                occupied, 0–1. This is what a BOX fit is computed from, and it
 *                                is also the ceiling on every fit: art the dev already framed
 *                                loosely keeps its own margins rather than being blown up.
 * @property {number} luminance   Mean relative luminance of the ART pixels alone, 0–1. Decides
 *                                whether iOS's DARK app icon can be derived from this mark: the
 *                                system draws it on a near-black backdrop, so a dark mark
 *                                disappears and only hand-authored art can fix it.
 */

/**
 * Measure `source` — see {@link Artwork}.
 *
 * Returns `mark: null` when the border is neither transparent nor a single colour (a photo, a
 * gradient, a screenshot). There is no artwork to isolate then, and inventing one would mean
 * re-laying-out a picture adaptv does not understand — so the caller uses the source whole and
 * `sourceWarnings` says the mask will crop it.
 */
export async function measureArtwork(sharp, source) {
  const { data, info } = await sharp(source, { density: 384 })
    .resize(MASTER_PX, MASTER_PX, {
      fit: "contain",
      background: TRANSPARENT,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const { width: w, height: h, channels } = info
  const px = (x, y) => {
    const i = (y * w + x) * channels
    return [data[i], data[i + 1], data[i + 2], data[i + 3]]
  }

  const background = detectBackground(px, w, h)
  //`undefined` is "the border is neither transparent nor uniform" — no artwork to isolate.
  if (background === undefined)
    return {
      mark: null,
      background: null,
      reach: Math.SQRT2,
      fill: 1,
      luminance: 0.5,
    }

  const isArt = artTest(background)
  const box = bounds(px, w, h, isArt)
  //A source that is ENTIRELY background: nothing to protect, and cropping it would produce a
  //zero-width extract. Treat it as a picture and let the slots use it whole.
  if (!box)
    return {
      mark: null,
      background,
      reach: Math.SQRT2,
      fill: 1,
      luminance: 0.5,
    }

  const side = Math.max(box.right - box.left + 1, box.bottom - box.top + 1)
  const mark = await sharp(cutBackground(data, info, isArt), { raw: info })
    .extract({
      left: box.left,
      top: box.top,
      width: box.right - box.left + 1,
      height: box.bottom - box.top + 1,
    })
    //`contain` on a square centres the crop, which is the other half of the fix: art that sat
    //off-centre in its own file used to overflow one side of the mask more than the other.
    .resize(side, side, { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer()

  return {
    mark,
    background,
    reach: reachOf(px, isArt, box),
    luminance: luminanceOf(px, isArt, box),
    //How much of the frame the art occupied BEFORE cropping — the ceiling on every fit, so a
    //logo the dev drew with room around it keeps that room instead of being enlarged to the
    //slot's target.
    fill: side / Math.max(w, h),
  }
}

/** Share of the border that must be transparent before the source counts as transparent-backed. */
const TRANSPARENT_SHARE = 0.5

/** Share of the border that must be ONE colour before that colour counts as the background. */
const FLAT_SHARE = 0.8

/**
 * The colour behind the art: `null` for a transparent source, an rgb for a flat-coloured one,
 * and `undefined` when the border is neither.
 *
 * Read from the BORDER ring rather than, say, the image's most common colour: the border is the
 * only part of an icon that is background by definition. A logo can be 90% one colour without
 * that colour being its background.
 *
 * By SHARE, not unanimously, and that is not a tolerance for sloppiness — it is the common case.
 * A logo drawn to fill its frame touches the border wherever it is widest (a disc touches at
 * four points, a wordmark along two whole edges), so "every border pixel is background" is false
 * for most well-made icons. Requiring it read a disc-on-transparent as *unclassifiable* and sent
 * it down the no-mark path, which is the one branch that cannot fix anything.
 */
function detectBackground(px, w, h) {
  const ring = []
  for (let x = 0; x < w; x++) ring.push(px(x, 0), px(x, h - 1))
  for (let y = 0; y < h; y++) ring.push(px(0, y), px(w - 1, y))

  const clear = ring.filter((p) => p[3] <= ALPHA_FLOOR).length
  if (clear / ring.length >= TRANSPARENT_SHARE) return null

  const opaque = ring.filter((p) => p[3] >= 255 - ALPHA_FLOOR)
  if (opaque.length === 0) return undefined

  //The most common exact colour on the ring — for a flat background every one of those pixels
  //is byte-identical, so this is a count, not a clustering problem.
  const tally = new Map()
  for (const [r, g, b] of opaque) {
    const key = (r << 16) | (g << 8) | b
    tally.set(key, (tally.get(key) ?? 0) + 1)
  }
  let key = 0
  let best = 0
  for (const [k, n] of tally)
    if (n > best) {
      best = n
      key = k
    }

  const bg = {
    r: (key >> 16) & 0xff,
    g: (key >> 8) & 0xff,
    b: key & 0xff,
    alpha: 1,
  }
  const near = ring.filter(
    (p) =>
      p[3] >= 255 - ALPHA_FLOOR &&
      Math.abs(p[0] - bg.r) <= COLOUR_TOLERANCE &&
      Math.abs(p[1] - bg.g) <= COLOUR_TOLERANCE &&
      Math.abs(p[2] - bg.b) <= COLOUR_TOLERANCE,
  ).length
  return near / ring.length >= FLAT_SHARE ? bg : undefined
}

/**
 * The image with its background knocked out — every non-art pixel made transparent.
 *
 * Load-bearing for a FLAT-COLOUR background, and the bug that shipped without it: cropping to
 * the art's bounding box while leaving the colour inside means the thing being placed is still
 * the whole box. A beaver on white was measured correctly (it reaches 1.17, so it should be
 * scaled to 0.57) and then drawn as a 0.57-scaled WHITE SQUARE with a beaver in it — whose
 * corners land at 0.80 and are cut by exactly the mask the measurement existed to clear.
 *
 * The surround is repainted from `artwork.background` when the slot is flattened, so the colour
 * is not lost — it is separated from the mark so it can be the thing that grows.
 */
function cutBackground(data, info, isArt) {
  const out = Buffer.from(data)
  const { width: w, height: h, channels } = info
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels
      if (isArt([data[i], data[i + 1], data[i + 2], data[i + 3]])) continue
      out[i + 3] = 0
    }
  return out
}

/** Whether a pixel is art rather than background. */
function artTest(background) {
  if (!background) return (p) => p[3] > ALPHA_FLOOR
  return (p) =>
    p[3] > ALPHA_FLOOR &&
    (Math.abs(p[0] - background.r) > COLOUR_TOLERANCE ||
      Math.abs(p[1] - background.g) > COLOUR_TOLERANCE ||
      Math.abs(p[2] - background.b) > COLOUR_TOLERANCE)
}

/** The tightest box containing every art pixel, or null when there are none. */
function bounds(px, w, h, isArt) {
  let left = w
  let top = h
  let right = -1
  let bottom = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!isArt(px(x, y))) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  return right < 0 ? null : { left, top, right, bottom }
}

/**
 * How far the art reaches from the CENTRE OF ITS BOX, as a fraction of half that box's longer
 * side — the number the safe-zone fit is computed from.
 *
 * Measuring the real furthest pixel, rather than assuming the art fills its bounding box's
 * corners, is what keeps a round logo from being needlessly shrunk: a circle reads `1.0` and
 * keeps the full 0.667 inset, while a square reads `√2` and is correctly given much less.
 */
function reachOf(px, isArt, box) {
  const cx = (box.left + box.right) / 2
  const cy = (box.top + box.bottom) / 2
  const half =
    Math.max(box.right - box.left, box.bottom - box.top) / 2 || 1
  let max = 0
  for (let y = box.top; y <= box.bottom; y++)
    for (let x = box.left; x <= box.right; x++) {
      if (!isArt(px(x, y))) continue
      const d = Math.hypot(x - cx, y - cy)
      if (d > max) max = d
    }
  return max / half
}

/**
 * Mean relative luminance of the ART pixels, 0–1 — background excluded, which is the whole
 * point. An icon that is 90% white background around a black mark is a BRIGHT image and a DARK
 * mark, and iOS's dark app icon is the mark alone on a near-black backdrop. Averaging the whole
 * frame would call that logo light and let adaptv derive an invisible icon from it.
 *
 * Rec. 709 coefficients on sRGB values without linearising: the question is "is this mark light
 * or dark enough to read on black", and a perceptual ordering is all that needs to survive.
 */
function luminanceOf(px, isArt, box) {
  let sum = 0
  let n = 0
  for (let y = box.top; y <= box.bottom; y++)
    for (let x = box.left; x <= box.right; x++) {
      const p = px(x, y)
      if (!isArt(p)) continue
      sum += (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255
      n++
    }
  return n === 0 ? 0.5 : sum / n
}

/**
 * Splitting a CSS `cubic-bezier` at the point a motion was interrupted.
 *
 * A CSS transition cannot be re-aimed: changing the target restarts the easing from its own
 * beginning. When something moves the target MID-FLIGHT — the iOS keyboard arriving in two steps
 * is the case this exists for — restarting means the panel is thrown back to the curve's *entry*
 * velocity. On the open curve (a firm shove that decelerates into place) that entry is slower than
 * the speed the panel had already built up, so an interrupt near the end reads as the sheet
 * hesitating and then crawling the last pixels: the drawer feels laggy exactly once, on the first
 * open, and normal every time after (a warmed keyboard-height cache removes the second step).
 *
 * A cubic Bézier split by de Casteljau yields two cubic Béziers. Normalising the second one back
 * into the unit square gives a curve that is a valid `cubic-bezier()` AND continues the original:
 * same position, same slope, same shape from there on. Feed it the time the original had left and
 * the motion carries on as if it were never interrupted.
 */

import { clamp } from "#adaptv/utils/clamp"

/** `[x1, y1, x2, y2]` — CSS's two control points; P0 is `(0,0)` and P3 is `(1,1)`. */
export type EasingBezier = [number, number, number, number]

export type SplitEasing = {
  /** the remainder, renormalised into the unit square */
  bezier: EasingBezier
  /** eased progress already covered at the split, in `[0,1]` */
  progress: number
  /** the remainder's entry slope, in its own normalised units — the seam's velocity divided by
   *  (travel left / time left), which is how a duration can be solved for a wanted speed */
  entrySlope: number
}

//one axis of a cubic Bézier with endpoints pinned at 0 and 1
function axisAt(s: number, c1: number, c2: number) {
  const t = 1 - s
  return 3 * t * t * s * c1 + 3 * t * s * s * c2 + s * s * s
}

function axisSlopeAt(s: number, c1: number, c2: number) {
  const t = 1 - s
  return 3 * t * t * c1 + 6 * t * s * (c2 - c1) + 3 * s * s * (1 - c2)
}

const lerp = (a: number, b: number, s: number) => a + (b - a) * s

/**
 * The curve parameter `s` at which the easing has consumed `x` of its duration. `s` is NOT the
 * elapsed fraction — that is the curve's x axis, and recovering `s` from it is the same solve
 * every browser does per frame. Newton first (the x axis is monotonic and well-behaved), bisection
 * as the guaranteed-convergent fallback.
 */
export function easingParamAtX(x: number, x1: number, x2: number): number {
  let s = clamp(x, 0, 1)
  for (let i = 0; i < 8; i++) {
    const error = axisAt(s, x1, x2) - x
    if (Math.abs(error) < 1e-6) return s
    const slope = axisSlopeAt(s, x1, x2)
    if (Math.abs(slope) < 1e-6) break
    s = clamp(s - error / slope, 0, 1)
  }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    s = (lo + hi) / 2
    if (axisAt(s, x1, x2) < x) lo = s
    else hi = s
  }
  return s
}

/**
 * The part of `bezier` that is still ahead after `elapsed` (a fraction of the easing's duration,
 * `0` = untouched), as a curve in its own right.
 *
 * `null` when there is nothing meaningful left to continue — the tail end, where the remaining
 * span collapses and the renormalisation would divide by ~0. Callers should fall back to a fresh
 * curve there; with ~no travel and ~no time left the two are indistinguishable anyway.
 */
export function splitEasingAt(
  bezier: EasingBezier,
  elapsed: number,
): SplitEasing | null {
  const [x1, y1, x2, y2] = bezier
  const at = clamp(elapsed, 0, 1)
  if (at <= 1e-4) {
    //untouched: the remainder IS the curve, and its entry slope is the curve's
    return {
      bezier,
      progress: 0,
      entrySlope: x1 > 1e-6 ? y1 / x1 : Number.POSITIVE_INFINITY,
    }
  }

  const s = easingParamAtX(at, x1, x2)

  //de Casteljau: the right-hand sub-curve's controls are (F, E, C, P3)
  const ax = lerp(0, x1, s)
  const bx = lerp(x1, x2, s)
  const cx = lerp(x2, 1, s)
  const ex = lerp(bx, cx, s)
  const fx = lerp(lerp(ax, bx, s), ex, s)

  const ay = lerp(0, y1, s)
  const by = lerp(y1, y2, s)
  const cy = lerp(y2, 1, s)
  const ey = lerp(by, cy, s)
  const fy = lerp(lerp(ay, by, s), ey, s)

  const spanX = 1 - fx
  const spanY = 1 - fy
  if (spanX <= 1e-4 || spanY <= 1e-4) return null

  const q1x = clamp((ex - fx) / spanX, 0, 1)
  const q1y = (ey - fy) / spanY
  const q2x = clamp((cx - fx) / spanX, 0, 1)
  const q2y = (cy - fy) / spanY

  return {
    bezier: [q1x, q1y, q2x, q2y],
    progress: fy,
    entrySlope: q1x > 1e-6 ? q1y / q1x : Number.POSITIVE_INFINITY,
  }
}

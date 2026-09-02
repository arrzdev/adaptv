/**
 * Evaluating a CSS `cubic-bezier()` from JS.
 *
 * A `cubic-bezier(x1, y1, x2, y2)` is a curve, not a formula: its x axis is the elapsed fraction
 * of the duration and its y axis is the eased progress, but the two are related through a curve
 * parameter `s` that is neither. Reading "how far along is this motion at 40% of its time" means
 * solving for `s` first — the same solve the compositor does per frame.
 *
 * This lives in `utils` rather than beside the drawer because two unrelated motions now need it:
 * the drawer's mid-flight interrupt (`components/drawer/drawer-easing.ts`, which splits a curve
 * at the point it was interrupted) and the browser-chrome tint (`capabilities/theme-color.ts`,
 * which has no element to hand the curve to and must sample it itself).
 */

import { clamp } from "#adaptv/utils/clamp"

/** `[x1, y1, x2, y2]` — CSS's two control points; P0 is `(0,0)` and P3 is `(1,1)`. */
export type EasingBezier = [number, number, number, number]

/** One axis of a cubic Bézier with endpoints pinned at 0 and 1. */
function easingAxisAt(s: number, c1: number, c2: number) {
  const t = 1 - s
  return 3 * t * t * s * c1 + 3 * t * s * s * c2 + s * s * s
}

function easingAxisSlopeAt(s: number, c1: number, c2: number) {
  const t = 1 - s
  return 3 * t * t * c1 + 6 * t * s * (c2 - c1) + 3 * s * s * (1 - c2)
}

/**
 * The curve parameter `s` at which the easing has consumed `x` of its duration. `s` is NOT the
 * elapsed fraction — that is the curve's x axis, and recovering `s` from it is the same solve
 * every browser does per frame. Newton first (the x axis is monotonic and well-behaved),
 * bisection as the guaranteed-convergent fallback.
 */
export function easingParamAtX(x: number, x1: number, x2: number): number {
  let s = clamp(x, 0, 1)
  for (let i = 0; i < 8; i++) {
    const error = easingAxisAt(s, x1, x2) - x
    if (Math.abs(error) < 1e-6) return s
    const slope = easingAxisSlopeAt(s, x1, x2)
    if (Math.abs(slope) < 1e-6) break
    s = clamp(s - error / slope, 0, 1)
  }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    s = (lo + hi) / 2
    if (easingAxisAt(s, x1, x2) < x) lo = s
    else hi = s
  }
  return s
}

/**
 * Eased progress in `[0,1]` after `x` of the duration has elapsed — the number a CSS transition
 * would be at, for a caller driving the motion itself.
 */
export function easingValueAtX(x: number, bezier: EasingBezier): number {
  const [x1, y1, x2, y2] = bezier
  return easingAxisAt(easingParamAtX(clamp(x, 0, 1), x1, x2), y1, y2)
}

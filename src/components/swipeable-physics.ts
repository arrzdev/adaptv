/*
 * Swipeable's pure engine math — the spring integrator and the release decision.
 *
 * Both used to live inline in swipeable.tsx, entangled with refs and DOM writes.
 * The release ladder in particular (position thresholds, a velocity flick that
 * beats position, and the flick-THROUGH-to-the-other-side swap) is the subtle
 * part of the component and it had no test, because there was no seam to test it
 * at. Extracted here it is an ordinary function of numbers, verified in
 * swipeable-physics.test.ts, with the DOM/spring side effects left in the engine.
 */

/** Fixed integration step (s). Small enough that `damping·dt/mass` stays well
 *  under the explicit-Euler stability limit of 2 at any real-world damping. */
export const SPRING_SUBSTEP = 1 / 240

/** One explicit-Euler step of a damped spring toward `target`. */
export function springStep(
  pos: number,
  vel: number,
  target: number,
  stiffness: number,
  damping: number,
  mass: number,
  dt: number,
) {
  const force = -stiffness * (pos - target) - damping * vel
  const nv = vel + (force / mass) * dt
  return { pos: pos + nv * dt, vel: nv }
}

export type SwipeSide = "left" | "right"
export type SwipeOpenState = false | SwipeSide

export type SwipeReleaseConfig = {
  /** Fraction of natural width the row must pass to OPEN from closed. */
  openThreshold: number
  /** Fraction of the open offset the row must retreat to CLOSE. */
  closeThreshold: number
  /** Release speed (px/s) that flicks open/closed regardless of position. */
  velocityThreshold: number
}

export type SwipeRelease =
  | { action: "open"; side: SwipeSide }
  | { action: "close"; velocity?: number }

/**
 * Decide what a released row does. Pure — no refs, no DOM.
 *
 * Sign convention (matches the engine): `+x` reveals the LEFT actions, `−x`
 * reveals the RIGHT actions. `lw` / `rw` are the measured natural widths and are
 * `0` when that side has no actions, which is also how "that direction is walled
 * off" is expressed — every branch that would open a side is gated on its width.
 *
 * A `velocity` on a close means "flick it shut with this momentum"; a position
 * close carries none. That distinction is why this returns a tagged result rather
 * than a bare side — the engine needs to know whether to seed the closing spring.
 */
export function resolveSwipeRelease({
  x,
  vel,
  lw,
  rw,
  wasOpen,
  cfg,
}: {
  x: number
  vel: number
  lw: number
  rw: number
  wasOpen: SwipeOpenState
  cfg: SwipeReleaseConfig
}): SwipeRelease {
  if (wasOpen === "left") {
    //flick back closes; flick THROUGH into right territory swaps sides
    if (vel < -cfg.velocityThreshold) {
      if (x < 0 && rw > 0) return { action: "open", side: "right" }
      return { action: "close", velocity: vel }
    }
    if (x < lw * (1 - cfg.closeThreshold)) return { action: "close" }
    return { action: "open", side: "left" }
  }
  if (wasOpen === "right") {
    if (vel > cfg.velocityThreshold) {
      if (x > 0 && lw > 0) return { action: "open", side: "left" }
      return { action: "close", velocity: vel }
    }
    if (x > -rw * (1 - cfg.closeThreshold)) return { action: "close" }
    return { action: "open", side: "right" }
  }

  //from closed — a flick wins over position, then the position thresholds
  if (vel > cfg.velocityThreshold && lw > 0)
    return { action: "open", side: "left" }
  if (vel < -cfg.velocityThreshold && rw > 0)
    return { action: "open", side: "right" }
  if (lw > 0 && x > lw * cfg.openThreshold)
    return { action: "open", side: "left" }
  if (rw > 0 && x < -rw * cfg.openThreshold)
    return { action: "open", side: "right" }
  return { action: "close" }
}

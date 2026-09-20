/*
 * PullToRefresh's pure pull math — axis resolution, the activation curve, and the
 * per-frame visual mapping. Lifted out of pull-to-refresh.tsx (where it was inline
 * among the gesture refs and motion wiring) so the thresholds and the indicator
 * geometry are testable without a DOM. The component keeps the gesture plumbing.
 */

import { clamp } from "#adaptv/utils/clamp"

export type GestureAxis = "pending" | "vertical" | "horizontal"

/** Distance (px) the finger must travel before the gesture commits to an axis —
 *  below it, a tap or micro-jitter stays "pending" and locks nothing. */
const GESTURE_SLOP = 10
/** Pull distance (px) past which a release runs `onRefresh`. */
export const PULL_THRESHOLD = 80
/** Hard cap on how far the content follows the finger. */
export const PULL_MAX = 160
/** The spinner only starts to show once the pull clears this. */
export const SPINNER_APPEAR_OFFSET = 16
export const ICON_SIZE = 20
export const STUCK_VERTICAL_PADDING = 24
/** Docked (refreshing) height — the snap position the spinner holds at. */
export const STUCK_HEIGHT = ICON_SIZE + 2 * STUCK_VERTICAL_PADDING
const INDICATOR_DOCK_CENTER_Y = STUCK_HEIGHT / 2
const INDICATOR_FOLLOW_RATIO = INDICATOR_DOCK_CENTER_Y / PULL_THRESHOLD
export const ACTIVATION_ROTATION_DEG = 270
const SPINNER_SCALE_MIN = 0.75

/**
 * Which way is this gesture going? `pending` until it clears the slop, then the
 * dominant axis. Horizontal wins ties (`absX >= absY`) so a mostly-sideways drag
 * never arms a pull — the component treats a horizontal result as "not mine".
 */
export function resolveGestureAxis(dx: number, dy: number): GestureAxis {
  const absX = Math.abs(dx)
  const absY = Math.abs(dy)
  if (absX < GESTURE_SLOP && absY < GESTURE_SLOP) return "pending"
  if (absX >= absY) return "horizontal"
  return "vertical"
}

/** 0 below the appear offset, ramping linearly to 1 at the threshold (clamped). */
export function getActivationProgress(pullDistance: number) {
  if (pullDistance < SPINNER_APPEAR_OFFSET) return 0
  return clamp(
    (pullDistance - SPINNER_APPEAR_OFFSET) /
      (PULL_THRESHOLD - SPINNER_APPEAR_OFFSET),
    0,
    1,
  )
}

/**
 * The full per-frame indicator state for a pull distance: how far the content
 * has moved, whether the spinner shows, and its opacity / arc / rotation / scale.
 * Past the threshold everything pins to its activated value (opacity 1, full arc,
 * `ACTIVATION_ROTATION_DEG`) so the "release to refresh" state reads as committed.
 */
export function getPullVisuals(pullDistance: number) {
  const contentY = clamp(pullDistance, 0, PULL_MAX)
  const activationProgress = getActivationProgress(contentY)
  const pastActivation = contentY >= PULL_THRESHOLD
  const showSpinner = contentY >= SPINNER_APPEAR_OFFSET
  const spinnerCenterY = Math.min(
    contentY * INDICATOR_FOLLOW_RATIO,
    INDICATOR_DOCK_CENTER_Y,
  )

  return {
    contentY,
    showSpinner,
    spinnerTop: Math.max(0, spinnerCenterY - ICON_SIZE / 2),
    opacity: pastActivation ? 1 : activationProgress,
    arcProgress: pastActivation ? 1 : activationProgress,
    rotation: pastActivation
      ? ACTIVATION_ROTATION_DEG
      : activationProgress * ACTIVATION_ROTATION_DEG,
    scale:
      SPINNER_SCALE_MIN + activationProgress * (1 - SPINNER_SCALE_MIN),
  }
}

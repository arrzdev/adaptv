/*
 * WheelColumn's pure geometry — the cylindrical drum projection and the snap.
 *
 * Both were inline in wheel-column.tsx, entangled with the scroll refs and per-row
 * DOM writes, so the maths that makes the column read as a rotating iOS drum had
 * no test. Extracted here they are ordinary functions of numbers, verified in
 * wheel-column-geometry.test.ts, with the scroll pipeline left in the component.
 */

import { clamp } from "#adaptv/utils/clamp"

export const WHEEL_ITEM_HEIGHT = 30
const WHEEL_VISIBLE_ROWS = 5
export const WHEEL_HEIGHT = WHEEL_ITEM_HEIGHT * WHEEL_VISIBLE_ROWS
/** The list is padded two rows top and bottom so scrollTop 0 centres index 0. */
export const WHEEL_PAD = WHEEL_ITEM_HEIGHT * 2

// drum projection: rows are re-projected from their flat scroll slots onto a
// cylinder — tilted, pulled toward the rim, pushed back in Z — so the column
// reads as a rotating drum, not a flat list. The radius follows from the step
// angle so one row of scroll = one step of drum.
const WHEEL_ROW_TILT_DEG = 22
const WHEEL_MAX_TILT_DEG = 84
const WHEEL_PERSPECTIVE_PX = 600
const WHEEL_RADIUS =
  WHEEL_ITEM_HEIGHT / (2 * Math.tan((WHEEL_ROW_TILT_DEG * Math.PI) / 360))

/**
 * The nearest selectable row for a scroll offset, clamped to the list — the whole
 * index contract of the component (`scrollTop / itemHeight`, rounded and bounded).
 */
export function snapIndex(scrollTop: number, count: number): number {
  if (count <= 0) return 0
  return Math.min(
    count - 1,
    Math.max(0, Math.round(scrollTop / WHEEL_ITEM_HEIGHT)),
  )
}

/**
 * The CSS transform for a row sitting `distanceRows` from the centred row
 * (negative = above centre). Pure: the cylinder position (tilt, foreshortening
 * toward the rim, depth) that the engine writes to each row every scroll frame.
 * At the centre (`distanceRows === 0`) it is the identity — no tilt, no offset.
 */
export function wheelRowTransform(distanceRows: number): string {
  const tiltDeg = clamp(
    distanceRows * WHEEL_ROW_TILT_DEG,
    -WHEEL_MAX_TILT_DEG,
    WHEEL_MAX_TILT_DEG,
  )
  const tilt = (tiltDeg * Math.PI) / 180
  const flatY = distanceRows * WHEEL_ITEM_HEIGHT
  const drumY = WHEEL_RADIUS * Math.sin(tilt)
  const drumZ = WHEEL_RADIUS * (Math.cos(tilt) - 1)
  return `perspective(${WHEEL_PERSPECTIVE_PX}px) translateY(${drumY - flatY}px) translateZ(${drumZ}px) rotateX(${-tiltDeg}deg)`
}

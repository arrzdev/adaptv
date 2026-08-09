import { describe, expect, it } from "vitest"
import { DRAWER_TRANSITIONS } from "#adaptv/components/drawer/drawer-constants"
import type { EasingBezier } from "#adaptv/components/drawer/drawer-easing"
import {
  easingParamAtX,
  splitEasingAt,
} from "#adaptv/components/drawer/drawer-easing"

const OPEN: EasingBezier = [...DRAWER_TRANSITIONS.EASE]
//an asymmetric curve that does NOT end flat, so a split can't pass by symmetry alone
const CLOSE: EasingBezier = [0.6, 0.3, 0.15, 0.5]

/** The easing's own output: eased progress at `x` of its duration. */
function ease([x1, y1, x2, y2]: EasingBezier, x: number) {
  const s = easingParamAtX(x, x1, x2)
  const t = 1 - s
  return 3 * t * t * s * y1 + 3 * t * s * s * y2 + s * s * s
}

function slope(bezier: EasingBezier, x: number, h = 1e-4) {
  return (ease(bezier, x + h) - ease(bezier, x - h)) / (2 * h)
}

describe("easingParamAtX", () => {
  it("inverts the x axis across the whole domain", () => {
    for (const bezier of [OPEN, CLOSE]) {
      const [x1, , x2] = bezier
      for (let x = 0; x <= 1; x += 0.05) {
        const s = easingParamAtX(x, x1, x2)
        const t = 1 - s
        const back = 3 * t * t * s * x1 + 3 * t * s * s * x2 + s * s * s
        expect(back).toBeCloseTo(x, 4)
      }
    }
  })
})

describe("splitEasingAt", () => {
  it("hands back the curve itself when nothing has elapsed", () => {
    const split = splitEasingAt(OPEN, 0)
    expect(split?.bezier).toEqual(OPEN)
    expect(split?.progress).toBe(0)
    //the open curve's firm shove: y1/x1
    expect(split?.entrySlope).toBeCloseTo(OPEN[1] / OPEN[0], 6)
  })

  it("reports the eased progress already covered", () => {
    for (const at of [0.1, 0.4, 0.75]) {
      expect(splitEasingAt(OPEN, at)?.progress).toBeCloseTo(
        ease(OPEN, at),
        4,
      )
    }
  })

  it("traces the same path as the curve it was cut from", () => {
    //the remainder, replayed over the time that was left, must land on the original curve at
    //every point — that is what makes swapping it in invisible.
    for (const bezier of [OPEN, CLOSE]) {
      for (const at of [0.15, 0.39, 0.6, 0.9]) {
        const split = splitEasingAt(bezier, at)
        if (!split) throw new Error("expected a split")
        const span = 1 - split.progress
        for (let u = 0; u <= 1; u += 0.1) {
          const resumed = split.progress + span * ease(split.bezier, u)
          expect(resumed).toBeCloseTo(ease(bezier, at + (1 - at) * u), 3)
        }
      }
    }
  })

  it("continues at the speed the original had reached", () => {
    //`entrySlope` is normalised to the remainder's own box, so scaling it back by
    //(travel left / time left) has to reproduce the interrupted curve's slope at the seam.
    for (const bezier of [OPEN, CLOSE]) {
      for (const at of [0.2, 0.5, 0.8]) {
        const split = splitEasingAt(bezier, at)
        if (!split) throw new Error("expected a split")
        const scaled = (split.entrySlope * (1 - split.progress)) / (1 - at)
        expect(scaled).toBeCloseTo(slope(bezier, at), 2)
      }
    }
  })

  it("stays a legal cubic-bezier — x controls inside the unit interval", () => {
    for (const bezier of [OPEN, CLOSE]) {
      for (let at = 0; at < 1; at += 0.05) {
        const split = splitEasingAt(bezier, at)
        if (!split) continue
        expect(split.bezier[0]).toBeGreaterThanOrEqual(0)
        expect(split.bezier[0]).toBeLessThanOrEqual(1)
        expect(split.bezier[2]).toBeGreaterThanOrEqual(0)
        expect(split.bezier[2]).toBeLessThanOrEqual(1)
        expect(split.bezier.every(Number.isFinite)).toBe(true)
      }
    }
  })

  it("declines the tail, where there is nothing left to continue", () => {
    expect(splitEasingAt(OPEN, 1)).toBeNull()
    expect(splitEasingAt(OPEN, 0.99999)).toBeNull()
  })

  it("enters no slower than a fresh copy of the curve — the point of resuming at all", () => {
    //A decelerating curve has built up speed by the time it is interrupted, so restarting it
    //makes the sheet SLOW DOWN at the seam. Over the same travel in the same time, the remainder
    //never enters below the curve's own entry slope, and mid-flight it enters far above it.
    const fresh = OPEN[1] / OPEN[0]
    for (let at = 0; at <= 0.7; at += 0.05) {
      const split = splitEasingAt(OPEN, at)
      if (!split) throw new Error("expected a split")
      expect(split.entrySlope).toBeGreaterThanOrEqual(fresh)
    }
    //past that the two converge, and it stops mattering: the open curve has covered >98% of its
    //distance by then, so there is no travel left for a hesitation to be visible in.
    expect(ease(OPEN, 0.7)).toBeGreaterThan(0.98)
    //the interrupt this was built for: iOS's AutoFill bar landing 39% into the open slide,
    //measured on a physical iPhone. A restart entered at 0.66x the speed the sheet already had.
    const seam = splitEasingAt(OPEN, 0.392)
    expect(seam?.entrySlope).toBeCloseTo(3.63, 2)
    expect(seam?.bezier[0]).toBeCloseTo(0.189, 3)
    expect(seam?.bezier[1]).toBeCloseTo(0.685, 3)
  })
})

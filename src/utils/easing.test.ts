import { describe, expect, it } from "vitest"
import type { EasingBezier } from "#adaptv/utils/easing"
import { easingParamAtX, easingValueAtX } from "#adaptv/utils/easing"

//the drawer's open curve (firm shove → long decelerate, ends flat at y=1)…
const OPEN: EasingBezier = [0.32, 0.72, 0, 1]
//…and one that does NOT end flat, so nothing passes by symmetry alone
const CLOSE: EasingBezier = [0.6, 0.3, 0.15, 0.5]

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

describe("easingValueAtX", () => {
  it("pins both ends", () => {
    for (const bezier of [OPEN, CLOSE]) {
      expect(easingValueAtX(0, bezier)).toBeCloseTo(0, 6)
      expect(easingValueAtX(1, bezier)).toBeCloseTo(1, 6)
    }
  })

  it("clamps outside the duration rather than extrapolating", () => {
    expect(easingValueAtX(-0.5, OPEN)).toBeCloseTo(0, 6)
    expect(easingValueAtX(1.5, OPEN)).toBeCloseTo(1, 6)
  })

  it("rises monotonically for a monotonic curve", () => {
    let previous = -1
    for (let x = 0; x <= 1; x += 0.02) {
      const value = easingValueAtX(x, OPEN)
      expect(value).toBeGreaterThanOrEqual(previous)
      previous = value
    }
  })

  it("front-loads the open curve — half the travel by 16% of the duration", () => {
    //the tuning DRAWER_TRANSITIONS documents and forbids "fixing": that 16% IS
    //the shove, and the one time it moved to 22% the whole drawer read robotic.
    expect(easingValueAtX(0.16, OPEN)).toBeCloseTo(0.5, 2)
    expect(easingValueAtX(0.22, OPEN)).toBeGreaterThan(0.6)
  })
})

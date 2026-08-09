import { describe, expect, it } from "vitest"
import {
  DEFAULT_DRAWER_TRANSITION,
  DRAWER_TRANSITIONS,
} from "#adaptv/components/drawer/drawer-constants"
import type { EasingBezier } from "#adaptv/components/drawer/drawer-easing"
import type { PanelFlight } from "#adaptv/components/drawer/drawer-motion"
import { resumeDrawerTransition } from "#adaptv/components/drawer/drawer-motion"

const OPEN: EasingBezier = [...DRAWER_TRANSITIONS.EASE]

function flight(elapsed: number): PanelFlight {
  return {
    elapsed,
    left: DEFAULT_DRAWER_TRANSITION.duration * (1 - elapsed),
    bezier: OPEN,
  }
}

/** px/s the resumed transition starts at, from its own entry slope over travel/duration. */
function entrySpeed(
  transition: { bezier: EasingBezier; duration: number },
  travel: number,
) {
  const [x1, y1] = transition.bezier
  return ((y1 / x1) * travel) / transition.duration
}

describe("resumeDrawerTransition", () => {
  it("falls back to a fresh open when nothing was in flight", () => {
    expect(resumeDrawerTransition(null, 100, 140)).toBe(
      DEFAULT_DRAWER_TRANSITION,
    )
  })

  it("is the untouched open curve when the motion had not started", () => {
    const resumed = resumeDrawerTransition(flight(0), 422, 758)
    expect(resumed.bezier).toEqual(OPEN)
    //more travel than a fresh motion carries, but never longer than one
    expect(resumed.duration).toBe(DEFAULT_DRAWER_TRANSITION.duration)
  })

  describe("the iPhone's two-step keyboard raise", () => {
    // Measured on a physical device, cold cache: the open slide is 39% in, painting 59px from
    // its target, when iOS's password AutoFill bar adds 45px to the keyboard.
    const interrupted = flight(0.392)
    const resumed = resumeDrawerTransition(interrupted, 59, 59 + 45)

    it("keeps the sheet moving instead of restarting the curve", () => {
      //what the sheet was doing at the seam, from the interrupted curve
      const before = entrySpeed(
        { bezier: OPEN, duration: DEFAULT_DRAWER_TRANSITION.duration },
        0,
      )
      expect(before).toBe(0) //guards the helper: a fresh curve at zero travel goes nowhere
      const restart = entrySpeed(DEFAULT_DRAWER_TRANSITION, 104)
      const resumedSpeed = entrySpeed(resumed, 104)
      //a restart would enter at ~615px/s against the ~930px/s the sheet already had — the
      //visible "it hesitates, then crawls" of the first cold open.
      expect(restart).toBeLessThan(700)
      expect(resumedSpeed).toBeGreaterThan(1200)
    })

    it("spends the time the interrupted motion had left, plus the added travel", () => {
      //~231ms left on the open curve, ~45px added at ~930px/s ≈ 48ms
      expect(resumed.duration).toBeCloseTo(0.28, 2)
      expect(resumed.duration).toBeGreaterThan(interrupted.left)
      expect(resumed.duration).toBeLessThan(
        DEFAULT_DRAWER_TRANSITION.duration,
      )
    })
  })

  it("never runs longer than a fresh motion, however late the interrupt", () => {
    for (let at = 0; at < 1; at += 0.05) {
      const resumed = resumeDrawerTransition(
        flight(at),
        400 * (1 - at),
        800,
      )
      expect(resumed.duration).toBeLessThanOrEqual(
        DEFAULT_DRAWER_TRANSITION.duration,
      )
      expect(resumed.duration).toBeGreaterThan(0)
    }
  })

  it("does not stretch when the geometry change removes travel", () => {
    //a shrink mid-slide leaves LESS to cover; the remaining time is the floor, not a target
    const interrupted = flight(0.5)
    const resumed = resumeDrawerTransition(interrupted, 200, 120)
    expect(resumed.duration).toBeCloseTo(interrupted.left, 6)
  })
})

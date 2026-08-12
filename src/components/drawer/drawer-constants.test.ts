import { describe, expect, it } from "vitest"
import { dampenDrawerPull } from "#adaptv/components/drawer/drawer-constants"

/*
 * The upward pull, which had no test at all and was wrong in the one place a test would have
 * looked first.
 *
 * The engine rebases the drag's origin at the takeover, so `v` is 0 on the first frame of EVERY
 * upward drag — and the previous implementation (vaul's `dampenValue`, `8 * (log(v + 1) - 2)`)
 * returns -16 there. Negated by the caller, that threw the sheet 16px DOWN before it rose.
 *
 * So these are about the shape near zero as much as far out: a resistance curve that is
 * discontinuous at the origin is a shake, whatever it does afterwards.
 */
describe("dampenDrawerPull", () => {
  it("gives nothing away on the first frame — the kick this replaced", () => {
    //`v = 0` is not an edge case here, it is where every upward drag starts
    expect(dampenDrawerPull(0)).toBe(0)
    //and the approach to it is continuous, so there is no step to see either
    expect(dampenDrawerPull(0.001)).toBeLessThan(0.001)
  })

  it("never moves the sheet the wrong way, at any distance", () => {
    //the whole failure mode of the old curve, swept rather than spot-checked: it was negative
    //for its first 6.4px, which is most of the distance a slow exploratory pull ever covers
    for (let v = 0; v <= 400; v += 0.25) {
      expect(dampenDrawerPull(v)).toBeGreaterThanOrEqual(0)
    }
  })

  it("always resists — the sheet never outruns the finger", () => {
    for (let v = 0.5; v <= 400; v += 0.5) {
      expect(dampenDrawerPull(v)).toBeLessThan(v)
    }
  })

  it("resists MORE the further it is pulled", () => {
    //friction that builds, not a constant fraction: each additional pixel of finger has to buy
    //strictly less sheet than the one before it
    let previousGain = Number.POSITIVE_INFINITY
    for (let v = 1; v <= 200; v += 1) {
      const gain = dampenDrawerPull(v) - dampenDrawerPull(v - 1)
      expect(gain).toBeGreaterThan(0)
      expect(gain).toBeLessThan(previousGain)
      previousGain = gain
    }
  })

  it("keeps 55% of the finger at the start, which is what reads as friction", () => {
    //a curve that starts 1:1 follows the finger before it resists, and the resistance then
    //arrives as a change of pace. The sheet has to feel heavy from the first pixel instead.
    const slopeAtZero = dampenDrawerPull(0.01) / 0.01
    expect(slopeAtZero).toBeCloseTo(0.55, 2)
  })

  it("cannot be pulled off the top of the screen", () => {
    //the old curve was a logarithm: unbounded, so a long enough drag on a tall enough screen kept
    //buying travel. This one has a ceiling and approaches it from below, forever.
    expect(dampenDrawerPull(10_000)).toBeLessThan(40)
    expect(dampenDrawerPull(10_000)).toBeGreaterThan(
      dampenDrawerPull(1_000),
    )
  })

  it("keeps the far field the old curve had — that part was never wrong", () => {
    //what a hard pull buys is a taste decision that was already made and lived with; only the
    //near field is being corrected. Old: 15.5 / 20.9 / 24.7 at these distances.
    expect(dampenDrawerPull(50)).toBeCloseTo(16.3, 1)
    expect(dampenDrawerPull(100)).toBeCloseTo(23.2, 1)
    expect(dampenDrawerPull(160)).toBeCloseTo(27.5, 1)
  })
})

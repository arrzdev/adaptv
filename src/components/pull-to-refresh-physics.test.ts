import { describe, expect, it } from "vitest"
import {
  ACTIVATION_ROTATION_DEG,
  getActivationProgress,
  getPullVisuals,
  PULL_MAX,
  PULL_THRESHOLD,
  resolveGestureAxis,
  SPINNER_APPEAR_OFFSET,
} from "#adaptv/components/pull-to-refresh-physics"

describe("resolveGestureAxis", () => {
  it("stays pending until the finger clears the slop", () => {
    expect(resolveGestureAxis(0, 0)).toBe("pending")
    expect(resolveGestureAxis(4, 6)).toBe("pending")
    expect(resolveGestureAxis(-9, 9)).toBe("pending")
  })

  it("locks vertical for a mostly-downward drag (the pull)", () => {
    expect(resolveGestureAxis(0, 20)).toBe("vertical")
    expect(resolveGestureAxis(6, 30)).toBe("vertical")
  })

  it("locks horizontal for a mostly-sideways drag (not a pull)", () => {
    expect(resolveGestureAxis(20, 0)).toBe("horizontal")
    expect(resolveGestureAxis(30, 6)).toBe("horizontal")
  })

  it("breaks a diagonal tie toward horizontal so a pull is never ambiguous", () => {
    expect(resolveGestureAxis(15, 15)).toBe("horizontal")
  })
})

describe("getActivationProgress", () => {
  it("is 0 until the spinner appear offset", () => {
    expect(getActivationProgress(0)).toBe(0)
    expect(getActivationProgress(SPINNER_APPEAR_OFFSET - 1)).toBe(0)
    expect(getActivationProgress(SPINNER_APPEAR_OFFSET)).toBe(0)
  })

  it("ramps linearly to 1 at the threshold", () => {
    const mid = (SPINNER_APPEAR_OFFSET + PULL_THRESHOLD) / 2
    expect(getActivationProgress(mid)).toBeCloseTo(0.5)
    expect(getActivationProgress(PULL_THRESHOLD)).toBe(1)
  })

  it("clamps at 1 past the threshold", () => {
    expect(getActivationProgress(PULL_THRESHOLD + 100)).toBe(1)
  })
})

describe("getPullVisuals", () => {
  it("caps how far the content follows the finger at PULL_MAX", () => {
    expect(getPullVisuals(1000).contentY).toBe(PULL_MAX)
  })

  it("hides the spinner below the appear offset, shows it above", () => {
    expect(getPullVisuals(SPINNER_APPEAR_OFFSET - 1).showSpinner).toBe(
      false,
    )
    expect(getPullVisuals(SPINNER_APPEAR_OFFSET).showSpinner).toBe(true)
  })

  it("ramps opacity/rotation while pulling, before activation", () => {
    const v = getPullVisuals((SPINNER_APPEAR_OFFSET + PULL_THRESHOLD) / 2)
    expect(v.opacity).toBeCloseTo(0.5)
    expect(v.rotation).toBeCloseTo(0.5 * ACTIVATION_ROTATION_DEG)
    expect(v.scale).toBeGreaterThan(0.75)
    expect(v.scale).toBeLessThan(1)
  })

  it("pins to the committed state once past the threshold", () => {
    const v = getPullVisuals(PULL_THRESHOLD + 20)
    expect(v.opacity).toBe(1)
    expect(v.arcProgress).toBe(1)
    expect(v.rotation).toBe(ACTIVATION_ROTATION_DEG)
    expect(v.scale).toBeCloseTo(1)
  })
})

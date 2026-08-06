import { describe, expect, it } from "vitest"
import type { SwipeReleaseConfig } from "#adaptv/components/swipeable-physics"
import {
  resolveSwipeRelease,
  SPRING_SUBSTEP,
  springStep,
} from "#adaptv/components/swipeable-physics"

//the shipped defaults, so the thresholds under test are the real ones
const CFG: SwipeReleaseConfig = {
  openThreshold: 0.3,
  closeThreshold: 0.25,
  velocityThreshold: 250,
}
const W = 80 //a typical action width

describe("springStep", () => {
  it("converges to the target and settles without exploding", () => {
    let pos = -W
    let vel = 0
    //integrate ~1s of a stiff, heavily damped spring at the engine's substep
    for (let t = 0; t < 240; t += 1) {
      const r = springStep(pos, vel, 0, 500, 55, 0.8, SPRING_SUBSTEP)
      pos = r.pos
      vel = r.vel
      expect(Number.isFinite(pos)).toBe(true)
    }
    expect(Math.abs(pos)).toBeLessThan(0.5)
    expect(Math.abs(vel)).toBeLessThan(1)
  })

  it("stays stable at a large single dt (the slow-frame guard's premise)", () => {
    //the engine sub-steps precisely because a big dt rings; confirm the substep
    //itself does not, so the sub-stepping is the only thing standing between us
    //and an overshoot
    const r = springStep(-W, 0, 0, 500, 40, 0.8, SPRING_SUBSTEP)
    expect(r.pos).toBeGreaterThan(-W) //moved toward 0
    expect(r.pos).toBeLessThan(0) //did not overshoot past target in one substep
  })
})

describe("resolveSwipeRelease · from closed", () => {
  it("opens right past the position threshold (a left drag)", () => {
    const r = resolveSwipeRelease({
      x: -W * 0.5,
      vel: 0,
      lw: W,
      rw: W,
      wasOpen: false,
      cfg: CFG,
    })
    expect(r).toEqual({ action: "open", side: "right" })
  })

  it("opens left past the position threshold (a right drag)", () => {
    const r = resolveSwipeRelease({
      x: W * 0.5,
      vel: 0,
      lw: W,
      rw: W,
      wasOpen: false,
      cfg: CFG,
    })
    expect(r).toEqual({ action: "open", side: "left" })
  })

  it("snaps closed below the position threshold", () => {
    const r = resolveSwipeRelease({
      x: -W * 0.2, //under 0.3·W
      vel: 0,
      lw: W,
      rw: W,
      wasOpen: false,
      cfg: CFG,
    })
    expect(r).toEqual({ action: "close" })
  })

  it("a fast flick opens even from under the position threshold", () => {
    const r = resolveSwipeRelease({
      x: -4,
      vel: -600, //well past velocityThreshold, leftward
      lw: W,
      rw: W,
      wasOpen: false,
      cfg: CFG,
    })
    expect(r).toEqual({ action: "open", side: "right" })
  })

  it("does not open a side that has no actions, even past threshold", () => {
    //dragged right hard, but there are no left actions (lw = 0)
    const r = resolveSwipeRelease({
      x: W,
      vel: 0,
      lw: 0,
      rw: W,
      wasOpen: false,
      cfg: CFG,
    })
    expect(r).toEqual({ action: "close" })
  })

  it("ignores a flick toward a walled-off side", () => {
    const r = resolveSwipeRelease({
      x: 2,
      vel: 600, //flick right, but lw = 0
      lw: 0,
      rw: W,
      wasOpen: false,
      cfg: CFG,
    })
    expect(r).toEqual({ action: "close" })
  })
})

describe("resolveSwipeRelease · from an open row", () => {
  it("holds open when barely retreated", () => {
    const r = resolveSwipeRelease({
      x: -W * 0.9,
      vel: 0,
      lw: W,
      rw: W,
      wasOpen: "right",
      cfg: CFG,
    })
    expect(r).toEqual({ action: "open", side: "right" })
  })

  it("closes when retreated past the close threshold", () => {
    //right-open closes once x rises above −rw·(1−closeThreshold) = −60
    const r = resolveSwipeRelease({
      x: -40,
      vel: 0,
      lw: W,
      rw: W,
      wasOpen: "right",
      cfg: CFG,
    })
    expect(r).toEqual({ action: "close" })
  })

  it("a flick back from open closes with its momentum seeded", () => {
    const r = resolveSwipeRelease({
      x: -W,
      vel: 500, //rightward flick (toward closed) from a right-open row
      lw: 0, //no left actions to swap into
      rw: W,
      wasOpen: "right",
      cfg: CFG,
    })
    expect(r).toEqual({ action: "close", velocity: 500 })
  })

  it("a flick THROUGH an open row swaps to the opposite side", () => {
    //open right, still left of centre, flicked hard leftward with left actions
    //present → don't just re-open right, swap to left
    const r = resolveSwipeRelease({
      x: W * 0.2,
      vel: 600,
      lw: W,
      rw: W,
      wasOpen: "right",
      cfg: CFG,
    })
    expect(r).toEqual({ action: "open", side: "left" })
  })
})

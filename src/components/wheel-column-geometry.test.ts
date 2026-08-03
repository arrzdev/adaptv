import { describe, expect, it } from "vitest"
import {
  snapIndex,
  WHEEL_ITEM_HEIGHT,
  wheelRowTransform,
} from "#adaptv/components/wheel-column-geometry"

const H = WHEEL_ITEM_HEIGHT // 30

const num = (
  transform: string,
  fn: "translateY" | "translateZ" | "rotateX",
) => {
  const m = transform.match(new RegExp(`${fn}\\(([-0-9.]+)(?:px|deg)\\)`))
  if (!m) throw new Error(`no ${fn} in ${transform}`)
  return Number(m[1])
}

describe("snapIndex", () => {
  it("rounds a scroll offset to the nearest row", () => {
    expect(snapIndex(0, 24)).toBe(0)
    expect(snapIndex(H * 9, 24)).toBe(9)
    expect(snapIndex(H * 9 + 14, 24)).toBe(9) // just under halfway
    expect(snapIndex(H * 9 + 15, 24)).toBe(10) // at/over halfway rounds up
  })

  it("clamps to the list at both ends", () => {
    expect(snapIndex(-500, 24)).toBe(0)
    expect(snapIndex(999999, 24)).toBe(23)
  })

  it("never returns a negative index for an empty list", () => {
    expect(snapIndex(120, 0)).toBe(0)
  })
})

describe("wheelRowTransform", () => {
  it("is the identity at the centre row", () => {
    const t = wheelRowTransform(0)
    expect(num(t, "translateY")).toBeCloseTo(0)
    expect(num(t, "translateZ")).toBeCloseTo(0)
    expect(num(t, "rotateX")).toBeCloseTo(0)
  })

  it("tilts opposite ways above and below centre (a symmetric drum)", () => {
    const above = wheelRowTransform(-1)
    const below = wheelRowTransform(1)
    // one step is 22° of tilt; rotateX is negated in the transform
    expect(num(below, "rotateX")).toBeCloseTo(-22)
    expect(num(above, "rotateX")).toBeCloseTo(22)
    // and the vertical offsets mirror each other
    expect(num(above, "translateY")).toBeCloseTo(-num(below, "translateY"))
  })

  it("foreshortens: a far row pulls IN toward centre vs its flat slot", () => {
    // a row 2 slots down sits at flatY = 60px; the drum pulls it closer, so the
    // net translateY (drumY − flatY) is well short of −60 in magnitude
    const t = wheelRowTransform(2)
    expect(Math.abs(num(t, "translateY"))).toBeLessThan(2 * H)
    // and it is pushed back in depth
    expect(num(t, "translateZ")).toBeLessThan(0)
  })

  it("clamps the tilt at the rim so far rows don't invert", () => {
    // 5 rows × 22° = 110°, clamped to the 84° max
    expect(num(wheelRowTransform(5), "rotateX")).toBeCloseTo(-84)
    expect(num(wheelRowTransform(-5), "rotateX")).toBeCloseTo(84)
    // and it stays clamped no matter how far
    expect(num(wheelRowTransform(50), "rotateX")).toBeCloseTo(-84)
  })
})

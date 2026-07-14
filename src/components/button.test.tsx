import { describe, expect, it } from "vitest"
import { resolveButtonHaptic } from "#nativ/components/button"

describe("resolveButtonHaptic", () => {
  it("maps `true` to a light tap", () => {
    expect(resolveButtonHaptic(true)).toBe("light")
  })

  it("passes an explicit weight through", () => {
    expect(resolveButtonHaptic("medium")).toBe("medium")
    expect(resolveButtonHaptic("heavy")).toBe("heavy")
  })

  it("is null (no haptic) for false / undefined", () => {
    expect(resolveButtonHaptic(false)).toBeNull()
    expect(resolveButtonHaptic(undefined)).toBeNull()
  })
})

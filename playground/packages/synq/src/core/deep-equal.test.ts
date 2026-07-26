import { describe, expect, it } from "vitest"
import { deepEqual } from "#synq/core/deep-equal"

describe("deepEqual", () => {
  it("compares primitives", () => {
    expect(deepEqual(1, 1)).toBe(true)
    expect(deepEqual("a", "a")).toBe(true)
    expect(deepEqual(1, 2)).toBe(false)
    expect(deepEqual(1, "1")).toBe(false)
    expect(deepEqual(null, null)).toBe(true)
    expect(deepEqual(null, undefined)).toBe(false)
  })

  it("compares nested objects regardless of key order", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    expect(deepEqual({ a: { c: 3 } }, { a: { c: 3 } })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })

  it("compares arrays positionally", () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true)
    expect(deepEqual([1, 2], [2, 1])).toBe(false)
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false)
  })

  it("does not treat arrays and objects as equal", () => {
    expect(deepEqual([], {})).toBe(false)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createWarnOnce, resetWarnOnce } from "#adaptv/utils/warn-once"

describe("createWarnOnce", () => {
  let error: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    error = vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    error.mockRestore()
  })

  it("logs a key once, prefixed with the component", () => {
    const warnings = createWarnOnce("Thing")
    warnings.warn("a", "first")
    warnings.warn("a", "first again")
    warnings.warn("b", "second")
    expect(error.mock.calls).toEqual([
      ["[adaptv] Thing: first"],
      ["[adaptv] Thing: second"],
    ])
  })

  it("keeps each component's keys apart, and re-arms them on reset", () => {
    const one = createWarnOnce("One")
    const two = createWarnOnce("Two")
    one.warn("same", "from one")
    two.warn("same", "from two")
    expect(error).toHaveBeenCalledTimes(2)
    one.reset()
    one.warn("same", "from one")
    two.warn("same", "from two")
    expect(error).toHaveBeenCalledTimes(3)
    resetWarnOnce()
    two.warn("same", "from two")
    expect(error).toHaveBeenCalledTimes(4)
  })
})

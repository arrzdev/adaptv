import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resetPrint } from "#adaptv/capabilities/print"
import { usePrint } from "#adaptv/hooks/use-print"

vi.mock("#adaptv/utils/platform", () => ({
  isNativePlatform: vi.fn(() => false),
}))

beforeEach(() => {
  resetPrint()
  vi.stubGlobal("print", () => {
    window.dispatchEvent(new Event("beforeprint"))
    window.dispatchEvent(new Event("afterprint"))
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("usePrint", () => {
  it("reads the status and carries the outcome of the last print", async () => {
    const { result } = renderHook(() => usePrint())
    expect(result.current.status).toBe("available")
    expect(result.current.printing).toBe(false)
    expect(result.current.last).toBeNull()
    await act(async () => {
      expect(await result.current.print()).toBe("opened")
    })
    expect(result.current.last).toBe("opened")
    expect(result.current.printing).toBe(false)
  })

  it("flips printing while a dialog is up", async () => {
    vi.stubGlobal("print", () => {
      window.dispatchEvent(new Event("beforeprint"))
    })
    const { result } = renderHook(() => usePrint())
    let pending: Promise<unknown> = Promise.resolve()
    act(() => {
      pending = result.current.print()
    })
    expect(result.current.printing).toBe(true)
    await act(async () => {
      window.dispatchEvent(new Event("afterprint"))
      await pending
    })
    expect(result.current.printing).toBe(false)
    expect(result.current.last).toBe("opened")
  })
})

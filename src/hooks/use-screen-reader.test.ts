import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  announce,
  getScreenReaderState,
  subscribeScreenReader,
} from "#adaptv/capabilities/screen-reader"
import { useScreenReader } from "#adaptv/hooks/use-screen-reader"

let snapshot = { status: "unknown" as const }
let notify: (() => void) | null = null
const unsubscribe = vi.fn()

vi.mock("#adaptv/capabilities/screen-reader", () => ({
  getScreenReaderState: vi.fn(() => snapshot),
  subscribeScreenReader: vi.fn((cb: () => void) => {
    notify = cb
    return unsubscribe
  }),
  announce: vi.fn(async () => "announced"),
}))

beforeEach(() => {
  snapshot = { status: "unknown" }
  notify = null
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("useScreenReader", () => {
  it("reads the snapshot, follows the store, and lets go on unmount", () => {
    const { result, unmount } = renderHook(() => useScreenReader())
    expect(result.current.status).toBe("unknown")
    expect(subscribeScreenReader).toHaveBeenCalledTimes(1)
    expect(getScreenReaderState).toHaveBeenCalled()
    snapshot = { status: "on" as never }
    act(() => notify?.())
    expect(result.current.status).toBe("on")
    unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it("hands announce through unchanged", async () => {
    const { result } = renderHook(() => useScreenReader())
    await expect(
      result.current.announce("Saved", { language: "en" }),
    ).resolves.toBe("announced")
    expect(announce).toHaveBeenCalledWith("Saved", { language: "en" })
  })
})

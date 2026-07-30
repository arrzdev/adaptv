import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  canShareTarget,
  isShareSupported,
  share,
} from "#adaptv/capabilities/share"
import { useShare } from "#adaptv/hooks/use-share"

vi.mock("#adaptv/capabilities/share", () => ({
  isShareSupported: vi.fn(() => true),
  canShareTarget: vi.fn(() => true),
  share: vi.fn(() => Promise.resolve("shared")),
}))

//`clearAllMocks` keeps implementations, so restate the defaults each test
//deviates from — otherwise one test's `mockReturnValue` leaks into the next
beforeEach(() => {
  vi.mocked(isShareSupported).mockReturnValue(true)
  vi.mocked(canShareTarget).mockReturnValue(true)
  vi.mocked(share).mockResolvedValue("shared")
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("useShare", () => {
  it("exposes `supported` so a share button can be hidden, not broken", () => {
    //the entire reason this hook returns an object rather than a function: on
    //desktop Chrome there is no sheet, and a button that silently does nothing
    //is worse than no button
    vi.mocked(isShareSupported).mockReturnValue(false)
    const { result } = renderHook(() => useShare())
    expect(result.current.supported).toBe(false)
  })

  it("passes the payload gate through", () => {
    vi.mocked(isShareSupported).mockReturnValue(true)
    vi.mocked(canShareTarget).mockReturnValue(false)
    const { result } = renderHook(() => useShare())
    expect(result.current.supported).toBe(true)
    expect(result.current.canShare({ text: "hi" })).toBe(false)
  })

  it("records a dismissal as an outcome, not an error", async () => {
    vi.mocked(isShareSupported).mockReturnValue(true)
    vi.mocked(share).mockResolvedValueOnce("dismissed")
    const { result } = renderHook(() => useShare())

    await act(async () => {
      await result.current.share({ text: "hi" })
    })

    expect(result.current.outcome).toBe("dismissed")
    expect(result.current.error).toBeNull()
  })

  it("captures a rejected share as state instead of rethrowing", async () => {
    //the accessor only rejects for a missing user gesture — a real bug, but one
    //the app should render, not one every call site has to try/catch
    vi.mocked(isShareSupported).mockReturnValue(true)
    vi.mocked(share).mockRejectedValueOnce(new Error("NotAllowedError"))
    const { result } = renderHook(() => useShare())

    let returned: unknown
    await act(async () => {
      returned = await result.current.share({ text: "hi" })
    })

    expect(returned).toBeNull()
    expect(result.current.error?.message).toBe("NotAllowedError")
    expect(result.current.sharing).toBe(false)
  })
})

import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  getKeepAwakeCaveat,
  isKeepAwakeActive,
  isKeepAwakeSupported,
  releaseKeepAwake,
  requestKeepAwake,
  subscribeKeepAwake,
} from "#adaptv/capabilities/keep-awake"
import { useKeepAwake } from "#adaptv/hooks/use-keep-awake"

let notify: (() => void) | null = null

vi.mock("#adaptv/capabilities/keep-awake", () => ({
  isKeepAwakeSupported: vi.fn(() => true),
  isKeepAwakeActive: vi.fn(() => false),
  getKeepAwakeCaveat: vi.fn(() => null),
  requestKeepAwake: vi.fn(() => Promise.resolve("held")),
  releaseKeepAwake: vi.fn(() => Promise.resolve()),
  subscribeKeepAwake: vi.fn((cb: () => void) => {
    notify = cb
    return () => {
      notify = null
    }
  }),
}))

//`clearAllMocks` keeps implementations, so restate the defaults each test
//deviates from — otherwise one test's `mockReturnValue` leaks into the next
beforeEach(() => {
  vi.mocked(isKeepAwakeSupported).mockReturnValue(true)
  vi.mocked(isKeepAwakeActive).mockReturnValue(false)
  vi.mocked(getKeepAwakeCaveat).mockReturnValue(null)
  vi.mocked(requestKeepAwake).mockResolvedValue("held")
})

afterEach(() => {
  notify = null
  vi.clearAllMocks()
})

describe("useKeepAwake", () => {
  it("reports the gap when there is no wake-lock API", () => {
    vi.mocked(isKeepAwakeSupported).mockReturnValue(false)
    const { result } = renderHook(() => useKeepAwake())
    expect(result.current.supported).toBe(false)
    expect(result.current.active).toBe(false)
  })

  it("surfaces the caveat separately from `supported`", async () => {
    //supported:false means "hide the toggle"; a caveat means "show it, with a
    //warning" — the platform can resolve the lock and still dim the screen
    vi.mocked(isKeepAwakeSupported).mockReturnValue(true)
    vi.mocked(getKeepAwakeCaveat).mockReturnValue("WebKit bug 254545")
    const { result } = renderHook(() => useKeepAwake())

    await waitFor(() =>
      expect(result.current.caveat).toBe("WebKit bug 254545"),
    )
    expect(result.current.supported).toBe(true)
  })

  it("records a refused request rather than throwing", async () => {
    vi.mocked(requestKeepAwake).mockResolvedValueOnce("rejected")
    const { result } = renderHook(() => useKeepAwake())

    await act(async () => {
      await result.current.request()
    })

    expect(result.current.lastOutcome).toBe("rejected")
  })

  it("tracks the platform dropping the lock behind our back", () => {
    vi.mocked(isKeepAwakeActive).mockReturnValue(true)
    const { result } = renderHook(() => useKeepAwake())
    expect(result.current.active).toBe(true)

    vi.mocked(isKeepAwakeActive).mockReturnValue(false)
    act(() => notify?.())

    expect(result.current.active).toBe(false)
  })

  it("holds for the lifetime of the component when enabled", async () => {
    const { unmount } = renderHook(() => useKeepAwake({ enabled: true }))
    await waitFor(() => expect(requestKeepAwake).toHaveBeenCalled())

    unmount()
    expect(releaseKeepAwake).toHaveBeenCalled()
  })

  it("does not take the lock when it is not enabled", () => {
    renderHook(() => useKeepAwake())
    expect(requestKeepAwake).not.toHaveBeenCalled()
    expect(subscribeKeepAwake).toHaveBeenCalled()
  })
})

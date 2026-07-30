import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  getScreenOrientation,
  isOrientationLockSupported,
  lockScreenOrientation,
  subscribeScreenOrientation,
  unlockScreenOrientation,
} from "#adaptv/capabilities/orientation"
import { useOrientation } from "#adaptv/hooks/use-orientation"

let notify: (() => void) | null = null

vi.mock("#adaptv/capabilities/orientation", () => ({
  getScreenOrientation: vi.fn(() => "portrait-primary"),
  isOrientationLockSupported: vi.fn(() => true),
  lockScreenOrientation: vi.fn(() => Promise.resolve("ok")),
  unlockScreenOrientation: vi.fn(() => Promise.resolve("ok")),
  subscribeScreenOrientation: vi.fn((cb: () => void) => {
    notify = cb
    return () => {
      notify = null
    }
  }),
}))

//`clearAllMocks` keeps implementations, so restate the defaults each test
//deviates from — otherwise one test's `mockReturnValue` leaks into the next
beforeEach(() => {
  vi.mocked(getScreenOrientation).mockReturnValue("portrait-primary")
  vi.mocked(isOrientationLockSupported).mockReturnValue(true)
  vi.mocked(lockScreenOrientation).mockResolvedValue("ok")
  vi.mocked(unlockScreenOrientation).mockResolvedValue("ok")
})

afterEach(() => {
  notify = null
  vi.clearAllMocks()
})

describe("useOrientation", () => {
  it("reads the orientation and its coarse axis", () => {
    vi.mocked(getScreenOrientation).mockReturnValue("landscape-secondary")
    const { result } = renderHook(() => useOrientation())
    expect(result.current.orientation).toBe("landscape-secondary")
    expect(result.current.isPortrait).toBe(false)
  })

  it("re-renders when the store notifies", () => {
    vi.mocked(getScreenOrientation).mockReturnValue("portrait-primary")
    const { result } = renderHook(() => useOrientation())
    expect(subscribeScreenOrientation).toHaveBeenCalled()

    vi.mocked(getScreenOrientation).mockReturnValue("landscape-primary")
    act(() => notify?.())

    expect(result.current.orientation).toBe("landscape-primary")
  })

  it("reports lockSupported: false on iOS, where reading still works", () => {
    //the split that matters — orientation is always readable, and never
    //lockable on WebKit. A single `supported` flag would hide half of that.
    vi.mocked(isOrientationLockSupported).mockReturnValue(false)
    const { result } = renderHook(() => useOrientation())
    expect(result.current.orientation).toBe("portrait-primary")
    expect(result.current.lockSupported).toBe(false)
  })

  it("records a refused lock as an outcome", async () => {
    vi.mocked(lockScreenOrientation).mockResolvedValueOnce("rejected")
    const { result } = renderHook(() => useOrientation())

    await act(async () => {
      await result.current.lock("landscape")
    })

    expect(result.current.lastOutcome).toBe("rejected")
  })

  it("records the unlock outcome too", async () => {
    vi.mocked(unlockScreenOrientation).mockResolvedValueOnce("unsupported")
    const { result } = renderHook(() => useOrientation())

    await act(async () => {
      await result.current.unlock()
    })

    expect(result.current.lastOutcome).toBe("unsupported")
  })
})

import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  disablePrivacyScreen,
  enablePrivacyScreen,
  getPrivacyScreenSupport,
  readPrivacyScreen,
} from "#adaptv/capabilities/privacy-screen"
import { usePrivacyScreen } from "#adaptv/hooks/use-privacy-screen"

vi.mock("#adaptv/capabilities/privacy-screen", () => ({
  getPrivacyScreenSupport: vi.fn(() => "available"),
  getPrivacyScreenCaveat: vi.fn(() => "covers the switcher"),
  readPrivacyScreen: vi.fn(async () => false),
  enablePrivacyScreen: vi.fn(async () => "applied"),
  disablePrivacyScreen: vi.fn(async () => "applied"),
}))

beforeEach(() => {
  vi.mocked(getPrivacyScreenSupport).mockReturnValue("available")
  vi.mocked(readPrivacyScreen).mockResolvedValue(false)
  vi.mocked(enablePrivacyScreen).mockResolvedValue("applied")
  vi.mocked(disablePrivacyScreen).mockResolvedValue("applied")
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("usePrivacyScreen", () => {
  it("reads the header's answer once mounted, and the OS's state once it has answered", async () => {
    const { result } = renderHook(() => usePrivacyScreen())
    expect(result.current.enabled).toBeNull()
    await waitFor(() => expect(result.current.enabled).toBe(false))
    expect(result.current.support).toBe("available")
    expect(result.current.caveat).toBe("covers the switcher")
    expect(readPrivacyScreen).toHaveBeenCalledTimes(1)
  })

  it("an applied enable or disable moves the state without asking again", async () => {
    const { result } = renderHook(() => usePrivacyScreen())
    await waitFor(() => expect(result.current.enabled).toBe(false))
    await act(async () => {
      await result.current.enable({ cover: "obscure" })
    })
    expect(enablePrivacyScreen).toHaveBeenCalledWith({ cover: "obscure" })
    expect(result.current.last).toBe("applied")
    expect(result.current.enabled).toBe(true)
    await act(async () => {
      await result.current.disable()
    })
    expect(result.current.last).toBe("applied")
    expect(result.current.enabled).toBe(false)
    expect(readPrivacyScreen).toHaveBeenCalledTimes(1)
  })

  it("a failed call re-reads the OS rather than guessing", async () => {
    const { result } = renderHook(() => usePrivacyScreen())
    await waitFor(() => expect(result.current.enabled).toBe(false))
    vi.mocked(enablePrivacyScreen).mockResolvedValue("failed")
    vi.mocked(readPrivacyScreen).mockResolvedValue(true)
    await act(async () => {
      await result.current.enable()
    })
    expect(result.current.last).toBe("failed")
    expect(result.current.enabled).toBe(true)
    expect(readPrivacyScreen).toHaveBeenCalledTimes(2)
  })

  it("unsupported everywhere reads unsupported, null, and the outcome word", async () => {
    vi.mocked(getPrivacyScreenSupport).mockReturnValue("unsupported")
    vi.mocked(readPrivacyScreen).mockResolvedValue(null)
    vi.mocked(enablePrivacyScreen).mockResolvedValue("unsupported")
    const { result } = renderHook(() => usePrivacyScreen())
    await waitFor(() => expect(result.current.support).toBe("unsupported"))
    expect(result.current.enabled).toBeNull()
    await act(async () => {
      await result.current.enable()
    })
    expect(result.current.last).toBe("unsupported")
    expect(result.current.enabled).toBeNull()
  })
})

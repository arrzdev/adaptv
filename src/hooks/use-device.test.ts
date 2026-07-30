import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { DeviceInfo } from "#adaptv/capabilities/device"
import {
  getDeviceId,
  getDeviceInfo,
  getLanguageTag,
} from "#adaptv/capabilities/device"
import { useDevice } from "#adaptv/hooks/use-device"

const WEB_INFO: DeviceInfo = {
  platform: "web",
  os: "web",
  osVersion: null,
  model: null,
  manufacturer: null,
  isVirtual: null,
  webViewVersion: "141.0",
}

vi.mock("#adaptv/capabilities/device", () => ({
  getDeviceInfo: vi.fn(),
  getDeviceId: vi.fn(() => Promise.resolve(null)),
  getLanguageTag: vi.fn(() => "en-GB"),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe("useDevice", () => {
  it("starts loading and settles on the record", async () => {
    vi.mocked(getDeviceInfo).mockResolvedValue(WEB_INFO)
    const { result } = renderHook(() => useDevice())

    expect(result.current.loading).toBe(true)
    expect(result.current.info).toBeNull()

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.info).toEqual(WEB_INFO)
    expect(result.current.languageTag).toBe("en-GB")
    expect(getLanguageTag).toHaveBeenCalled()
  })

  it("keeps the web nulls rather than inventing values", async () => {
    //a device sheet built on this renders "not reported here" for each null —
    //which on web is most of the record, and that is the honest answer
    vi.mocked(getDeviceInfo).mockResolvedValue(WEB_INFO)
    const { result } = renderHook(() => useDevice())

    await waitFor(() => expect(result.current.info).not.toBeNull())
    expect(result.current.info?.model).toBeNull()
    expect(result.current.info?.isVirtual).toBeNull()
    expect(result.current.id).toBeNull()
  })

  it("carries the native id through when there is one", async () => {
    vi.mocked(getDeviceInfo).mockResolvedValue({
      ...WEB_INFO,
      platform: "native",
      os: "ios",
      model: "iPhone15,2",
    })
    vi.mocked(getDeviceId).mockResolvedValue("abc-123")
    const { result } = renderHook(() => useDevice())

    await waitFor(() => expect(result.current.id).toBe("abc-123"))
    expect(result.current.info?.model).toBe("iPhone15,2")
  })
})

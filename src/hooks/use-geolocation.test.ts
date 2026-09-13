import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { GeoCoords } from "#adaptv/capabilities/geolocation"
import {
  checkGeoPermission,
  getCurrentPosition,
  requestGeoPermission,
} from "#adaptv/capabilities/geolocation"
import { useGeolocation } from "#adaptv/hooks/use-geolocation"

vi.mock("#adaptv/capabilities/geolocation", () => ({
  checkGeoPermission: vi.fn(),
  getCurrentPosition: vi.fn(),
  requestGeoPermission: vi.fn(),
}))

const HERE: GeoCoords = {
  latitude: 38.7223,
  longitude: -9.1393,
  accuracy: 12,
}

beforeEach(() => {
  vi.mocked(requestGeoPermission).mockResolvedValue("granted")
  vi.mocked(checkGeoPermission).mockResolvedValue("granted")
  vi.mocked(getCurrentPosition).mockResolvedValue(HERE)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("useGeolocation", () => {
  it("asks, then reads once — loading for exactly the length of the call", async () => {
    let answer: (coords: GeoCoords) => void = () => {}
    vi.mocked(getCurrentPosition).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    const { result } = renderHook(() => useGeolocation())
    expect(result.current).toMatchObject({
      coords: null,
      permission: "prompt",
      loading: false,
    })

    const options = { highAccuracy: true, timeoutMs: 5000 }
    let located: Promise<GeoCoords | null> = Promise.resolve(null)
    await act(async () => {
      located = result.current.locate(options)
    })
    expect(result.current.loading).toBe(true)
    expect(result.current.permission).toBe("granted")
    expect(getCurrentPosition).toHaveBeenCalledWith(options)

    await act(async () => {
      answer(HERE)
      await located
    })
    await expect(located).resolves.toBe(HERE)
    expect(result.current).toMatchObject({
      coords: HERE,
      error: null,
      loading: false,
    })
  })

  it("never reads the position when permission is refused, and says why", async () => {
    vi.mocked(requestGeoPermission).mockResolvedValueOnce("denied")
    const { result } = renderHook(() => useGeolocation())

    let located: GeoCoords | null = HERE
    await act(async () => {
      located = await result.current.locate()
    })

    expect(located).toBeNull()
    expect(getCurrentPosition).not.toHaveBeenCalled()
    expect(result.current.permission).toBe("denied")
    expect(result.current.error?.message).toBe(
      "Location permission not granted",
    )
    expect(result.current.loading).toBe(false)
  })

  it("normalises a non-Error failure, and clears it on the next attempt", async () => {
    vi.mocked(getCurrentPosition).mockRejectedValueOnce({ code: 3 })
    const { result } = renderHook(() => useGeolocation())

    await act(async () => {
      await result.current.locate()
    })
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.error?.message).toBe("Location failed")

    await act(async () => {
      await result.current.locate()
    })
    expect(result.current.error).toBeNull()
    expect(result.current.coords).toBe(HERE)
  })

  it("refreshes the permission without prompting", async () => {
    vi.mocked(checkGeoPermission).mockResolvedValueOnce("unavailable")
    const { result } = renderHook(() => useGeolocation())

    await act(async () => {
      await expect(result.current.refreshPermission()).resolves.toBe(
        "unavailable",
      )
    })
    expect(result.current.permission).toBe("unavailable")
    expect(requestGeoPermission).not.toHaveBeenCalled()
  })
})

import { Geolocation } from "@capacitor/geolocation"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  checkGeoPermission,
  getCurrentPosition,
  requestGeoPermission,
} from "#nativ/capabilities/geolocation"

vi.mock("@capacitor/geolocation", () => ({
  Geolocation: {
    checkPermissions: vi.fn(() =>
      Promise.resolve({ location: "granted" }),
    ),
    requestPermissions: vi.fn(() =>
      Promise.resolve({ location: "granted" }),
    ),
    getCurrentPosition: vi.fn(() =>
      Promise.resolve({
        coords: { latitude: 1, longitude: 2, accuracy: 3 },
      }),
    ),
  },
}))

const restores: Array<() => void> = []

function forceNative(native: boolean): void {
  vi.stubGlobal(
    "Capacitor",
    native ? { isNativePlatform: () => true } : undefined,
  )
}

function stubNavigatorProp(key: string, value: unknown): void {
  const prev = Object.getOwnPropertyDescriptor(navigator, key)
  Object.defineProperty(navigator, key, { value, configurable: true })
  restores.push(() => {
    if (prev) Object.defineProperty(navigator, key, prev)
    else delete (navigator as unknown as Record<string, unknown>)[key]
  })
}

afterEach(() => {
  for (const r of restores.splice(0)) r()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("geolocation — native", () => {
  it("normalises the permission state", async () => {
    forceNative(true)
    expect(await checkGeoPermission()).toBe("granted")

    vi.mocked(Geolocation.checkPermissions).mockResolvedValueOnce({
      location: "denied",
    } as Awaited<ReturnType<typeof Geolocation.checkPermissions>>)
    expect(await checkGeoPermission()).toBe("denied")

    vi.mocked(Geolocation.checkPermissions).mockResolvedValueOnce({
      location: "prompt-with-rationale",
    } as Awaited<ReturnType<typeof Geolocation.checkPermissions>>)
    expect(await checkGeoPermission()).toBe("prompt")
  })

  it("reads + normalises the position", async () => {
    forceNative(true)
    expect(await getCurrentPosition()).toEqual({
      latitude: 1,
      longitude: 2,
      accuracy: 3,
    })
  })

  it("requests permission via the native dialog", async () => {
    forceNative(true)
    expect(await requestGeoPermission()).toBe("granted")
    expect(Geolocation.requestPermissions).toHaveBeenCalled()
  })
})

describe("geolocation — web", () => {
  it("reads position from navigator.geolocation", async () => {
    forceNative(false)
    stubNavigatorProp("geolocation", {
      getCurrentPosition: (success: PositionCallback) =>
        success({
          coords: { latitude: 4, longitude: 5, accuracy: 6 },
        } as GeolocationPosition),
    })
    expect(await getCurrentPosition()).toEqual({
      latitude: 4,
      longitude: 5,
      accuracy: 6,
    })
  })

  it("reads permission from the Permissions API", async () => {
    forceNative(false)
    stubNavigatorProp("permissions", {
      query: () => Promise.resolve({ state: "denied" }),
    })
    expect(await checkGeoPermission()).toBe("denied")
  })

  it("rejects when geolocation is unavailable", async () => {
    forceNative(false)
    stubNavigatorProp("geolocation", undefined)
    await expect(getCurrentPosition()).rejects.toThrow()
  })
})

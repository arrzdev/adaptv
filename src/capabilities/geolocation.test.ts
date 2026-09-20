import { Geolocation } from "@capacitor/geolocation"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  checkGeoPermission,
  getCurrentPosition,
  requestGeoPermission,
} from "#adaptv/capabilities/geolocation"

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

/**
 * A position error shaped like the browser's: GeolocationPositionError carries
 * `code` and `message` as getters on its prototype, not as own properties.
 */
function positionError(code: number, message: string) {
  return Object.create({
    get code() {
      return code
    },
    get message() {
      return message
    },
  }) as GeolocationPositionError
}

/** Stub navigator.geolocation with a reader that either finds a fix or fails. */
function webPositionReader(outcome: {
  fix?: true
  error?: { code: number; message: string }
}) {
  const read = vi.fn(
    (
      success: PositionCallback,
      failure?: PositionErrorCallback | null,
      _options?: PositionOptions,
    ) => {
      if (outcome.error) {
        failure?.(positionError(outcome.error.code, outcome.error.message))
        return
      }
      success({
        coords: { latitude: 7, longitude: 8, accuracy: 9 },
      } as GeolocationPosition)
    },
  )
  stubNavigatorProp("geolocation", { getCurrentPosition: read })
  return read
}

/** Stub the Permissions API with a spy that answers one state. */
function permissionsAnswering(state: PermissionState) {
  const query = vi.fn(() => Promise.resolve({ state }))
  stubNavigatorProp("permissions", { query })
  return query
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
    //the plugin reports more than GeoCoords carries; only the three fields pass
    vi.mocked(Geolocation.getCurrentPosition).mockResolvedValueOnce({
      timestamp: 0,
      coords: {
        latitude: 1,
        longitude: 2,
        accuracy: 3,
        altitude: 40,
        altitudeAccuracy: null,
        heading: null,
        speed: 0,
      },
    })
    expect(await getCurrentPosition()).toEqual({
      latitude: 1,
      longitude: 2,
      accuracy: 3,
    })
  })

  it("hands highAccuracy and timeoutMs to the plugin, defaulting to low accuracy and 10 s", async () => {
    forceNative(true)
    await getCurrentPosition()
    expect(Geolocation.getCurrentPosition).toHaveBeenLastCalledWith({
      enableHighAccuracy: false,
      timeout: 10_000,
    })

    await getCurrentPosition({ highAccuracy: true, timeoutMs: 2_500 })
    expect(Geolocation.getCurrentPosition).toHaveBeenLastCalledWith({
      enableHighAccuracy: true,
      timeout: 2_500,
    })
  })

  it("requests permission via the native dialog", async () => {
    forceNative(true)
    expect(await requestGeoPermission()).toBe("granted")
    expect(Geolocation.requestPermissions).toHaveBeenCalled()
  })

  it("answers the dialog's outcome, normalised", async () => {
    forceNative(true)
    vi.mocked(Geolocation.requestPermissions).mockResolvedValueOnce({
      location: "denied",
      coarseLocation: "denied",
    })
    expect(await requestGeoPermission()).toBe("denied")

    vi.mocked(Geolocation.requestPermissions).mockResolvedValueOnce({
      location: "prompt-with-rationale",
      coarseLocation: "prompt-with-rationale",
    })
    expect(await requestGeoPermission()).toBe("prompt")
  })
})

describe("geolocation — device-level unavailability", () => {
  //@capacitor/geolocation documents that checkPermissions() THROWS when system
  //location services are switched off. That's a device state, not a permission
  //state — the accessor must surface it, never reject. This file is the exemplar
  //for every permission-gated capability, so the shape matters more than the fix.
  it("returns 'unavailable' when native checkPermissions throws", async () => {
    forceNative(true)
    vi.mocked(Geolocation.checkPermissions).mockRejectedValueOnce(
      new Error("Location services are not enabled"),
    )
    await expect(checkGeoPermission()).resolves.toBe("unavailable")
  })

  it("returns 'unavailable' when native requestPermissions throws", async () => {
    forceNative(true)
    vi.mocked(Geolocation.requestPermissions).mockRejectedValueOnce(
      new Error("Location services are not enabled"),
    )
    await expect(requestGeoPermission()).resolves.toBe("unavailable")
  })

  it("reports 'unavailable' on web when the geolocation API is absent", async () => {
    //no navigator.geolocation at all — asking cannot help, so it is not "prompt"
    forceNative(false)
    stubNavigatorProp("geolocation", undefined)
    stubNavigatorProp("permissions", undefined)
    await expect(checkGeoPermission()).resolves.toBe("unavailable")
  })

  it("still reports 'prompt' when only the Permissions API is missing", async () => {
    //older browsers can't QUERY geolocation permission but can still request it,
    //so the correct answer is "you may ask", not "unavailable"
    forceNative(false)
    stubNavigatorProp("geolocation", { getCurrentPosition: () => {} })
    stubNavigatorProp("permissions", undefined)
    await expect(checkGeoPermission()).resolves.toBe("prompt")
  })
})

describe("geolocation — web", () => {
  it("reads position from navigator.geolocation", async () => {
    forceNative(false)
    //a real GeolocationCoordinates carries altitude, heading and speed too;
    //GeoCoords is a projection, so only the three fields pass
    stubNavigatorProp("geolocation", {
      getCurrentPosition: (success: PositionCallback) =>
        success({
          coords: {
            latitude: 4,
            longitude: 5,
            accuracy: 6,
            altitude: 40,
            speed: 0,
          },
        } as unknown as GeolocationPosition),
    })
    expect(await getCurrentPosition()).toEqual({
      latitude: 4,
      longitude: 5,
      accuracy: 6,
    })
  })

  it("reads permission from the Permissions API", async () => {
    forceNative(false)
    //geolocation must be present too: no real browser ships the Permissions API
    //without it, and checkGeoPermission short-circuits to "unavailable" when the
    //underlying API is missing (asking cannot help).
    stubNavigatorProp("geolocation", { getCurrentPosition: () => {} })
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

  it("rejects with the browser's own position error", async () => {
    forceNative(false)
    const denied = { code: 1, message: "User denied Geolocation" }
    stubNavigatorProp("geolocation", {
      getCurrentPosition: (
        _success: PositionCallback,
        failure: PositionErrorCallback,
      ) => failure(denied as GeolocationPositionError),
    })
    await expect(getCurrentPosition()).rejects.toBe(denied)
  })

  it("hands highAccuracy and timeoutMs to the browser, defaulting to low accuracy and 10 s", async () => {
    forceNative(false)
    const read = webPositionReader({ fix: true })
    await getCurrentPosition()
    expect(read.mock.lastCall?.[2]).toEqual({
      enableHighAccuracy: false,
      timeout: 10_000,
    })

    await getCurrentPosition({ highAccuracy: true, timeoutMs: 2_500 })
    expect(read.mock.lastCall?.[2]).toEqual({
      enableHighAccuracy: true,
      timeout: 2_500,
    })
  })

  it("falls back to 'prompt' when the Permissions API rejects the query", async () => {
    //a browser rejects query() with a TypeError for a permission name it does
    //not recognise; the request path still works there, so "you may ask"
    forceNative(false)
    stubNavigatorProp("geolocation", { getCurrentPosition: () => {} })
    stubNavigatorProp("permissions", {
      query: () => Promise.reject(new TypeError("unsupported name")),
    })
    await expect(checkGeoPermission()).resolves.toBe("prompt")
  })
})

describe("geolocation — web permission request", () => {
  //the web has no request API: a position read raises the browser prompt, so
  //the read's outcome IS the answer, and a failure re-reads the state unless
  //it is a refusal on a browser that has no state to read

  it("grants when the position read succeeds, without re-reading the state", async () => {
    forceNative(false)
    const read = webPositionReader({ fix: true })
    //a stale "prompt" in the Permissions API must not override the success
    const query = permissionsAnswering("prompt")
    await expect(requestGeoPermission()).resolves.toBe("granted")
    expect(read).toHaveBeenCalledTimes(1)
    //the prompt is raised with the defaults: low accuracy, 10 s
    expect(read.mock.lastCall?.[2]).toEqual({
      enableHighAccuracy: false,
      timeout: 10_000,
    })
    expect(query).not.toHaveBeenCalled()
  })

  it("re-reads the settled state when the user denies the prompt", async () => {
    forceNative(false)
    webPositionReader({ error: { code: 1, message: "User denied" } })
    const query = permissionsAnswering("denied")
    await expect(requestGeoPermission()).resolves.toBe("denied")
    expect(query).toHaveBeenCalledTimes(1)
  })

  it("keeps 'prompt' when the prompt is dismissed without a choice", async () => {
    //a dismissed prompt fails the read with the same PERMISSION_DENIED code as a
    //refusal while the state stays "prompt", so where the state can be queried
    //the re-read wins over the code
    forceNative(false)
    webPositionReader({ error: { code: 1, message: "User denied" } })
    const query = permissionsAnswering("prompt")
    await expect(requestGeoPermission()).resolves.toBe("prompt")
    expect(query).toHaveBeenCalledTimes(1)
  })

  it("re-reads 'granted' when the read times out after the user allowed it", async () => {
    //a timeout is not a refusal: the permission stands, only the fix failed
    forceNative(false)
    webPositionReader({ error: { code: 3, message: "Timeout expired" } })
    const query = permissionsAnswering("granted")
    await expect(requestGeoPermission()).resolves.toBe("granted")
    expect(query).toHaveBeenCalledTimes(1)
  })

  it("answers 'denied' when the user refuses on a browser without the Permissions API", async () => {
    //Safari before 16 cannot query the state, so a re-read there always says
    //"prompt"; the refusal's own PERMISSION_DENIED code is the only answer, and
    //the message is free text, so it must not decide
    forceNative(false)
    webPositionReader({ error: { code: 1, message: "User refused" } })
    stubNavigatorProp("permissions", undefined)
    await expect(requestGeoPermission()).resolves.toBe("denied")
  })

  it.each([
    [2, "Position unavailable"],
    [3, "Timeout expired"],
  ])(
    "keeps 'prompt' when the read fails with code %i on a browser without the Permissions API",
    async (code, message) => {
      //no fix is not a refusal: without a state to query, "you may ask" stands
      forceNative(false)
      webPositionReader({ error: { code, message } })
      stubNavigatorProp("permissions", undefined)
      await expect(requestGeoPermission()).resolves.toBe("prompt")
    },
  )

  it("grants on a browser without the Permissions API when the read succeeds", async () => {
    forceNative(false)
    const read = webPositionReader({ fix: true })
    stubNavigatorProp("permissions", undefined)
    await expect(requestGeoPermission()).resolves.toBe("granted")
    expect(read).toHaveBeenCalledTimes(1)
  })

  it("reports 'unavailable' when the geolocation API is absent", async () => {
    forceNative(false)
    stubNavigatorProp("geolocation", undefined)
    const query = permissionsAnswering("granted")
    await expect(requestGeoPermission()).resolves.toBe("unavailable")
    expect(query).not.toHaveBeenCalled()
  })
})

describe("geolocation — server render", () => {
  //during SSR there is no navigator at all: every accessor answers
  //"unavailable" or rejects, and none of them throws a TypeError
  it("answers without a navigator", async () => {
    forceNative(false)
    vi.stubGlobal("navigator", undefined)
    await expect(checkGeoPermission()).resolves.toBe("unavailable")
    await expect(requestGeoPermission()).resolves.toBe("unavailable")
    await expect(getCurrentPosition()).rejects.toThrow(
      "Geolocation unavailable",
    )
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  getMotionStatus,
  requestMotionPermission,
  resetMotion,
  subscribeMotion,
  subscribeMotionStatus,
  toMotionSample,
} from "#adaptv/capabilities/motion"

type Fields = {
  acceleration?: {
    x: number | null
    y: number | null
    z: number | null
  } | null
  accelerationIncludingGravity?: {
    x: number | null
    y: number | null
    z: number | null
  } | null
  rotationRate?: {
    alpha: number | null
    beta: number | null
    gamma: number | null
  } | null
  interval?: number
}

/** jsdom has no DeviceMotionEvent; a plain Event with the fields is what the listener sees. */
function motionEvent(fields: Fields): Event {
  return Object.assign(new Event("devicemotion"), {
    acceleration: null,
    accelerationIncludingGravity: null,
    rotationRate: null,
    interval: 16,
    ...fields,
  })
}

function installApi(
  requestPermission?: () => Promise<"granted" | "denied">,
) {
  const ctor = function DeviceMotionEvent() {} as unknown as {
    requestPermission?: () => Promise<"granted" | "denied">
  }
  if (requestPermission) ctor.requestPermission = requestPermission
  vi.stubGlobal("DeviceMotionEvent", ctor)
}

beforeEach(() => resetMotion())
afterEach(() => {
  resetMotion()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("motion status", () => {
  it("is unsupported without the constructor, and subscribing is a no-op there", () => {
    vi.stubGlobal("DeviceMotionEvent", undefined)
    expect(getMotionStatus()).toBe("unsupported")
    const listener = vi.fn()
    const off = subscribeMotion(listener)
    window.dispatchEvent(
      motionEvent({
        accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 },
      }),
    )
    expect(listener).not.toHaveBeenCalled()
    off()
  })

  it("is granted from the start on an engine that never asks", async () => {
    installApi()
    expect(getMotionStatus()).toBe("granted")
    expect(await requestMotionPermission()).toBe("granted")
  })

  it("is prompt on a gating engine, then whatever the engine answered, asked once", async () => {
    const ask = vi.fn(async () => "granted" as const)
    installApi(ask)
    expect(getMotionStatus()).toBe("prompt")
    expect(await requestMotionPermission()).toBe("granted")
    expect(await requestMotionPermission()).toBe("granted")
    expect(ask).toHaveBeenCalledTimes(1)
    expect(getMotionStatus()).toBe("granted")
  })

  it("reports denied for a denial the engine resolved, and keeps it", async () => {
    const ask = vi.fn(async () => "denied" as const)
    installApi(ask)
    expect(await requestMotionPermission()).toBe("denied")
    expect(await requestMotionPermission()).toBe("denied")
    expect(ask).toHaveBeenCalledTimes(1)
    expect(getMotionStatus()).toBe("denied")
  })

  it("stays prompt when the request is thrown outside a gesture, so a later tap can still ask", async () => {
    const ask = vi
      .fn<() => Promise<"granted" | "denied">>()
      .mockRejectedValueOnce(new Error("NotAllowedError"))
      .mockResolvedValueOnce("granted")
    installApi(ask)
    expect(await requestMotionPermission()).toBe("prompt")
    expect(getMotionStatus()).toBe("prompt")
    expect(await requestMotionPermission()).toBe("granted")
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it("tells status subscribers when an answer arrives", async () => {
    installApi(async () => "granted")
    const cb = vi.fn()
    const off = subscribeMotionStatus(cb)
    await requestMotionPermission()
    expect(cb).toHaveBeenCalledTimes(1)
    off()
  })
})

describe("motion samples", () => {
  it("drops the all-null event a sensorless engine fires and keeps the numbers of a real one", () => {
    expect(
      toMotionSample(motionEvent({}) as unknown as DeviceMotionEvent),
    ).toBeNull()
    const sample = toMotionSample(
      motionEvent({
        acceleration: { x: 0.1, y: 0, z: 0 },
        accelerationIncludingGravity: { x: 1, y: 2, z: 9.81 },
        rotationRate: { alpha: 1, beta: 2, gamma: 3 },
        interval: 16,
      }) as unknown as DeviceMotionEvent,
    )
    expect(sample?.gravity).toEqual({ x: 1, y: 2, z: 9.81 })
    expect(sample?.rotation).toEqual({ alpha: 1, beta: 2, gamma: 3 })
    expect(sample?.interval).toBe(16)
  })

  it("delivers usable samples to a granted subscriber and stops on unsubscribe", () => {
    installApi()
    const listener = vi.fn()
    const off = subscribeMotion(listener)
    window.dispatchEvent(motionEvent({}))
    expect(listener).not.toHaveBeenCalled()
    window.dispatchEvent(
      motionEvent({
        accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 },
      }),
    )
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0]?.[0].gravity).toEqual({
      x: 0,
      y: 0,
      z: 9.8,
    })
    off()
    window.dispatchEvent(
      motionEvent({
        accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 },
      }),
    )
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("throttles to one sample per window", () => {
    vi.useFakeTimers()
    installApi()
    const listener = vi.fn()
    const off = subscribeMotion(listener, { throttleMs: 100 })
    const fire = () =>
      window.dispatchEvent(
        motionEvent({
          accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 },
        }),
      )
    fire()
    vi.advanceTimersByTime(30)
    fire()
    vi.advanceTimersByTime(30)
    fire()
    expect(listener).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(50)
    fire()
    expect(listener).toHaveBeenCalledTimes(2)
    off()
  })

  it("never subscribes while the engine still has to ask", () => {
    installApi(async () => "granted")
    const listener = vi.fn()
    const off = subscribeMotion(listener)
    window.dispatchEvent(
      motionEvent({
        accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 },
      }),
    )
    expect(listener).not.toHaveBeenCalled()
    off()
  })
})

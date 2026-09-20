import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { resetMotion } from "#adaptv/capabilities/motion"
import { useMotion } from "#adaptv/hooks/use-motion"

function motionEvent(z: number | null): Event {
  return Object.assign(new Event("devicemotion"), {
    acceleration: null,
    accelerationIncludingGravity: z === null ? null : { x: 0, y: 0, z },
    rotationRate: null,
    interval: 16,
  })
}

afterEach(() => {
  resetMotion()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("useMotion", () => {
  it("is unsupported where there is no constructor", () => {
    vi.stubGlobal("DeviceMotionEvent", undefined)
    const { result } = renderHook(() => useMotion())
    expect(result.current.status).toBe("unsupported")
    expect(result.current.silent).toBe(false)
  })

  it("goes silent after the window with only the sensorless null event, and wakes on a real sample", () => {
    vi.useFakeTimers()
    vi.stubGlobal("DeviceMotionEvent", function DeviceMotionEvent() {})
    const { result } = renderHook(() =>
      useMotion({ throttleMs: 0, silentAfterMs: 500 }),
    )
    expect(result.current.status).toBe("granted")
    act(() => {
      window.dispatchEvent(motionEvent(null))
      vi.advanceTimersByTime(600)
    })
    expect(result.current.silent).toBe(true)
    expect(result.current.sample).toBeNull()
    act(() => {
      window.dispatchEvent(motionEvent(9.8))
    })
    expect(result.current.silent).toBe(false)
    expect(result.current.sample?.gravity?.z).toBe(9.8)
  })

  it("asks through request and subscribes once granted", async () => {
    vi.useFakeTimers()
    const ctor = function DeviceMotionEvent() {} as unknown as {
      requestPermission: () => Promise<"granted">
    }
    ctor.requestPermission = async () => "granted"
    vi.stubGlobal("DeviceMotionEvent", ctor)
    const { result } = renderHook(() => useMotion({ throttleMs: 0 }))
    expect(result.current.status).toBe("prompt")
    await act(async () => {
      await result.current.request()
    })
    expect(result.current.status).toBe("granted")
    act(() => {
      window.dispatchEvent(motionEvent(9.7))
    })
    expect(result.current.sample?.gravity?.z).toBe(9.7)
  })

  it("renders the real status on the first client render, not unsupported", () => {
    vi.stubGlobal("DeviceMotionEvent", function DeviceMotionEvent() {})
    const seen: string[] = []
    renderHook(() => {
      const result = useMotion()
      seen.push(result.status)
      return result
    })
    expect(seen[0]).toBe("granted")
  })

  it("shares one status: a grant asked through one hook reaches every other", async () => {
    vi.useFakeTimers()
    const ctor = function DeviceMotionEvent() {} as unknown as {
      requestPermission: () => Promise<"granted">
    }
    ctor.requestPermission = async () => "granted"
    vi.stubGlobal("DeviceMotionEvent", ctor)
    const asker = renderHook(() => useMotion({ throttleMs: 0 }))
    const other = renderHook(() => useMotion({ throttleMs: 0 }))
    expect(other.result.current.status).toBe("prompt")
    await act(async () => {
      await asker.result.current.request()
    })
    expect(other.result.current.status).toBe("granted")
    act(() => {
      window.dispatchEvent(motionEvent(9.6))
    })
    expect(other.result.current.sample?.gravity?.z).toBe(9.6)
  })

  it("goes silent again when samples stop after they had been arriving", () => {
    vi.useFakeTimers()
    vi.stubGlobal("DeviceMotionEvent", function DeviceMotionEvent() {})
    const { result } = renderHook(() =>
      useMotion({ throttleMs: 100, silentAfterMs: 500 }),
    )
    act(() => {
      window.dispatchEvent(motionEvent(9.8))
      vi.advanceTimersByTime(550)
    })
    expect(result.current.silent).toBe(false)
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current.silent).toBe(true)
  })

  it("keeps the listener off while disabled", () => {
    vi.useFakeTimers()
    vi.stubGlobal("DeviceMotionEvent", function DeviceMotionEvent() {})
    const { result } = renderHook(() => useMotion({ enabled: false }))
    act(() => {
      window.dispatchEvent(motionEvent(9.8))
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.sample).toBeNull()
    expect(result.current.silent).toBe(false)
  })
})

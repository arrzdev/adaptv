import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { resetBattery } from "#adaptv/capabilities/battery"
import { useBattery } from "#adaptv/hooks/use-battery"

vi.mock("@capacitor/device", () => ({
  Device: {
    getBatteryInfo: vi.fn(async () => ({
      batteryLevel: 1,
      isCharging: true,
    })),
  },
}))

class FakeManager extends EventTarget {
  level = 0.8
  charging = false
}

afterEach(() => {
  resetBattery()
  Object.defineProperty(navigator, "getBattery", {
    configurable: true,
    value: undefined,
  })
  vi.unstubAllGlobals()
})

describe("useBattery", () => {
  it("renders unsupported where there is no API", () => {
    vi.stubGlobal("Capacitor", undefined)
    expect(renderHook(() => useBattery()).result.current.status).toBe(
      "unsupported",
    )
  })

  it("starts unknown, then re-renders with the manager's numbers and again on levelchange", async () => {
    vi.stubGlobal("Capacitor", undefined)
    const manager = new FakeManager()
    Object.defineProperty(navigator, "getBattery", {
      configurable: true,
      value: () => Promise.resolve(manager),
    })
    const { result } = renderHook(() => useBattery())
    expect(result.current.status).toBe("unknown")
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(result.current).toEqual({
      status: "ok",
      level: 0.8,
      charging: false,
    })
    act(() => {
      manager.level = 0.79
      manager.dispatchEvent(new Event("levelchange"))
    })
    expect(result.current.level).toBe(0.79)
  })
})

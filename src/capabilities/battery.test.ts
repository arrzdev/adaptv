import { Device } from "@capacitor/device"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  BATTERY_POLL_MS,
  getBatteryState,
  readBattery,
  resetBattery,
  subscribeBattery,
} from "#adaptv/capabilities/battery"

vi.mock("@capacitor/device", () => ({
  Device: {
    getBatteryInfo: vi.fn(async () => ({
      batteryLevel: 0.5,
      isCharging: false,
    })),
  },
}))

const resumeListeners = new Set<() => void>()
vi.mock("#adaptv/capabilities/app-state", () => ({
  onResume: (cb: () => void) => {
    resumeListeners.add(cb)
    return () => resumeListeners.delete(cb)
  },
}))

class FakeManager extends EventTarget {
  level = 0.42
  charging = true
  set(level: number, charging: boolean) {
    const levelMoved = level !== this.level
    const chargingMoved = charging !== this.charging
    this.level = level
    this.charging = charging
    if (levelMoved) this.dispatchEvent(new Event("levelchange"))
    if (chargingMoved) this.dispatchEvent(new Event("chargingchange"))
  }
}

function forceNative(native: boolean): void {
  vi.stubGlobal(
    "Capacitor",
    native ? { isNativePlatform: () => true } : undefined,
  )
}

function installGetBattery(manager: FakeManager | null): void {
  Object.defineProperty(navigator, "getBattery", {
    configurable: true,
    value: manager ? () => Promise.resolve(manager) : undefined,
  })
}

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  resetBattery()
  resumeListeners.clear()
})

afterEach(() => {
  resetBattery()
  installGetBattery(null)
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe("battery on the web", () => {
  it("is unsupported where navigator.getBattery does not exist, before and after a read", async () => {
    forceNative(false)
    installGetBattery(null)
    expect(getBatteryState()).toEqual({
      status: "unsupported",
      level: null,
      charging: null,
    })
    expect((await readBattery()).status).toBe("unsupported")
  })

  it("is unknown until the manager answers, then carries its numbers", async () => {
    forceNative(false)
    installGetBattery(new FakeManager())
    expect(getBatteryState().status).toBe("unknown")
    expect(await readBattery()).toEqual({
      status: "ok",
      level: 0.42,
      charging: true,
    })
  })

  it("follows levelchange and chargingchange, one notification per change, and keeps the snapshot otherwise", async () => {
    forceNative(false)
    const manager = new FakeManager()
    installGetBattery(manager)
    const cb = vi.fn()
    subscribeBattery(cb)
    await flush()
    const first = getBatteryState()
    expect(first.level).toBe(0.42)
    const calls = cb.mock.calls.length
    manager.set(0.41, true)
    expect(cb.mock.calls.length).toBe(calls + 1)
    expect(getBatteryState()).toEqual({
      status: "ok",
      level: 0.41,
      charging: true,
    })
    manager.set(0.41, false)
    expect(getBatteryState().charging).toBe(false)
    const settled = getBatteryState()
    manager.dispatchEvent(new Event("levelchange"))
    expect(getBatteryState()).toBe(settled)
    expect(cb.mock.calls.length).toBe(calls + 2)
  })

  it("reports unsupported when getBattery rejects", async () => {
    forceNative(false)
    Object.defineProperty(navigator, "getBattery", {
      configurable: true,
      value: () => Promise.reject(new Error("NotAllowedError")),
    })
    expect((await readBattery()).status).toBe("unsupported")
  })
})

describe("battery on native", () => {
  it("reads the plugin on subscribe and again on resume and on the timer, and stops with the last subscriber", async () => {
    vi.useFakeTimers()
    forceNative(true)
    const info = vi.mocked(Device.getBatteryInfo)
    const off = subscribeBattery(() => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(info).toHaveBeenCalledTimes(1)
    expect(getBatteryState()).toEqual({
      status: "ok",
      level: 0.5,
      charging: false,
    })
    info.mockResolvedValueOnce({ batteryLevel: 0.49, isCharging: true })
    for (const cb of resumeListeners) cb()
    await vi.advanceTimersByTimeAsync(0)
    expect(info).toHaveBeenCalledTimes(2)
    expect(getBatteryState()).toEqual({
      status: "ok",
      level: 0.49,
      charging: true,
    })
    await vi.advanceTimersByTimeAsync(BATTERY_POLL_MS)
    expect(info).toHaveBeenCalledTimes(3)
    off()
    expect(resumeListeners.size).toBe(0)
    await vi.advanceTimersByTimeAsync(BATTERY_POLL_MS * 2)
    expect(info).toHaveBeenCalledTimes(3)
  })

  it("turns the simulator's -1 into unknown rather than a number", async () => {
    forceNative(true)
    vi.mocked(Device.getBatteryInfo).mockResolvedValueOnce({
      batteryLevel: -1,
      isCharging: false,
    })
    expect(await readBattery()).toEqual({
      status: "unknown",
      level: null,
      charging: false,
    })
  })

  it("is unknown, not unsupported, before the first read answers", () => {
    forceNative(true)
    expect(getBatteryState().status).toBe("unknown")
  })

  it("survives a plugin rejection as unknown", async () => {
    forceNative(true)
    vi.mocked(Device.getBatteryInfo).mockRejectedValueOnce(
      new Error("no bridge"),
    )
    expect((await readBattery()).status).toBe("unknown")
  })
})

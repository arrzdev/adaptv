import { Network } from "@capacitor/network"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getOnline, subscribeOnline } from "#nativ/capabilities/network"

vi.mock("@capacitor/network", () => ({
  Network: {
    getStatus: vi.fn(() => Promise.resolve({ connected: true })),
    addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })),
  },
}))

const restores: Array<() => void> = []

function setNavigatorOnline(value: boolean): void {
  const prev = Object.getOwnPropertyDescriptor(navigator, "onLine")
  Object.defineProperty(navigator, "onLine", { value, configurable: true })
  restores.push(() => {
    if (prev) Object.defineProperty(navigator, "onLine", prev)
  })
}

function forceNative(native: boolean): void {
  vi.stubGlobal(
    "Capacitor",
    native ? { isNativePlatform: () => true } : undefined,
  )
}

afterEach(() => {
  for (const r of restores.splice(0)) r()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("getOnline — web", () => {
  it("reflects navigator.onLine", () => {
    forceNative(false)
    setNavigatorOnline(true)
    expect(getOnline()).toBe(true)
    setNavigatorOnline(false)
    expect(getOnline()).toBe(false)
  })
})

describe("subscribeOnline — web", () => {
  it("fires on online/offline events and stops after unsubscribe", () => {
    forceNative(false)
    const cb = vi.fn()
    const unsub = subscribeOnline(cb)

    window.dispatchEvent(new Event("offline"))
    window.dispatchEvent(new Event("online"))
    expect(cb).toHaveBeenCalledTimes(2)

    unsub()
    window.dispatchEvent(new Event("offline"))
    expect(cb).toHaveBeenCalledTimes(2) // no further calls after unsubscribe
  })

  it("supports multiple independent subscribers", () => {
    forceNative(false)
    const a = vi.fn()
    const b = vi.fn()
    const unsubA = subscribeOnline(a)
    const unsubB = subscribeOnline(b)

    window.dispatchEvent(new Event("offline"))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)

    unsubA()
    window.dispatchEvent(new Event("online"))
    expect(a).toHaveBeenCalledTimes(1) // A detached
    expect(b).toHaveBeenCalledTimes(2) // B still attached
    unsubB()
  })
})

describe("subscribeOnline — native", () => {
  it("wires the Capacitor Network listener", () => {
    forceNative(true)
    const unsub = subscribeOnline(vi.fn())
    expect(Network.addListener).toHaveBeenCalledWith(
      "networkStatusChange",
      expect.any(Function),
    )
    unsub()
  })
})

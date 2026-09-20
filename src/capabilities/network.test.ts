import { Network } from "@capacitor/network"
import { afterEach, describe, expect, it, vi } from "vitest"
import { getOnline, subscribeOnline } from "#adaptv/capabilities/network"

vi.mock("@capacitor/network", () => ({
  Network: {
    getStatus: vi.fn(() => Promise.resolve({ connected: true })),
    addListener: vi.fn(() =>
      Promise.resolve({ remove: vi.fn(() => Promise.resolve()) }),
    ),
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

// A native shell whose binary lists exactly these plugins, the way the native layer
// injects `Capacitor.PluginHeaders` before any app JS runs.
function forceNativeBinary(plugins: string[]): void {
  vi.stubGlobal("Capacitor", {
    isNativePlatform: () => true,
    PluginHeaders: plugins.map((name) => ({ name })),
  })
}

// A binary built before the plugin (an OTA bundle on an older store release) rejects
// `Network.getStatus`, so the native cache never leaves its optimistic default: a
// device in airplane mode reads online for the whole launch. WKWebView's own signal
// still moves there; an Android WebView's needs ACCESS_NETWORK_STATE, which that
// binary lacks, so on Android this is the same answer by another route.
describe("getOnline / subscribeOnline — native binary without the plugin", () => {
  it("reads navigator.onLine", () => {
    forceNativeBinary(["Haptics", "Device"])
    setNavigatorOnline(false)
    expect(getOnline()).toBe(false)
    setNavigatorOnline(true)
    expect(getOnline()).toBe(true)
  })

  it("follows the WebView's online/offline events and asks the bridge nothing", () => {
    forceNativeBinary(["Haptics", "Device"])
    const cb = vi.fn()
    const unsub = subscribeOnline(cb)
    try {
      window.dispatchEvent(new Event("offline"))
      expect(cb).toHaveBeenCalledTimes(1)
      expect(Network.getStatus).not.toHaveBeenCalled()
      expect(Network.addListener).not.toHaveBeenCalled()
    } finally {
      //a failed assertion must not leave a binding behind for the next test
      unsub()
    }
  })
})

describe("getOnline — native binary with the plugin", () => {
  it("does not read navigator.onLine", () => {
    forceNativeBinary(["Network"])
    setNavigatorOnline(false)
    expect(getOnline()).toBe(true)
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

/**
 * A fresh accessor over a stand-in `@capacitor/network`. The native binding is a
 * process singleton, so each test gets its own module; the stand-in is built of
 * plain functions, not `vi.fn`, because a spy attaches its own handler to every
 * promise it returns and so hides exactly the rejection these tests look for.
 */
async function nativeNetwork(network: Record<string, unknown>) {
  vi.resetModules()
  vi.doMock("@capacitor/network", () => ({ Network: network }))
  restores.push(() => {
    vi.doUnmock("@capacitor/network")
    vi.resetModules()
  })
  forceNative(true)
  return import("#adaptv/capabilities/network")
}

/** Every rejection nobody handled while `run` executed, read after the turn ends. */
async function unhandledDuring(run: () => void): Promise<unknown[]> {
  const seen: unknown[] = []
  const listener = (reason: unknown) => seen.push(reason)
  process.on("unhandledRejection", listener)
  try {
    run()
    //Node decides a rejection went unhandled only once the microtask queue has
    //drained, so leave the turn (twice: a rejection can be chained) before reading
    await new Promise((resolve) => setTimeout(resolve, 0))
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    process.off("unhandledRejection", listener)
  }
  return seen
}

const rejectWith = (message: string) => () =>
  Promise.reject(new Error(message))

describe("subscribeOnline — native, over a bridge that fails", () => {
  it("lets no rejected getStatus or addListener escape, and keeps the default", async () => {
    //a binary without the plugin, or an OS error: the bridge answers with a
    //rejection, which a fire-and-forget call hands to the window's error handlers
    const { getOnline, subscribeOnline } = await nativeNetwork({
      getStatus: rejectWith(
        "Network plugin is not implemented on android",
      ),
      addListener: rejectWith(
        "Network plugin is not implemented on android",
      ),
    })
    let unsub = () => {}
    const unhandled = await unhandledDuring(() => {
      unsub = subscribeOnline(() => {})
    })
    expect(unhandled).toEqual([])
    expect(getOnline()).toBe(true)
    unsub()
  })

  it("lets no rejected handle removal escape", async () => {
    const { subscribeOnline } = await nativeNetwork({
      getStatus: () => Promise.resolve({ connected: true }),
      addListener: () =>
        Promise.resolve({ remove: rejectWith("bridge: remove failed") }),
    })
    const unsub = subscribeOnline(() => {})
    await new Promise((resolve) => setTimeout(resolve, 0))
    const unhandled = await unhandledDuring(unsub)
    expect(unhandled).toEqual([])
  })

  it("removes a listener whose handle arrives after the last unsubscribe", async () => {
    //the bridge answers asynchronously, so a subscriber can leave first —
    //useSyncExternalStore under StrictMode always does in dev. The handle that
    //arrives afterwards belongs to nobody and must remove itself.
    let resolveHandle: (handle: { remove: () => Promise<void> }) => void =
      () => {}
    const { subscribeOnline } = await nativeNetwork({
      getStatus: () => Promise.resolve({ connected: true }),
      addListener: () =>
        new Promise((resolve) => {
          resolveHandle = resolve
        }),
    })
    const unsub = subscribeOnline(() => {})
    unsub()

    const remove = vi.fn(() => Promise.resolve())
    resolveHandle({ remove })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it("binds again for the next subscriber after a late handle removed itself", async () => {
    const handles: Array<(h: { remove: () => Promise<void> }) => void> = []
    let calls = 0
    const { subscribeOnline } = await nativeNetwork({
      getStatus: () => Promise.resolve({ connected: true }),
      addListener: () => {
        calls += 1
        return new Promise((resolve) => handles.push(resolve))
      },
    })
    subscribeOnline(() => {})()
    const unsub = subscribeOnline(() => {})
    expect(calls).toBe(2)

    const stale = vi.fn(() => Promise.resolve())
    const live = vi.fn(() => Promise.resolve())
    handles[0]?.({ remove: stale })
    handles[1]?.({ remove: live })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(stale).toHaveBeenCalledTimes(1)
    expect(live).not.toHaveBeenCalled()

    unsub()
    expect(live).toHaveBeenCalledTimes(1)
  })
})

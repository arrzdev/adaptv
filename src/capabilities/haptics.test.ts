import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { haptics } from "#adaptv/capabilities/haptics"
import { installVibratePolyfill } from "#adaptv/utils/install-vibrate-polyfill"

// Capacitor's Haptics is a registerPlugin proxy (no own methods to spyOn), so mock
// the module with fakes and mirror the real string-enum values.
vi.mock("@capacitor/haptics", () => ({
  Haptics: {
    impact: vi.fn(() => Promise.resolve()),
    notification: vi.fn(() => Promise.resolve()),
    selectionChanged: vi.fn(() => Promise.resolve()),
  },
  ImpactStyle: { Light: "LIGHT", Medium: "MEDIUM", Heavy: "HEAVY" },
  NotificationType: {
    Success: "SUCCESS",
    Warning: "WARNING",
    Error: "ERROR",
  },
}))

// Isolate haptics from the polyfill (its own unit): it wraps navigator.vibrate with
// a cancel-then-vibrate wrapper + has a persistent `installed` flag. Here we only
// assert haptics WIRES it; the wrapper behaviour is covered by the polyfill's tests.
vi.mock("#adaptv/utils/install-vibrate-polyfill", () => ({
  installVibratePolyfill: vi.fn(),
}))

const restores: Array<() => void> = []
let clock = 1_000_000 // monotonic across tests so the 200ms web cooldown never blocks

function forceNative(native: boolean): void {
  vi.stubGlobal(
    "Capacitor",
    native ? { isNativePlatform: () => true } : undefined,
  )
}

/** A native shell whose binary carries exactly `plugins` and nothing else. */
function forceNativeBinary(plugins: string[]): void {
  vi.stubGlobal("Capacitor", {
    isNativePlatform: () => true,
    PluginHeaders: plugins.map((name) => ({ name })),
  })
}

function withVibrate(): ReturnType<typeof vi.fn> {
  const spy = vi.fn(() => true)
  const prev = Object.getOwnPropertyDescriptor(navigator, "vibrate")
  Object.defineProperty(navigator, "vibrate", {
    value: spy,
    configurable: true,
    writable: true,
  })
  restores.push(() => {
    if (prev) Object.defineProperty(navigator, "vibrate", prev)
    else delete (navigator as { vibrate?: unknown }).vibrate
  })
  return spy
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockImplementation(() => {
    clock += 1000
    return clock
  })
})

afterEach(() => {
  for (const r of restores.splice(0)) r()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("haptics — native branch", () => {
  it("impact maps weight → Capacitor ImpactStyle", () => {
    forceNative(true)
    const vibrate = withVibrate()
    haptics.impact("heavy")
    expect(Haptics.impact).toHaveBeenCalledWith({
      style: ImpactStyle.Heavy,
    })
    expect(vibrate).not.toHaveBeenCalled()
  })

  it("notify maps type → Capacitor NotificationType", () => {
    forceNative(true)
    haptics.notify("error")
    expect(Haptics.notification).toHaveBeenCalledWith({
      type: NotificationType.Error,
    })
  })

  it("selection calls selectionChanged", () => {
    forceNative(true)
    haptics.selection()
    expect(Haptics.selectionChanged).toHaveBeenCalledOnce()
  })
})

describe("haptics — web branch", () => {
  it("impact pulses navigator.vibrate, not the native plugin", () => {
    forceNative(false)
    const vibrate = withVibrate()
    haptics.impact("light")
    expect(vibrate).toHaveBeenCalledOnce()
    expect(Haptics.impact).not.toHaveBeenCalled()
    // haptics wires the iOS polyfill so it works standalone
    expect(installVibratePolyfill).toHaveBeenCalled()
  })

  it("notify/selection pulse on web", () => {
    forceNative(false)
    const vibrate = withVibrate()
    haptics.notify("success")
    haptics.selection()
    expect(vibrate).toHaveBeenCalledTimes(2)
  })

  it("no-ops without navigator.vibrate (never throws)", () => {
    forceNative(false)
    const prev = Object.getOwnPropertyDescriptor(navigator, "vibrate")
    delete (navigator as { vibrate?: unknown }).vibrate
    restores.push(() => {
      if (prev) Object.defineProperty(navigator, "vibrate", prev)
    })
    expect(() => haptics.impact("medium")).not.toThrow()
  })
})

describe("haptics.isSupported", () => {
  it("is true on native", () => {
    forceNative(true)
    expect(haptics.isSupported()).toBe(true)
  })

  it("tracks navigator.vibrate on web", () => {
    forceNative(false)
    withVibrate()
    expect(haptics.isSupported()).toBe(true)
  })
})

describe("haptics — a binary that predates the plugin", () => {
  it("pulses through navigator.vibrate instead of the absent bridge", () => {
    //→ docs/design/ota.md §5.6. Android's WebView has a real `navigator.vibrate`, so a
    //skewed bundle still buzzes — it just buzzes the web approximation.
    forceNativeBinary([])
    const vibrate = withVibrate()
    haptics.impact("medium")
    expect(Haptics.impact).not.toHaveBeenCalled()
    expect(vibrate).toHaveBeenCalled()
  })

  it("is unsupported when the WebView has no vibrate either", () => {
    forceNativeBinary(["Share"])
    const prev = Object.getOwnPropertyDescriptor(navigator, "vibrate")
    delete (navigator as { vibrate?: unknown }).vibrate
    restores.push(() => {
      if (prev) Object.defineProperty(navigator, "vibrate", prev)
    })
    expect(haptics.isSupported()).toBe(false)
  })
})

describe("haptics — native, over a bridge that rejects", () => {
  //Every pulse is fire-and-forget, so a rejection (an OS error, a call the
  //platform does not implement) has no handler but the window's. A try around the
  //call only sees a synchronous throw, which the bridge never produces. The
  //stand-ins are plain functions, not `vi.fn`: a spy handles every promise it
  //returns, which hides exactly the rejection looked for here.
  const original = {
    impact: Haptics.impact,
    notification: Haptics.notification,
    selectionChanged: Haptics.selectionChanged,
  }
  afterEach(() => {
    Object.assign(Haptics, original)
  })

  it.each([
    ["impact", () => haptics.impact("medium")],
    ["notification", () => haptics.notify("warning")],
    ["selectionChanged", () => haptics.selection()],
  ] as const)("lets no rejected %s escape", async (method, fire) => {
    forceNative(true)
    Object.assign(Haptics, {
      [method]: () =>
        Promise.reject(
          new Error(`Haptics.${method}() is not implemented`),
        ),
    })
    const seen: unknown[] = []
    const listener = (reason: unknown) => seen.push(reason)
    process.on("unhandledRejection", listener)
    try {
      expect(fire).not.toThrow()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      process.off("unhandledRejection", listener)
    }
    expect(seen).toEqual([])
  })
})

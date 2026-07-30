import { ScreenOrientation } from "@capacitor/screen-orientation"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getScreenOrientation,
  isOrientationLockSupported,
  lockScreenOrientation,
  subscribeScreenOrientation,
  unlockScreenOrientation,
} from "#adaptv/capabilities/orientation"

vi.mock("@capacitor/screen-orientation", () => ({
  ScreenOrientation: {
    orientation: vi.fn(() =>
      Promise.resolve({ type: "landscape-primary" }),
    ),
    lock: vi.fn(() => Promise.resolve()),
    unlock: vi.fn(() => Promise.resolve()),
    addListener: vi.fn(() =>
      Promise.resolve({ remove: vi.fn(() => Promise.resolve()) }),
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

type ScreenOrientationStub = {
  type?: string
  lock?: (orientation: string) => Promise<void>
  unlock?: () => void
  addEventListener?: (type: string, listener: () => void) => void
}

function stubScreenOrientation(value: ScreenOrientationStub | undefined) {
  const prev = Object.getOwnPropertyDescriptor(
    window.screen,
    "orientation",
  )
  Object.defineProperty(window.screen, "orientation", {
    value,
    configurable: true,
  })
  restores.push(() => {
    if (prev) Object.defineProperty(window.screen, "orientation", prev)
    else
      delete (window.screen as unknown as Record<string, unknown>)
        .orientation
  })
}

afterEach(() => {
  for (const r of restores.splice(0)) r()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("orientation — reading works everywhere", () => {
  it("reads screen.orientation.type on web", () => {
    forceNative(false)
    stubScreenOrientation({ type: "landscape-secondary" })
    expect(getScreenOrientation()).toBe("landscape-secondary")
  })

  it("falls back to a media query on pre-16.4 WebKit", () => {
    //no screen.orientation at all — the axis is still knowable, just not the
    //primary/secondary half, so we report the primary of the right axis
    forceNative(false)
    stubScreenOrientation(undefined)
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: false,
    } as MediaQueryList)
    expect(getScreenOrientation()).toBe("landscape-primary")
  })

  it("normalises an orientation type it does not recognise", () => {
    forceNative(false)
    stubScreenOrientation({ type: "square-ish" })
    expect(getScreenOrientation()).toBe("portrait-primary")
  })
})

describe("orientation — the lock probe is the whole point", () => {
  it("reports unsupported on a browser with no lock() — every iOS build", () => {
    forceNative(false)
    stubScreenOrientation({ type: "portrait-primary" })
    expect(isOrientationLockSupported()).toBe(false)
  })

  it("returns 'unsupported' from lock/unlock rather than throwing", async () => {
    forceNative(false)
    stubScreenOrientation({ type: "portrait-primary" })
    await expect(lockScreenOrientation("landscape")).resolves.toBe(
      "unsupported",
    )
    await expect(unlockScreenOrientation()).resolves.toBe("unsupported")
  })

  it("distinguishes a refused lock from an absent one", async () => {
    //Chromium HAS lock() but rejects with SecurityError outside fullscreen —
    //"rejected" tells the caller a retry from the right context can work,
    //which "unsupported" would have hidden
    forceNative(false)
    stubScreenOrientation({
      type: "portrait-primary",
      lock: () => Promise.reject(new Error("SecurityError")),
    })
    expect(isOrientationLockSupported()).toBe(true)
    await expect(lockScreenOrientation("landscape")).resolves.toBe(
      "rejected",
    )
  })

  it("locks through the web API when it is allowed", async () => {
    forceNative(false)
    const lock = vi.fn(() => Promise.resolve())
    stubScreenOrientation({ type: "portrait-primary", lock })
    await expect(lockScreenOrientation("landscape")).resolves.toBe("ok")
    expect(lock).toHaveBeenCalledWith("landscape")
  })
})

describe("orientation — native", () => {
  it("locks and unlocks through the plugin", async () => {
    forceNative(true)
    await expect(lockScreenOrientation("portrait")).resolves.toBe("ok")
    expect(ScreenOrientation.lock).toHaveBeenCalledWith({
      orientation: "portrait",
    })
    await expect(unlockScreenOrientation()).resolves.toBe("ok")
  })

  it("returns 'rejected' when the plugin throws", async () => {
    forceNative(true)
    vi.mocked(ScreenOrientation.lock).mockRejectedValueOnce(
      new Error("not implemented"),
    )
    await expect(lockScreenOrientation("portrait")).resolves.toBe(
      "rejected",
    )
  })

  it("seeds the snapshot from the plugin on first subscribe", async () => {
    forceNative(true)
    const unsub = subscribeScreenOrientation(vi.fn())
    await vi.waitFor(() =>
      expect(getScreenOrientation()).toBe("landscape-primary"),
    )
    expect(ScreenOrientation.addListener).toHaveBeenCalledWith(
      "screenOrientationChange",
      expect.any(Function),
    )
    unsub()
  })
})

describe("orientation — subscription", () => {
  it("fires on orientationchange and stops after unsubscribe", () => {
    forceNative(false)
    stubScreenOrientation({ type: "portrait-primary" })
    const cb = vi.fn()
    const unsub = subscribeScreenOrientation(cb)

    window.dispatchEvent(new Event("orientationchange"))
    expect(cb).toHaveBeenCalledTimes(1)

    unsub()
    window.dispatchEvent(new Event("orientationchange"))
    expect(cb).toHaveBeenCalledTimes(1)
  })
})

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

/** A native shell whose binary carries exactly `plugins` and nothing else. */
function forceNativeBinary(plugins: string[]): void {
  vi.stubGlobal("Capacitor", {
    isNativePlatform: () => true,
    PluginHeaders: plugins.map((name) => ({ name })),
  })
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

describe("orientation — a binary that predates the plugin", () => {
  it("locks through the web API instead of the absent bridge", async () => {
    //→ docs/design/ota.md §5.6. The lock is the only branch that moves: reading the
    //current orientation resolves the same way with or without the plugin.
    forceNativeBinary([])
    const lock = vi.fn(() => Promise.resolve())
    stubScreenOrientation({ type: "portrait-primary", lock })
    expect(isOrientationLockSupported()).toBe(true)
    await expect(lockScreenOrientation("portrait")).resolves.toBe("ok")
    expect(ScreenOrientation.lock).not.toHaveBeenCalled()
    expect(lock).toHaveBeenCalledWith("portrait")
  })

  it("reports unsupported when the WebView cannot lock either", () => {
    forceNativeBinary(["Share"])
    stubScreenOrientation({ type: "portrait-primary" })
    expect(isOrientationLockSupported()).toBe(false)
  })
})

/**
 * A fresh accessor over a stand-in `@capacitor/screen-orientation`. The native
 * binding is a process singleton, so each test gets its own module; the stand-in
 * is built of plain functions, not `vi.fn`, because a spy attaches its own handler
 * to every promise it returns and so hides exactly the rejection looked for here.
 */
async function nativeOrientation(plugin: Record<string, unknown>) {
  vi.resetModules()
  vi.doMock("@capacitor/screen-orientation", () => ({
    ScreenOrientation: plugin,
  }))
  restores.push(() => {
    vi.doUnmock("@capacitor/screen-orientation")
    vi.resetModules()
  })
  forceNative(true)
  return import("#adaptv/capabilities/orientation")
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

type Handle = { remove: () => Promise<void> }

describe("orientation — native subscription over a bridge that fails", () => {
  it("lets no rejected orientation read or addListener escape, and keeps the default", async () => {
    const { getScreenOrientation, subscribeScreenOrientation } =
      await nativeOrientation({
        orientation: rejectWith("ScreenOrientation is not implemented"),
        addListener: rejectWith("ScreenOrientation is not implemented"),
      })
    let unsub = () => {}
    const unhandled = await unhandledDuring(() => {
      unsub = subscribeScreenOrientation(() => {})
    })
    expect(unhandled).toEqual([])
    expect(getScreenOrientation()).toBe("portrait-primary")
    unsub()
  })

  it("lets no rejected handle removal escape", async () => {
    const { subscribeScreenOrientation } = await nativeOrientation({
      orientation: () => Promise.resolve({ type: "portrait-primary" }),
      addListener: () =>
        Promise.resolve({ remove: rejectWith("bridge: remove failed") }),
    })
    const unsub = subscribeScreenOrientation(() => {})
    await new Promise((resolve) => setTimeout(resolve, 0))
    const unhandled = await unhandledDuring(unsub)
    expect(unhandled).toEqual([])
  })

  it("removes a listener whose handle arrives after the last unsubscribe", async () => {
    //the bridge answers asynchronously, so a subscriber can leave first —
    //useSyncExternalStore under StrictMode always does in dev
    let resolveHandle: (handle: Handle) => void = () => {}
    const { subscribeScreenOrientation } = await nativeOrientation({
      orientation: () => Promise.resolve({ type: "portrait-primary" }),
      addListener: () =>
        new Promise((resolve) => {
          resolveHandle = resolve
        }),
    })
    subscribeScreenOrientation(() => {})()

    const remove = vi.fn(() => Promise.resolve())
    resolveHandle({ remove })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it("binds again for the next subscriber after a late handle removed itself", async () => {
    const handles: Array<(handle: Handle) => void> = []
    let calls = 0
    const { subscribeScreenOrientation } = await nativeOrientation({
      orientation: () => Promise.resolve({ type: "portrait-primary" }),
      addListener: () => {
        calls += 1
        return new Promise((resolve) => handles.push(resolve))
      },
    })
    subscribeScreenOrientation(() => {})()
    const unsub = subscribeScreenOrientation(() => {})
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

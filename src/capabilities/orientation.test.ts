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
  it.each([
    "portrait-primary",
    "portrait-secondary",
    "landscape-primary",
    "landscape-secondary",
  ])("reads screen.orientation.type %s on web", (type) => {
    forceNative(false)
    stubScreenOrientation({ type })
    expect(getScreenOrientation()).toBe(type)
  })

  it.each([
    ["portrait", "portrait-primary"],
    ["landscape", "landscape-primary"],
  ])(
    "falls back to a media query on pre-16.4 WebKit held %s",
    (axis, expected) => {
      //no screen.orientation at all — the axis is still knowable, just not the
      //primary/secondary half, so we report the primary of the right axis. The
      //stub answers by the query it is asked, so asking the wrong axis shows.
      forceNative(false)
      stubScreenOrientation(undefined)
      vi.spyOn(window, "matchMedia").mockImplementation(
        (query) =>
          ({
            matches: query === `(orientation: ${axis})`,
          }) as MediaQueryList,
      )
      expect(getScreenOrientation()).toBe(expected)
    },
  )

  it("reports portrait when neither screen.orientation nor matchMedia exists", () => {
    forceNative(false)
    stubScreenOrientation(undefined)
    vi.stubGlobal("matchMedia", undefined)
    expect(getScreenOrientation()).toBe("portrait-primary")
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

  it("fires on screen.orientation's own change event", async () => {
    //the web binding is made once per module, so bind it on a fresh one
    vi.resetModules()
    restores.push(() => vi.resetModules())
    forceNative(false)
    const orientation = new EventTarget()
    stubScreenOrientation(
      Object.assign(orientation, { type: "portrait-primary" }),
    )
    const { subscribeScreenOrientation } = await import(
      "#adaptv/capabilities/orientation"
    )
    const cb = vi.fn()
    const unsub = subscribeScreenOrientation(cb)

    orientation.dispatchEvent(new Event("change"))
    expect(cb).toHaveBeenCalledTimes(1)
    unsub()
  })
})

describe("orientation — a binary that predates the plugin", () => {
  it("locks through the web API instead of the absent bridge", async () => {
    //→ docs/design/ota.md §5.6. The read and the subscription move the same way,
    //pinned in orientation-no-plugin.test.ts.
    forceNativeBinary([])
    const lock = vi.fn(() => Promise.resolve())
    stubScreenOrientation({ type: "portrait-primary", lock })
    expect(isOrientationLockSupported()).toBe(true)
    await expect(lockScreenOrientation("portrait")).resolves.toBe("ok")
    expect(ScreenOrientation.lock).not.toHaveBeenCalled()
    expect(lock).toHaveBeenCalledWith("portrait")
  })

  it("unlocks through the web API instead of the absent bridge", async () => {
    forceNativeBinary([])
    const unlock = vi.fn()
    stubScreenOrientation({
      type: "portrait-primary",
      lock: () => Promise.resolve(),
      unlock,
    })
    await expect(unlockScreenOrientation()).resolves.toBe("ok")
    expect(ScreenOrientation.unlock).not.toHaveBeenCalled()
    expect(unlock).toHaveBeenCalledTimes(1)
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

describe("orientation — on the server", () => {
  it("answers the defaults without touching a window that is not there", async () => {
    forceNative(false)
    vi.stubGlobal("window", undefined)
    expect(getScreenOrientation()).toBe("portrait-primary")
    expect(isOrientationLockSupported()).toBe(false)
    await expect(lockScreenOrientation("landscape")).resolves.toBe(
      "unsupported",
    )
    await expect(unlockScreenOrientation()).resolves.toBe("unsupported")
    expect(() => subscribeScreenOrientation(() => {})()).not.toThrow()
  })
})

/** Leave the turn so every settled bridge promise has run its handlers. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("orientation — native subscription over a bridge that answers", () => {
  it("pushes a rotation the plugin reports into the snapshot and every subscriber", async () => {
    let onChange: (result: { type: string }) => void = () => {}
    const { getScreenOrientation, subscribeScreenOrientation } =
      await nativeOrientation({
        orientation: () => Promise.resolve({ type: "portrait-primary" }),
        addListener: (
          _event: string,
          listener: (result: { type: string }) => void,
        ) => {
          onChange = listener
          return Promise.resolve({ remove: () => Promise.resolve() })
        },
      })
    //each subscriber records the snapshot it reads when notified, the way
    //useSyncExternalStore does, so a notification before the write reads stale
    const first: string[] = []
    const second: string[] = []
    const unsubFirst = subscribeScreenOrientation(() =>
      first.push(getScreenOrientation()),
    )
    const unsubSecond = subscribeScreenOrientation(() =>
      second.push(getScreenOrientation()),
    )
    await settle()
    first.length = 0
    second.length = 0

    onChange({ type: "landscape-secondary" })
    expect(getScreenOrientation()).toBe("landscape-secondary")
    expect(first).toEqual(["landscape-secondary"])
    expect(second).toEqual(["landscape-secondary"])

    //the plugin's type is a string from the OS, so it is normalised like the web one
    onChange({ type: "face-up" })
    expect(getScreenOrientation()).toBe("portrait-primary")
    expect(first).toEqual(["landscape-secondary", "portrait-primary"])
    expect(second).toEqual(["landscape-secondary", "portrait-primary"])
    unsubFirst()
    unsubSecond()
  })

  it("normalises the first read the plugin answers", async () => {
    const { getScreenOrientation, subscribeScreenOrientation } =
      await nativeOrientation({
        orientation: () => Promise.resolve({ type: "face-down" }),
        addListener: () =>
          Promise.resolve({ remove: () => Promise.resolve() }),
      })
    const cb = vi.fn()
    const unsub = subscribeScreenOrientation(cb)
    await settle()
    expect(cb).toHaveBeenCalledTimes(1)
    expect(getScreenOrientation()).toBe("portrait-primary")
    unsub()
  })

  it("shares one native listener between subscribers and releases it with the last", async () => {
    let calls = 0
    const remove = vi.fn(() => Promise.resolve())
    const { subscribeScreenOrientation } = await nativeOrientation({
      orientation: () => Promise.resolve({ type: "portrait-primary" }),
      addListener: () => {
        calls += 1
        return Promise.resolve({ remove })
      },
    })
    const first = subscribeScreenOrientation(() => {})
    const second = subscribeScreenOrientation(() => {})
    await settle()
    expect(calls).toBe(1)

    first()
    expect(remove).not.toHaveBeenCalled()
    second()
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it("ignores an orientation read that a released binding answers late", async () => {
    //a read requested before the last unsubscribe must not overwrite the value
    //the next binding already seeded, nor notify its subscriber
    const reads: Array<(result: { type: string }) => void> = []
    const { getScreenOrientation, subscribeScreenOrientation } =
      await nativeOrientation({
        orientation: () => new Promise((resolve) => reads.push(resolve)),
        addListener: () =>
          Promise.resolve({ remove: () => Promise.resolve() }),
      })
    subscribeScreenOrientation(() => {})()
    const cb = vi.fn()
    const unsub = subscribeScreenOrientation(cb)

    reads[1]?.({ type: "landscape-primary" })
    await settle()
    expect(getScreenOrientation()).toBe("landscape-primary")
    expect(cb).toHaveBeenCalledTimes(1)

    reads[0]?.({ type: "portrait-secondary" })
    await settle()
    expect(getScreenOrientation()).toBe("landscape-primary")
    expect(cb).toHaveBeenCalledTimes(1)
    unsub()
  })
})

describe("orientation — unlock outcomes", () => {
  it("returns 'rejected' when the plugin refuses the unlock", async () => {
    forceNative(true)
    vi.mocked(ScreenOrientation.unlock).mockRejectedValueOnce(
      new Error("not implemented"),
    )
    await expect(unlockScreenOrientation()).resolves.toBe("rejected")
  })

  it("unlocks through the web API where lock() exists", async () => {
    forceNative(false)
    const unlock = vi.fn()
    stubScreenOrientation({
      type: "portrait-primary",
      lock: () => Promise.resolve(),
      unlock,
    })
    await expect(unlockScreenOrientation()).resolves.toBe("ok")
    expect(unlock).toHaveBeenCalledTimes(1)
    expect(ScreenOrientation.unlock).not.toHaveBeenCalled()
  })

  it("returns 'rejected' when the web unlock throws", async () => {
    forceNative(false)
    stubScreenOrientation({
      type: "portrait-primary",
      lock: () => Promise.resolve(),
      unlock: () => {
        throw new Error("InvalidStateError")
      },
    })
    await expect(unlockScreenOrientation()).resolves.toBe("rejected")
  })
})

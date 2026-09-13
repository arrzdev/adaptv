import { App } from "@capacitor/app"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(() =>
      Promise.resolve({ remove: () => Promise.resolve() }),
    ),
    exitApp: vi.fn(),
  },
}))

const restores: Array<() => void> = []

function setVisibility(state: DocumentVisibilityState): void {
  const prev = Object.getOwnPropertyDescriptor(document, "visibilityState")
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  })
  restores.push(() => {
    if (prev) Object.defineProperty(document, "visibilityState", prev)
  })
}

/** Fresh module per test — the accessor memoises its platform listeners. */
async function freshAppState(native: boolean) {
  vi.resetModules()
  vi.stubGlobal(
    "Capacitor",
    native ? { isNativePlatform: () => true } : undefined,
  )
  return import("#adaptv/capabilities/app-state")
}

beforeEach(() => {
  setVisibility("visible")
})

afterEach(() => {
  for (const r of restores.splice(0)) r()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("getAppState", () => {
  it("reports active while the tab is visible", async () => {
    const { getAppState } = await freshAppState(false)
    expect(getAppState()).toBe("active")
  })

  it("reports background while the tab is hidden", async () => {
    setVisibility("hidden")
    const { getAppState } = await freshAppState(false)
    expect(getAppState()).toBe("background")
  })

  it("assumes active during SSR — never render a paused app", async () => {
    const { getAppState } = await freshAppState(false)
    expect(getAppState()).toBe("active")
  })
})

describe("subscribeAppState — web", () => {
  it("fires on visibilitychange", async () => {
    const { subscribeAppState } = await freshAppState(false)
    const seen: string[] = []
    subscribeAppState((s) => seen.push(s))

    setVisibility("hidden")
    document.dispatchEvent(new Event("visibilitychange"))
    setVisibility("visible")
    document.dispatchEvent(new Event("visibilitychange"))

    expect(seen).toEqual(["background", "active"])
  })

  it("reports a bfcache restore as a resume even if the pause was never seen", async () => {
    //While a page sits in the back-forward cache it is FROZEN — no timers, no
    //events — so the pause that put it there may never have been observed. An
    //edge-triggered emit would then see "active → active" and drop the resume.
    //On mobile Safari this is the most common "the app is back" event, so
    //`persisted` forces the notification.
    const { subscribeAppState } = await freshAppState(false)
    const seen: string[] = []
    subscribeAppState((s) => seen.push(s))

    const restore = new Event("pageshow") as PageTransitionEvent
    Object.defineProperty(restore, "persisted", { value: true })
    window.dispatchEvent(restore)

    expect(seen).toEqual(["active"])
  })

  it("does NOT report an ordinary first load as a resume", async () => {
    //`persisted: false` is a normal navigation, not a restore. Treating it as a
    //resume would fire every token refresh and refetch on every cold load.
    const { subscribeAppState } = await freshAppState(false)
    const seen: string[] = []
    subscribeAppState((s) => seen.push(s))

    window.dispatchEvent(new Event("pageshow"))
    expect(seen).toEqual([])
  })

  it("returns an unsubscribe that actually detaches", async () => {
    const { subscribeAppState } = await freshAppState(false)
    const listener = vi.fn()
    const off = subscribeAppState(listener)
    off()

    setVisibility("hidden")
    document.dispatchEvent(new Event("visibilitychange"))
    expect(listener).not.toHaveBeenCalled()
  })
})

describe("subscribeAppState — native", () => {
  it("binds Capacitor's resume/pause, not visibilitychange", async () => {
    //a native WebView resume is NOT a browser focus or visibility change. This is
    //the whole reason the hook exists: TanStack Query's refetchOnWindowFocus
    //silently never fires on a native resume.
    const { subscribeAppState } = await freshAppState(true)
    subscribeAppState(() => {})

    const events = vi
      .mocked(App.addListener)
      .mock.calls.map((call) => call[0])
    expect(events).toContain("resume")
    expect(events).toContain("pause")
  })
})

describe("onResume / onPause", () => {
  it("fires onResume only on the background→active edge", async () => {
    //not on every notification — a handler that refreshes a token must not fire
    //while the app was already foregrounded
    const { onResume } = await freshAppState(false)
    const resumed = vi.fn()
    onResume(resumed)

    setVisibility("hidden")
    document.dispatchEvent(new Event("visibilitychange"))
    expect(resumed).not.toHaveBeenCalled()

    setVisibility("visible")
    document.dispatchEvent(new Event("visibilitychange"))
    expect(resumed).toHaveBeenCalledOnce()
  })

  it("does not fire onResume for a repeated active signal", async () => {
    const { onResume } = await freshAppState(false)
    const resumed = vi.fn()
    onResume(resumed)

    window.dispatchEvent(new Event("pageshow"))
    window.dispatchEvent(new Event("pageshow"))
    expect(resumed).not.toHaveBeenCalled()
  })

  it("fires onPause on the active→background edge", async () => {
    const { onPause } = await freshAppState(false)
    const paused = vi.fn()
    onPause(paused)

    setVisibility("hidden")
    document.dispatchEvent(new Event("visibilitychange"))
    expect(paused).toHaveBeenCalledOnce()
  })
})

/**
 * A fresh accessor over a stand-in `@capacitor/app`, built of plain functions
 * rather than `vi.fn`: a spy attaches its own handler to every promise it returns,
 * which hides exactly the rejection these tests look for.
 */
async function nativeAppState(app: Record<string, unknown>) {
  vi.resetModules()
  vi.doMock("@capacitor/app", () => ({ App: app }))
  restores.push(() => {
    vi.doUnmock("@capacitor/app")
    vi.resetModules()
  })
  vi.stubGlobal("Capacitor", { isNativePlatform: () => true })
  return import("#adaptv/capabilities/app-state")
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

describe("subscribeAppState — native, over a bridge that fails", () => {
  it("lets no rejected addListener escape, and stays active", async () => {
    //the OTA updater subscribes at boot, so a rejection here would reach the
    //app's error reporter on every cold launch of a binary without the plugin
    const { getAppState, subscribeAppState } = await nativeAppState({
      addListener: rejectWith(
        '"App" plugin is not implemented on android',
      ),
    })
    let unsub = () => {}
    const unhandled = await unhandledDuring(() => {
      unsub = subscribeAppState(() => {})
    })
    expect(unhandled).toEqual([])
    expect(getAppState()).toBe("active")
    unsub()
  })

  it("lets no rejected handle removal escape", async () => {
    const { subscribeAppState } = await nativeAppState({
      addListener: () =>
        Promise.resolve({ remove: rejectWith("bridge: remove failed") }),
    })
    const unsub = subscribeAppState(() => {})
    await new Promise((resolve) => setTimeout(resolve, 0))
    const unhandled = await unhandledDuring(unsub)
    expect(unhandled).toEqual([])
  })

  it("removes both listeners when their handles arrive after the last unsubscribe", async () => {
    //the bridge answers asynchronously, so a subscriber can leave first —
    //StrictMode's dev double-mount always does
    const pending: Array<(handle: Handle) => void> = []
    const { subscribeAppState } = await nativeAppState({
      addListener: () => new Promise((resolve) => pending.push(resolve)),
    })
    subscribeAppState(() => {})()

    const removes = pending.map(() => vi.fn(() => Promise.resolve()))
    pending.forEach((resolve, i) => {
      resolve({ remove: removes[i] as () => Promise<void> })
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(removes).toHaveLength(2)
    for (const remove of removes) expect(remove).toHaveBeenCalledTimes(1)
  })

  it("does not orphan a handle that arrives after a teardown the other one saw", async () => {
    //resume's handle lands, the subscriber leaves (tearing down what it holds),
    //and only then does pause's handle arrive
    const pending: Array<(handle: Handle) => void> = []
    const { subscribeAppState } = await nativeAppState({
      addListener: () => new Promise((resolve) => pending.push(resolve)),
    })
    const unsub = subscribeAppState(() => {})
    const resume = vi.fn(() => Promise.resolve())
    const pause = vi.fn(() => Promise.resolve())
    pending[0]?.({ remove: resume })
    await new Promise((resolve) => setTimeout(resolve, 0))
    unsub()
    pending[1]?.({ remove: pause })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(resume).toHaveBeenCalledTimes(1)
    expect(pause).toHaveBeenCalledTimes(1)
  })
})

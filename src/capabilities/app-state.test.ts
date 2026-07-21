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
  return import("#nativ/capabilities/app-state")
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

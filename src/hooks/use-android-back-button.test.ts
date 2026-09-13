import { App } from "@capacitor/app"
import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  BackPriority,
  registerBackHandler,
  resetBackChain,
  runBackChain,
} from "#adaptv/capabilities/back-chain"
import { useAndroidBackButton } from "#adaptv/hooks/use-android-back-button"

//The router is the one collaborator this hook reaches through React context; a
//fake with a controllable history is the whole surface the floor handler reads.
type FakeRouter = {
  history: { canGoBack: () => boolean; back: () => void }
}
const router = vi.hoisted(() => ({
  current: null as unknown as FakeRouter,
}))

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => router.current,
}))

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(() =>
      Promise.resolve({ remove: vi.fn(() => Promise.resolve()) }),
    ),
    exitApp: vi.fn(() => Promise.resolve()),
  },
}))

function fakeRouter(canGoBack: boolean) {
  return {
    history: { canGoBack: vi.fn(() => canGoBack), back: vi.fn() },
  }
}

function forcePlatform(platform: "web" | "ios" | "android"): void {
  vi.stubGlobal(
    "Capacitor",
    platform === "web"
      ? undefined
      : { isNativePlatform: () => true, getPlatform: () => platform },
  )
}

/** Let the plugin promises settle and Node's unhandled-rejection check run. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  router.current = fakeRouter(false)
})

const original = { addListener: App.addListener, exitApp: App.exitApp }
const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => unhandled.push(reason)

beforeEach(() => {
  process.on("unhandledRejection", onUnhandled)
})

afterEach(() => {
  process.off("unhandledRejection", onUnhandled)
  unhandled.length = 0
  Object.assign(App, original)
  resetBackChain()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("useAndroidBackButton — the floor handler", () => {
  it("navigates back and consumes the press while there is history", () => {
    forcePlatform("web")
    const withHistory = fakeRouter(true)
    router.current = withHistory
    renderHook(() => useAndroidBackButton())

    expect(runBackChain()).toBe(true)
    expect(withHistory.history.back).toHaveBeenCalledTimes(1)
    expect(App.exitApp).not.toHaveBeenCalled()
  })

  it("defers on web with no history, so a tab is never closed under the user", () => {
    forcePlatform("web")
    renderHook(() => useAndroidBackButton())

    expect(runBackChain()).toBe(false)
    expect(App.exitApp).not.toHaveBeenCalled()
  })

  it("exits the app on native with no history", () => {
    forcePlatform("android")
    renderHook(() => useAndroidBackButton())

    expect(runBackChain()).toBe(true)
    expect(App.exitApp).toHaveBeenCalledTimes(1)
  })

  it("re-registers against a new router and unregisters on unmount", () => {
    forcePlatform("web")
    const first = fakeRouter(true)
    const second = fakeRouter(true)
    router.current = first
    const { rerender, unmount } = renderHook(() => useAndroidBackButton())

    router.current = second
    rerender()
    expect(runBackChain()).toBe(true)
    //exactly one floor entry: the stale router's handler is gone, not stacked
    expect(first.history.back).not.toHaveBeenCalled()
    expect(second.history.back).toHaveBeenCalledTimes(1)

    unmount()
    expect(runBackChain()).toBe(false)
  })
})

describe("useAndroidBackButton — the hardware listener", () => {
  it("binds backButton on Android native only, and removes it on unmount", async () => {
    forcePlatform("android")
    const { unmount } = renderHook(() => useAndroidBackButton())
    await settle()

    expect(App.addListener).toHaveBeenCalledTimes(1)
    const [event, onPress] = vi.mocked(App.addListener).mock.calls[0] as [
      string,
      () => void,
    ]
    expect(event).toBe("backButton")

    //the press walks the shared chain, so an overlay above the floor claims it
    const overlay = vi.fn(() => true)
    const unregister = registerBackHandler(overlay, BackPriority.Overlay)
    onPress()
    expect(overlay).toHaveBeenCalledTimes(1)
    unregister()

    const handle = await vi.mocked(App.addListener).mock.results[0]?.value
    unmount()
    expect(handle.remove).toHaveBeenCalledTimes(1)
  })

  it("binds nothing on iOS native or on web, which have no hardware button", () => {
    forcePlatform("ios")
    renderHook(() => useAndroidBackButton())
    forcePlatform("web")
    renderHook(() => useAndroidBackButton())

    expect(App.addListener).not.toHaveBeenCalled()
  })
})

//A bridge call can reject — the plugin missing from a build, the activity already
//finishing. These are deliberately PLAIN functions, not `vi.fn()`: a mock records
//its settled result by attaching a handler to the returned promise, which marks
//the rejection handled and hides exactly the failure under test.
describe("useAndroidBackButton — a rejecting bridge", () => {
  it("does not leak an unhandled rejection when exitApp rejects", async () => {
    forcePlatform("android")
    App.exitApp = () => Promise.reject(new Error("bridge: exitApp"))
    renderHook(() => useAndroidBackButton())

    expect(runBackChain()).toBe(true)
    await settle()
    expect(unhandled).toEqual([])
  })

  it("does not leak an unhandled rejection when addListener rejects", async () => {
    forcePlatform("android")
    App.addListener = () =>
      Promise.reject(new Error("bridge: addListener"))
    const { unmount } = renderHook(() => useAndroidBackButton())
    await settle()
    unmount()

    expect(unhandled).toEqual([])
  })

  it("does not leak an unhandled rejection when the handle's remove rejects", async () => {
    forcePlatform("android")
    const handle = {
      remove: () => Promise.reject(new Error("bridge: remove")),
    }
    App.addListener = () => Promise.resolve(handle)
    const { unmount } = renderHook(() => useAndroidBackButton())
    await settle()
    unmount()
    await settle()

    expect(unhandled).toEqual([])
  })

  it("removes a listener whose registration resolves after unmount", async () => {
    //StrictMode's mount → unmount → mount does exactly this in dev: the cleanup
    //runs before the bridge answers, so the first listener must still be removed
    //when it arrives, or every press runs the chain twice
    forcePlatform("android")
    let resolve: (handle: { remove: () => Promise<void> }) => void =
      () => {}
    const remove = vi.fn(() => Promise.resolve())
    App.addListener = () =>
      new Promise((r) => {
        resolve = r
      })
    const { unmount } = renderHook(() => useAndroidBackButton())
    unmount()

    resolve({ remove })
    await settle()
    expect(remove).toHaveBeenCalledTimes(1)
  })
})

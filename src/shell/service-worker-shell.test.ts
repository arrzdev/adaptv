import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const pwa = vi.hoisted(() => ({ registerSW: vi.fn(), devSw: false }))
const platform = vi.hoisted(() => ({ native: false }))

vi.mock("virtual:adaptv/pwa-register", () => ({
  get DEV_SW_ENABLED() {
    return pwa.devSw
  },
  registerSW: pwa.registerSW,
}))

vi.mock("#adaptv/utils/platform", () => ({
  isNativePlatform: () => platform.native,
}))

type ShellModule = typeof import("#adaptv/shell/service-worker-shell")

/** Fresh module per test: the update signal is module state. */
async function loadShell(): Promise<ShellModule> {
  vi.resetModules()
  return import("#adaptv/shell/service-worker-shell")
}

/** Leave the current job so every pending `.then` in the shell has run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

type FakeRegistration = {
  active: ServiceWorker | null
  waiting: null
  installing: null
  unregister: ReturnType<typeof vi.fn>
}

function registration(
  scriptURL: string,
  unregister: () => Promise<boolean> = () => Promise.resolve(true),
): FakeRegistration {
  return {
    active: { scriptURL } as ServiceWorker,
    waiting: null,
    installing: null,
    unregister: vi.fn(unregister),
  }
}

const own = () => registration(`${window.location.origin}/sw.js`)

function stubServiceWorkers(
  getRegistrations: () => Promise<FakeRegistration[]>,
) {
  vi.stubGlobal("navigator", { serviceWorker: { getRegistrations } })
}

function stubCaches(names: string[]) {
  const store = {
    keys: vi.fn(async () => names),
    delete: vi.fn(async () => true),
  }
  vi.stubGlobal("caches", store)
  return store
}

//`registerPwaServiceWorkerRuntime` discards the preload net's teardown, so the
//listeners it adds are collected here and removed after each test — otherwise
//one test's handler would answer the next test's event.
const listeners: Array<[string, EventListenerOrEventListenerObject]> = []
const reload = vi.fn()

beforeEach(() => {
  pwa.registerSW.mockReset()
  pwa.devSw = false
  platform.native = false
  reload.mockReset()
  sessionStorage.clear()
  vi.stubEnv("DEV", false)
  vi.stubGlobal("location", { origin: "http://localhost:3000", reload })
  const add = window.addEventListener.bind(window)
  vi.spyOn(window, "addEventListener").mockImplementation(
    (type, listener, options) => {
      listeners.push([type, listener])
      add(type, listener, options)
    },
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const [type, listener] of listeners.splice(0))
    window.removeEventListener(type, listener)
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  sessionStorage.clear()
})

describe("registerPwaServiceWorkerRuntime — web production", () => {
  it("registers the app's worker even when the registrations cannot be listed", async () => {
    //The foreign-worker sweep is cleanup; the registration is the product. A
    //rejection in the sweep must not cost the app its worker for the launch.
    stubServiceWorkers(() => Promise.reject(new Error("SecurityError")))
    const { registerPwaServiceWorkerRuntime } = await loadShell()

    registerPwaServiceWorkerRuntime()

    await vi.waitFor(() => expect(pwa.registerSW).toHaveBeenCalledOnce())
  })

  it("registers after the sweep settles, even when a foreign unregister rejects", async () => {
    const ours = own()
    let rejectForeign: (error: Error) => void = () => {}
    const foreign = registration(
      `${window.location.origin}/legacy-sw.js`,
      () =>
        new Promise((_, reject) => {
          rejectForeign = reject
        }),
    )
    stubServiceWorkers(async () => [ours, foreign])
    const { registerPwaServiceWorkerRuntime } = await loadShell()

    registerPwaServiceWorkerRuntime()
    await settle()
    //the sweep is still waiting on the stranger: registering now would race it
    expect(foreign.unregister).toHaveBeenCalledOnce()
    expect(pwa.registerSW).not.toHaveBeenCalled()

    rejectForeign(new Error("InvalidStateError"))
    await vi.waitFor(() => expect(pwa.registerSW).toHaveBeenCalledOnce())
    expect(ours.unregister).not.toHaveBeenCalled()
  })
})

describe("registerPwaServiceWorkerRuntime — where no worker may run", () => {
  it("destroys every worker and cache on native, the app's own included, and never registers", async () => {
    //A worker left over from a `server.url` live-reload session keeps serving the
    //old bundle inside the installed app and silently breaks OTA. The dev opt-in
    //cannot reach past this: native is checked first. → rendering.md §3.5
    platform.native = true
    pwa.devSw = true
    const ours = own()
    stubServiceWorkers(async () => [ours])
    const caches = stubCaches(["static-abc", "pages-abc"])
    const { registerPwaServiceWorkerRuntime } = await loadShell()

    registerPwaServiceWorkerRuntime()

    await vi.waitFor(() => expect(caches.delete).toHaveBeenCalledTimes(2))
    expect(ours.unregister).toHaveBeenCalledOnce()
    await settle()
    expect(pwa.registerSW).not.toHaveBeenCalled()
  })

  it("destroys every worker and cache in dev, the app's own included, and never registers", async () => {
    //A worker from an earlier preview on the same origin would serve the OLD
    //bundle over the dev server and break hot reload. → rendering.md §3.1
    vi.stubEnv("DEV", true)
    const ours = own()
    stubServiceWorkers(async () => [ours])
    const caches = stubCaches(["static-abc"])
    const { registerPwaServiceWorkerRuntime } = await loadShell()

    registerPwaServiceWorkerRuntime()

    await vi.waitFor(() =>
      expect(caches.delete).toHaveBeenCalledWith("static-abc"),
    )
    expect(ours.unregister).toHaveBeenCalledOnce()
    await settle()
    expect(pwa.registerSW).not.toHaveBeenCalled()
  })

  it("registers in dev under ADAPTV_DEV_SW=1, and destroys nothing", async () => {
    vi.stubEnv("DEV", true)
    pwa.devSw = true
    const ours = own()
    const getRegistrations = vi.fn(async () => [ours])
    stubServiceWorkers(getRegistrations)
    const caches = stubCaches(["static-abc"])
    const { registerPwaServiceWorkerRuntime } = await loadShell()

    registerPwaServiceWorkerRuntime()
    await settle()

    expect(pwa.registerSW).toHaveBeenCalledOnce()
    expect(getRegistrations).not.toHaveBeenCalled()
    expect(caches.keys).not.toHaveBeenCalled()
  })
})

describe("destroyServiceWorkers", () => {
  it("is best-effort: a failing unregister or cache delete stops nothing else", async () => {
    const failing = registration("http://localhost:3000/a.js", () =>
      Promise.reject(new Error("InvalidStateError")),
    )
    const other = own()
    stubServiceWorkers(async () => [failing, other])
    const caches = stubCaches(["one", "two"])
    caches.delete.mockImplementationOnce(() =>
      Promise.reject(new Error("QuotaExceededError")),
    )
    const { destroyServiceWorkers } = await loadShell()

    await expect(destroyServiceWorkers()).resolves.toBeUndefined()
    expect(other.unregister).toHaveBeenCalledOnce()
    expect(caches.delete).toHaveBeenCalledWith("two")
  })
})

describe("the serviceWorkerUpdate signal", () => {
  it("stays silent under auto: nothing is offered, and apply is a no-op", async () => {
    //Under `"auto"` the registration module applies a waiting worker itself and
    //never calls back, so an app can call `useServiceWorkerUpdate()` for free.
    stubServiceWorkers(async () => [])
    const shell = await loadShell()
    const listener = vi.fn()
    shell.subscribeServiceWorkerUpdate(listener)

    shell.registerPwaServiceWorkerRuntime()
    await vi.waitFor(() => expect(pwa.registerSW).toHaveBeenCalledOnce())

    expect(shell.getServiceWorkerUpdateAvailable()).toBe(false)
    expect(() => shell.applyServiceWorkerUpdate()).not.toThrow()
    expect(listener).not.toHaveBeenCalled()
  })

  it("under prompt, notifies once per waiting update and applies the latest offer", async () => {
    stubServiceWorkers(async () => [])
    const shell = await loadShell()
    const listener = vi.fn()
    const unsubscribe = shell.subscribeServiceWorkerUpdate(listener)
    shell.registerPwaServiceWorkerRuntime()
    await vi.waitFor(() => expect(pwa.registerSW).toHaveBeenCalledOnce())
    const onWaiting = pwa.registerSW.mock.calls[0]?.[0] as (
      apply: () => void,
    ) => void

    const first = vi.fn()
    const second = vi.fn()
    onWaiting(first)
    //the registration module re-offers on every `installed` statechange; a
    //re-offer of a state that did not change must not re-render subscribers
    onWaiting(second)

    expect(shell.getServiceWorkerUpdateAvailable()).toBe(true)
    expect(listener).toHaveBeenCalledOnce()
    shell.applyServiceWorkerUpdate()
    expect(second).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()

    unsubscribe()
    listener.mockClear()
    onWaiting(first)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe("the stale-chunk net", () => {
  it("is armed on every branch and reloads once, never twice", async () => {
    //Armed before the native and dev early-returns, because a stale chunk is a
    //deploy artifact, not a worker one. The second failure must not reload: a
    //genuinely missing chunk would otherwise spin the browser. → register.md B4
    for (const setup of [
      () => {},
      () => {
        platform.native = true
      },
      () => {
        vi.stubEnv("DEV", true)
      },
    ]) {
      stubServiceWorkers(async () => [])
      stubCaches([])
      setup()
      const { registerPwaServiceWorkerRuntime } = await loadShell()
      registerPwaServiceWorkerRuntime()

      const first = new Event("vite:preloadError", { cancelable: true })
      window.dispatchEvent(first)
      window.dispatchEvent(
        new Event("vite:preloadError", { cancelable: true }),
      )

      //defaultPrevented stops Vite rethrowing it as an unhandled rejection
      expect(first.defaultPrevented).toBe(true)
      expect(reload).toHaveBeenCalledOnce()

      for (const [type, listener] of listeners.splice(0))
        window.removeEventListener(type, listener)
      reload.mockReset()
      sessionStorage.clear()
      platform.native = false
      vi.stubEnv("DEV", false)
    }
  })
})

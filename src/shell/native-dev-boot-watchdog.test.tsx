import {
  createMemoryHistory,
  createRoute,
  RouterProvider,
} from "@tanstack/react-router"
import { renderToReadableStream } from "react-dom/server.browser"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAdaptvRouter } from "#adaptv/shell/create-adaptv-router"
import { createRootRoute } from "#adaptv/shell/create-root-route"
import {
  DEV_BOOT_POLL_MS,
  DEV_BOOT_PROBE_TIMEOUT_MS,
} from "#adaptv/shell/native-dev-boot-watchdog"
import type { LiveReloadHot } from "#adaptv/shell/native-live-reload-client"
import {
  DEV_RECOVERY_ARMED_KEY,
  installNativeLiveReloadRecovery,
} from "#adaptv/shell/native-live-reload-client"

//what the bundle's platform module reports, set per test alongside the injected bridge
const platform = vi.hoisted(() => ({ os: "ios" }))

vi.mock("#adaptv/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#adaptv/utils/platform")>()),
  isNativePlatform: () => true,
  getOS: () => platform.os,
}))

/*
 * `adaptv dev ios`, `r` then `q` a second later: the relaunched WebView had the document and
 * was still loading the bundle when the dev server stopped. errorPath never fired (the document
 * loaded) and the live-reload recovery never existed (the bundle never ran), so the app sat on
 * its server-rendered splash for good. These run the head script of the real dev document, the
 * one the WebView had, with a bundle that never runs or runs too late to see the server go.
 */

/** The inline script the dev document carries in its `<head>`, as the WebView receives it. */
async function devDocumentHeadScript(): Promise<string> {
  const rootRoute = createRootRoute({
    title: "test",
    themeColorLight: "#ffffff",
    themeColorDark: "#000000",
  })
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <p>home</p>,
  })
  const router = createAdaptvRouter({
    routeTree: rootRoute.addChildren([index]),
    options: { history: createMemoryHistory({ initialEntries: ["/"] }) },
  })
  await router.load()
  const stream = await renderToReadableStream(
    <RouterProvider router={router} />,
  )
  await stream.allReady
  const html = await new Response(stream).text()
  const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? ""
  const script = head.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  if (!script)
    throw new Error("the dev document has no inline head script")
  return script
}

const DEV_ORIGIN = "http://192.168.1.5:41820"
const replace = vi.fn()
let headScript: string

/** A socket to the dev server that stays connecting: the tests here never need it to open. */
class PendingSocket {
  static OPEN = 1
  readyState = 0
  addEventListener() {}
}

beforeEach(async () => {
  //rendered before the fakes go in: the render itself must not see a stubbed `fetch`
  headScript ??= await devDocumentHeadScript()
  vi.useFakeTimers()
  replace.mockReset()
  platform.os = "ios"
  vi.stubGlobal("location", {
    href: `${DEV_ORIGIN}/`,
    host: "192.168.1.5:41820",
    protocol: "http:",
    reload: vi.fn(),
    replace,
  })
  vi.stubGlobal("WebSocket", PendingSocket)
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  for (const key of [
    "Capacitor",
    "WEBVIEW_SERVER_URL",
    DEV_RECOVERY_ARMED_KEY,
  ])
    delete (window as unknown as Record<string, unknown>)[key]
})

/** A Capacitor WebView on `os`, the way the native side injects the bridge before any page script. */
function nativeWebView(os: string) {
  platform.os = os
  Object.assign(window, {
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => os,
    },
  })
}

/**
 * The dev server as the WebView reaches it. Up, it answers everything, the served client with
 * a token. Stopped, every request fails the way WebKit fails it against a refused port, with no
 * response. Unreachable (a phone whose Mac went to sleep), a request is never answered at all.
 */
function devServer() {
  let state: "up" | "stopped" | "unreachable" = "up"
  const fetchMock = vi.fn(
    (url: string, _init?: RequestInit): Promise<Response> => {
      if (state === "stopped")
        return Promise.reject(new TypeError("Load failed"))
      if (state === "unreachable") return new Promise(() => {})
      if (url === "/@vite/client")
        return Promise.resolve(new Response('const wsToken = "t0k"'))
      return Promise.resolve(new Response(null, { status: 200 }))
    },
  )
  vi.stubGlobal("fetch", fetchMock)
  return {
    fetchMock,
    stop: () => {
      state = "stopped"
    },
    unreachable: () => {
      state = "unreachable"
    },
    /** The watchdog's and the recovery's reachability probes of the document. */
    probes: () =>
      fetchMock.mock.calls.filter(([, init]) => init?.method === "HEAD")
        .length,
  }
}

function serverStopped() {
  const server = devServer()
  server.stop()
  return server
}

/** Run the document's head script the way the WebView does, before any bundle. */
function loadDocument() {
  new Function(headScript)()
}

/** A fake `import.meta.hot` whose disconnect event already fired, or never will: nobody hears it. */
function deafHot() {
  const listeners: Array<() => void> = []
  const hot = {
    on: (_event: string, cb: () => void) => listeners.push(cb),
  } as unknown as LiveReloadHot
  return {
    hot,
    fire: () => {
      for (const cb of listeners) cb()
    },
  }
}

const OFFLINE_IOS = "capacitor://localhost/adaptv-offline.html"

describe("the native dev document — a dev server that stops before the bundle ran", () => {
  it("takes the app to the offline screen instead of leaving it on the splash", async () => {
    nativeWebView("ios")
    serverStopped()
    loadDocument()

    await vi.advanceTimersByTimeAsync(DEV_BOOT_POLL_MS * 3)

    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith(OFFLINE_IOS)
  })

  it("on Android, to the dev session's cleartext local origin", async () => {
    nativeWebView("android")
    serverStopped()
    loadDocument()

    await vi.advanceTimersByTimeAsync(DEV_BOOT_POLL_MS * 3)

    expect(replace).toHaveBeenCalledWith(
      "http://localhost/adaptv-offline.html",
    )
  })

  it("waits while the server answers, whatever the status, so a slow or broken bundle stays the dev's to see", async () => {
    nativeWebView("ios")
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status: 500 }))),
    )
    loadDocument()

    await vi.advanceTimersByTimeAsync(DEV_BOOT_POLL_MS * 10)

    expect(replace).not.toHaveBeenCalled()
  })

  it("does not eject an app that is in the background", async () => {
    nativeWebView("ios")
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    })
    serverStopped()
    loadDocument()

    await vi.advanceTimersByTimeAsync(DEV_BOOT_POLL_MS * 10)

    expect(replace).not.toHaveBeenCalled()
  })

  it("does nothing in a browser tab, where the dev server's own client is in charge", async () => {
    const { fetchMock } = serverStopped()
    loadDocument()

    await vi.advanceTimersByTimeAsync(DEV_BOOT_POLL_MS * 10)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })
})

describe("the native dev document — a dev server that never answers", () => {
  //one probe, then the next: each waits out the poll and then the whole timeout
  const twoTimedOutProbes =
    (DEV_BOOT_POLL_MS + DEV_BOOT_PROBE_TIMEOUT_MS) * 2

  it("counts a probe that goes unanswered for the whole timeout as a miss, so a sleeping Mac still ends on the offline screen", async () => {
    nativeWebView("ios")
    devServer().unreachable()
    loadDocument()

    await vi.advanceTimersByTimeAsync(twoTimedOutProbes - 100)
    expect(replace).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(200)
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith(OFFLINE_IOS)
  })

  it("does not count an answer that is slow but inside the timeout, which is how a busy dev server looks", async () => {
    nativeWebView("ios")
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve(new Response(null, { status: 200 })),
              DEV_BOOT_PROBE_TIMEOUT_MS - 1000,
            ),
          ),
      ),
    )
    loadDocument()

    await vi.advanceTimersByTimeAsync(twoTimedOutProbes * 3)

    expect(replace).not.toHaveBeenCalled()
  })
})

describe("the handoff from the document's watchdog to the bundle's recovery", () => {
  it("stands down once the recovery has heard from the server, which owns the recovery from then on", async () => {
    nativeWebView("ios")
    const server = devServer()
    loadDocument()

    installNativeLiveReloadRecovery(deafHot().hot)
    await vi.advanceTimersByTimeAsync(0)
    server.stop()
    const probesBefore = server.probes()
    await vi.advanceTimersByTimeAsync(DEV_BOOT_POLL_MS * 10)

    expect(replace).not.toHaveBeenCalled()
    expect(server.probes()).toBe(probesBefore)
  })

  it("keeps watching when the server stopped after the entry ran but before the recovery heard from it", async () => {
    //the dev server's disconnect event fired before the recovery subscribed, and the recovery's
    //own first request failed, so the recovery has nothing that will ever tell it the server went
    nativeWebView("ios")
    serverStopped()
    loadDocument()

    installNativeLiveReloadRecovery(deafHot().hot)
    await vi.advanceTimersByTimeAsync(DEV_BOOT_POLL_MS * 3)

    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace).toHaveBeenCalledWith(OFFLINE_IOS)
  })

  it.each(["fails", "times out"] as const)(
    "stands down when the recovery arms while a probe is in flight, and that probe %s",
    async (outcome) => {
      nativeWebView("ios")
      let failInFlight = () => {}
      let head = 0
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string, init?: RequestInit): Promise<Response> => {
          if (url === "/@vite/client")
            return Promise.resolve(new Response("// no token"))
          if (init?.method !== "HEAD")
            return Promise.resolve(new Response(null))
          head += 1
          //the first probe misses; the second hangs until the test fails it, or for good
          if (head === 1)
            return Promise.reject(new TypeError("Load failed"))
          return new Promise((_resolve, reject) => {
            failInFlight = () => reject(new TypeError("Load failed"))
          })
        }),
      )
      loadDocument()
      await vi.advanceTimersByTimeAsync(DEV_BOOT_POLL_MS * 2)
      expect(head).toBe(2)

      installNativeLiveReloadRecovery(deafHot().hot)
      await vi.advanceTimersByTimeAsync(0)
      expect(
        (window as unknown as Record<string, unknown>)[
          DEV_RECOVERY_ARMED_KEY
        ],
      ).toBe(true)

      if (outcome === "fails") failInFlight()
      await vi.advanceTimersByTimeAsync(DEV_BOOT_PROBE_TIMEOUT_MS * 2)

      //that probe would have been the second miss in a row
      expect(replace).not.toHaveBeenCalled()
      expect(head).toBe(2)
    },
  )
})

/*
 * The watchdog's offline target is an ES5 copy of the recovery's, because it runs before any
 * module. Both are run here over the same WebViews, so a change to one rule and not the other
 * fails.
 */
describe("the watchdog and the recovery agree on where the offline screen is", () => {
  const cases: Array<{
    name: string
    os: string
    injected?: string
    expected: string | null
  }> = [
    { name: "iOS", os: "ios", expected: OFFLINE_IOS },
    {
      name: "Android",
      os: "android",
      expected: "http://localhost/adaptv-offline.html",
    },
    {
      name: "iOS with the local server's URL injected",
      os: "ios",
      injected: "capacitor://localhost",
      expected: OFFLINE_IOS,
    },
    {
      name: "a local server URL injected with a trailing slash",
      os: "android",
      injected: "https://localhost:8443/",
      expected: "https://localhost:8443/adaptv-offline.html",
    },
    {
      name: "Android injecting the dev server's own URL, which is not the local origin",
      os: "android",
      injected: DEV_ORIGIN,
      expected: "http://localhost/adaptv-offline.html",
    },
    {
      name: "a platform with no known local origin",
      os: "web",
      expected: null,
    },
  ]

  it.each(cases)("$name", async ({ os, injected, expected }) => {
    nativeWebView(os)
    if (injected) Object.assign(window, { WEBVIEW_SERVER_URL: injected })
    const targetOf = () => (replace.mock.calls[0]?.[0] as string) ?? null

    serverStopped()
    loadDocument()
    await vi.advanceTimersByTimeAsync(DEV_BOOT_POLL_MS * 10)
    const watchdog = targetOf()

    replace.mockReset()
    const server = devServer()
    const hot = deafHot()
    installNativeLiveReloadRecovery(hot.hot)
    await vi.advanceTimersByTimeAsync(0)
    server.stop()
    hot.fire()
    await vi.advanceTimersByTimeAsync(DEV_BOOT_POLL_MS * 10)
    const recovery = targetOf()

    expect(watchdog).toBe(recovery)
    expect(watchdog).toBe(expected)
  })
})

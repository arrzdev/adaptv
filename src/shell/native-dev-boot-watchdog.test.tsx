import {
  createMemoryHistory,
  createRoute,
  RouterProvider,
} from "@tanstack/react-router"
import { renderToReadableStream } from "react-dom/server.browser"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAdaptvRouter } from "#adaptv/shell/create-adaptv-router"
import { createRootRoute } from "#adaptv/shell/create-root-route"
import { DEV_BOOT_POLL_MS } from "#adaptv/shell/native-dev-boot-watchdog"
import type { LiveReloadHot } from "#adaptv/shell/native-live-reload-client"
import {
  DEV_BUNDLE_RAN_KEY,
  installNativeLiveReloadRecovery,
} from "#adaptv/shell/native-live-reload-client"

vi.mock("#adaptv/utils/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#adaptv/utils/platform")>()),
  isNativePlatform: () => true,
  getOS: () => "ios",
}))

/*
 * `adaptv dev ios`, `r` then `q` a second later: the relaunched WebView had the document and
 * was still loading the bundle when the dev server stopped. errorPath never fired (the document
 * loaded) and the live-reload recovery never existed (the bundle never ran), so the app sat on
 * its server-rendered splash for good. These run the head script of the real dev document, the
 * one the WebView had, with a bundle that never runs.
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

const replace = vi.fn()
let headScript: string

beforeEach(async () => {
  //rendered before the fakes go in: the render itself must not see a stubbed `fetch`
  headScript ??= await devDocumentHeadScript()
  vi.useFakeTimers()
  replace.mockReset()
  vi.stubGlobal("location", {
    href: "http://192.168.1.5:41820/",
    host: "192.168.1.5:41820",
    protocol: "http:",
    reload: vi.fn(),
    replace,
  })
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  })
  delete (window as unknown as Record<string, unknown>)[DEV_BUNDLE_RAN_KEY]
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  delete (window as unknown as Record<string, unknown>).Capacitor
  delete (window as unknown as Record<string, unknown>)[DEV_BUNDLE_RAN_KEY]
})

/** A Capacitor WebView on `platform`, the way the native side injects the bridge before any page script. */
function nativeWebView(platform: "ios" | "android") {
  Object.assign(window, {
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => platform,
    },
  })
}

/** The dev server gone: every request fails the way WebKit fails it, with no response. */
function serverStopped() {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.reject(new TypeError("Load failed")),
  )
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

/** Run the document's head script the way the WebView does, before any bundle. */
function loadDocument() {
  new Function(headScript)()
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

  it("stands down once the bundle runs, which owns the recovery from then on", async () => {
    nativeWebView("ios")
    const fetchMock = serverStopped()
    loadDocument()

    //the entry's first act on a native dev WebView
    installNativeLiveReloadRecovery({
      on: () => {},
    } as unknown as LiveReloadHot)
    const probes = () =>
      fetchMock.mock.calls.filter(([, init]) => init?.method === "HEAD")
        .length
    const probesBefore = probes()
    await vi.advanceTimersByTimeAsync(DEV_BOOT_POLL_MS * 10)

    expect(replace).not.toHaveBeenCalled()
    expect(probes()).toBe(probesBefore)
  })

  it("does nothing in a browser tab, where the dev server's own client is in charge", async () => {
    const fetchMock = serverStopped()
    loadDocument()

    await vi.advanceTimersByTimeAsync(DEV_BOOT_POLL_MS * 10)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })
})

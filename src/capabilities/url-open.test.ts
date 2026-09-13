import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router"
import { render, waitFor } from "@testing-library/react"
import { createElement } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

/*
 * A link that opens the native app has to become a route exactly once. The plugin
 * delivers a launching link twice over — the retained `appUrlOpen` event, replayed to
 * the FIRST listener only, and `getLaunchUrl()` answering the same URL — so the stand-in
 * below does both, and every test that counts navigations counts against both.
 */

type OpenEvent = { url: string }
type Listener = (event: OpenEvent) => void

/**
 * A Capacitor-shaped `App`, built of plain functions rather than `vi.fn`: a spy
 * attaches its own handler to every promise it returns, which would hide exactly the
 * rejection one test below looks for.
 */
function capacitorApp({
  launchUrl,
  addListener,
}: {
  launchUrl?: string
  addListener?: () => Promise<never>
} = {}) {
  const listeners: Listener[] = []
  let retained: OpenEvent | null = launchUrl ? { url: launchUrl } : null
  const calls = { addListener: 0, getLaunchUrl: 0 }
  const app = {
    addListener:
      addListener ??
      ((eventName: string, listener: Listener) => {
        calls.addListener += 1
        if (eventName === "appUrlOpen") {
          listeners.push(listener)
          //retained until consumed: the first listener gets it, nobody after
          if (retained) {
            const event = retained
            retained = null
            queueMicrotask(() => listener(event))
          }
        }
        return Promise.resolve({ remove: () => Promise.resolve() })
      }),
    getLaunchUrl: () => {
      calls.getLaunchUrl += 1
      return Promise.resolve(launchUrl ? { url: launchUrl } : undefined)
    },
  }
  return {
    app,
    calls,
    /** The OS opening the running app with `url` — every listener hears it. */
    open(url: string) {
      for (const listener of listeners) listener({ url })
    },
  }
}

type Navigation = { href: string; replace: boolean }

/** The two things the capability reads off a router, recorded. */
function fakeRouter({ settled = false } = {}) {
  const navigations: Navigation[] = []
  const router = {
    state: { resolvedLocation: settled ? { href: "/" } : undefined },
    navigate: (options: Navigation) => {
      navigations.push(options)
      return Promise.resolve()
    },
  }
  return { router, navigations }
}

const restores: Array<() => void> = []
afterEach(() => {
  for (const restore of restores.splice(0)) restore()
  vi.unstubAllGlobals()
})

/** A fresh capability over `app`, on native unless told otherwise. */
async function urlOpen(
  app: Record<string, unknown>,
  { native = true }: { native?: boolean } = {},
) {
  vi.resetModules()
  vi.doMock("@capacitor/app", () => ({ App: app }))
  restores.push(() => {
    vi.doUnmock("@capacitor/app")
    vi.resetModules()
  })
  vi.stubGlobal(
    "Capacitor",
    native ? { isNativePlatform: () => true } : undefined,
  )
  return import("#adaptv/capabilities/url-open")
}

/** Leave the turn twice, so a replay queued as a microtask (or a chained one) has run. */
const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

type AnyRouterArg = Parameters<
  Awaited<ReturnType<typeof urlOpen>>["installUrlOpen"]
>[0]
const asRouter = (router: unknown) => router as AnyRouterArg

describe("installUrlOpen — the path a link routes to", () => {
  const table: Array<[string, string]> = [
    ["myapp://settings/x?y=1#z", "/settings/x?y=1#z"],
    ["myapp://settings", "/settings"],
    ["myapp:///settings", "/settings"],
    ["myapp:settings", "/settings"],
    ["myapp://", "/"],
    ["myapp://lab/app-state?n=2", "/lab/app-state?n=2"],
    ["https://example.com/a/b?c=1#d", "/a/b?c=1#d"],
    ["https://example.com", "/"],
  ]

  it.each(table)("%s → %s", async (url, path) => {
    const native = capacitorApp()
    const { installUrlOpen } = await urlOpen(native.app)
    const { router, navigations } = fakeRouter({ settled: true })
    installUrlOpen(asRouter(router))
    await settle()

    native.open(url)
    expect(navigations).toEqual([{ href: path, replace: false }])
  })

  it("routes nothing for a string that is not a URL", async () => {
    const native = capacitorApp()
    const { installUrlOpen, onUrlOpened } = await urlOpen(native.app)
    const { router, navigations } = fakeRouter({ settled: true })
    installUrlOpen(asRouter(router))
    const heard = vi.fn()
    onUrlOpened(heard)

    native.open("not a url")
    expect(navigations).toEqual([])
    expect(heard).not.toHaveBeenCalled()
  })
})

describe("installUrlOpen — a launching link routes exactly once", () => {
  it("navigates once for a link the plugin delivers twice, and never asks getLaunchUrl", async () => {
    const native = capacitorApp({
      launchUrl: "myapp://settings?from=mail",
    })
    const { installUrlOpen } = await urlOpen(native.app)
    const { router, navigations } = fakeRouter()

    installUrlOpen(asRouter(router))
    await settle()

    expect(navigations).toEqual([
      { href: "/settings?from=mail", replace: true },
    ])
    expect(native.calls.getLaunchUrl).toBe(0)
  })

  it("attaches one listener however many times the router is built", async () => {
    //StrictMode, a hot update of the route tree, a second `getRouter()` — each builds
    //a router, and a second listener would be a second navigation per link
    const native = capacitorApp({ launchUrl: "myapp://settings" })
    const { installUrlOpen } = await urlOpen(native.app)
    const first = fakeRouter()
    const second = fakeRouter()

    installUrlOpen(asRouter(first.router))
    installUrlOpen(asRouter(second.router))
    await settle()
    native.open("myapp://lab")

    expect(native.calls.addListener).toBe(1)
    //the router built last is the one that moves, and it moves once per link
    expect(first.navigations).toEqual([])
    expect(second.navigations.map((n) => n.href)).toEqual([
      "/settings",
      "/lab",
    ])
  })

  it("replaces the entry for a link that arrives before the first screen settles, and pushes after", async () => {
    const native = capacitorApp({ launchUrl: "myapp://settings" })
    const { installUrlOpen } = await urlOpen(native.app)
    const { router, navigations } = fakeRouter()

    installUrlOpen(asRouter(router))
    await settle()
    router.state.resolvedLocation = { href: "/settings" }
    native.open("myapp://lab")

    expect(navigations).toEqual([
      { href: "/settings", replace: true },
      { href: "/lab", replace: false },
    ])
  })

  it("lets no rejected addListener escape, and the app still boots", async () => {
    const native = capacitorApp({
      addListener: () =>
        Promise.reject(
          new Error('"App" plugin is not implemented on ios'),
        ),
    })
    const { installUrlOpen } = await urlOpen(native.app)
    const { router } = fakeRouter()

    const seen: unknown[] = []
    const listener = (reason: unknown) => seen.push(reason)
    process.on("unhandledRejection", listener)
    try {
      expect(() => installUrlOpen(asRouter(router))).not.toThrow()
      await settle()
    } finally {
      process.off("unhandledRejection", listener)
    }
    expect(seen).toEqual([])
  })
})

describe("installUrlOpen — where it does nothing", () => {
  it("attaches nothing in a browser tab", async () => {
    const native = capacitorApp({ launchUrl: "myapp://settings" })
    const { installUrlOpen } = await urlOpen(native.app, { native: false })
    const { router, navigations } = fakeRouter()

    installUrlOpen(asRouter(router))
    await settle()
    expect(native.calls.addListener).toBe(0)
    expect(navigations).toEqual([])
  })

  it("attaches nothing on the server", async () => {
    const native = capacitorApp({ launchUrl: "myapp://settings" })
    const { installUrlOpen } = await urlOpen(native.app)
    const { router, navigations } = fakeRouter()
    vi.stubGlobal("window", undefined)

    installUrlOpen(asRouter(router))
    await settle()
    expect(native.calls.addListener).toBe(0)
    expect(navigations).toEqual([])
  })
})

describe("onUrlOpened", () => {
  it("hears each link once, after it was routed, until unsubscribed", async () => {
    const native = capacitorApp()
    const { installUrlOpen, onUrlOpened } = await urlOpen(native.app)
    const { router, navigations } = fakeRouter({ settled: true })
    installUrlOpen(asRouter(router))
    await settle()

    const heard: Array<{ url: string; path: string; routed: number }> = []
    const off = onUrlOpened((opened) =>
      heard.push({ ...opened, routed: navigations.length }),
    )
    native.open("myapp://settings?tab=2")
    off()
    native.open("myapp://lab")

    expect(heard).toEqual([
      {
        url: "myapp://settings?tab=2",
        path: "/settings?tab=2",
        routed: 1,
      },
    ])
    expect(navigations).toHaveLength(2)
  })

  it("never fires in a browser tab", async () => {
    const native = capacitorApp()
    const { installUrlOpen, onUrlOpened } = await urlOpen(native.app, {
      native: false,
    })
    installUrlOpen(asRouter(fakeRouter().router))
    const heard = vi.fn()
    onUrlOpened(heard)

    native.open("myapp://settings")
    expect(heard).not.toHaveBeenCalled()
  })
})

/*
 * The fake router above records what the capability asks for. These pin that the ask
 * means what the capability thinks it means, on the real router: `navigate({ href,
 * replace })` takes a path with its query and fragment, `replace` takes the entry, and
 * `state.resolvedLocation` is unset until the first screen has rendered.
 */
describe("installUrlOpen — on a real router", () => {
  function realRouter() {
    const rootRoute = createRootRoute()
    const page = (path: string) =>
      createRoute({
        getParentRoute: () => rootRoute,
        path,
        component: () => createElement("p", null, `page ${path}`),
      })
    return createRouter({
      routeTree: rootRoute.addChildren([
        page("/"),
        page("/settings/x"),
        page("/lab"),
      ]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    })
  }

  it("a cold link takes the first entry, a warm one stacks on it", async () => {
    const native = capacitorApp({ launchUrl: "myapp://settings/x?y=1#z" })
    const { installUrlOpen } = await urlOpen(native.app)
    const router = realRouter()

    installUrlOpen(router)
    expect(router.state.resolvedLocation).toBeUndefined()
    await settle()
    expect(router.history.length).toBe(1)

    const view = render(createElement(RouterProvider, { router }))
    await view.findByText("page /settings/x")
    await waitFor(() =>
      expect(router.state.resolvedLocation).toBeDefined(),
    )
    expect(router.state.location.href).toBe("/settings/x?y=1#z")
    expect(router.history.length).toBe(1)

    native.open("myapp://lab")
    await view.findByText("page /lab")
    expect(router.history.length).toBe(2)
    expect(native.calls.getLaunchUrl).toBe(0)
    view.unmount()
  })
})

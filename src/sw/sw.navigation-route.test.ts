/// <reference lib="webworker" />

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Route } from "workbox-routing"
import { registerNavigationRoute } from "#adaptv/sw/sw.navigation"
import type { TestServiceWorkerScope } from "#adaptv/sw/sw.test-helper"
import {
  browserRequest,
  installServiceWorkerScope,
  routeThrough,
  TestExtendableEvent,
  TestFetchEvent,
} from "#adaptv/sw/sw.test-helper"

/*
 * `registerNavigationRoute` — the wiring around `serveNavigation`, per render
 * mode. `sw.navigation.test.ts` covers the handler's timing in isolation; this
 * file covers what reaches it: which navigations each mode claims, what the
 * handler is actually given (the preload, the fetch, the shell), and the
 * preload decision on activate. → `docs/design/rendering.md §3.1`, §3.3
 *
 * Workbox's Router and Route are real. The precache is not: a real one needs an
 * install to have run, and what is under test is which URL the route binds to.
 */

const routes = vi.hoisted(() => [] as unknown[])
const precache = vi.hoisted(() => ({
  bound: [] as string[],
  matched: [] as string[],
  shell: true,
}))

vi.mock("workbox-routing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("workbox-routing")>()
  return {
    ...actual,
    registerRoute: (
      capture: ConstructorParameters<typeof actual.Route>[0],
      handler: ConstructorParameters<typeof actual.Route>[1],
      method?: ConstructorParameters<typeof actual.Route>[2],
    ) => {
      const route = new actual.Route(capture, handler, method)
      routes.push(route)
      return route
    },
  }
})

vi.mock("workbox-precaching", () => ({
  createHandlerBoundToURL: (url: string) => {
    precache.bound.push(url)
    return async () => new Response(`shell:${url}`)
  },
  matchPrecache: async (url: string) => {
    precache.matched.push(url)
    return precache.shell ? new Response(`shell:${url}`) : undefined
  },
}))

const SPA_SHELL = "/index.html"
const SSR_SHELL = "/adaptv-shell.html"

let sw: TestServiceWorkerScope

beforeEach(() => {
  routes.length = 0
  precache.bound.length = 0
  precache.matched.length = 0
  precache.shell = true
  sw = installServiceWorkerScope()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function navigate(
  path: string,
  init: { method?: string; preload?: Promise<unknown> } = {},
) {
  return new TestFetchEvent(
    browserRequest(path, {
      mode: "navigate",
      destination: "document",
      method: init.method,
    }),
    init.preload,
  )
}

async function serve(event: TestFetchEvent) {
  return routeThrough(routes as Route[], event)
}

async function activate() {
  await sw.dispatch(new TestExtendableEvent("activate")).settled()
}

describe("capacitor — no navigation handling at all", () => {
  it("registers no route and never touches the preload", async () => {
    //§3.5: the bundle is on disk, and a worker in front of it is hostile to OTA
    const policy = registerNavigationRoute({
      mode: "capacitor",
      appShellUrl: SPA_SHELL,
    })
    expect(policy.kind).toBe("none")
    expect(routes).toHaveLength(0)
    expect(sw.listenerCount("activate")).toBe(0)
  })
})

describe("spa — every ordinary navigation gets the app shell", () => {
  beforeEach(() => {
    registerNavigationRoute({ mode: "spa", appShellUrl: SPA_SHELL })
  })

  it("binds the route to the precached shell and answers with it", async () => {
    expect(precache.bound).toEqual([SPA_SHELL])
    const response = await serve(navigate("/todos/42"))
    await expect(response?.text()).resolves.toBe(`shell:${SPA_SHELL}`)
    expect(sw.fetch).not.toHaveBeenCalled()
  })

  it("leaves a file link to the browser", async () => {
    //MEASURED in §3.3: `/sitemap.xml` came back as the shell's text/html
    //before the file rule existed
    expect(await serve(navigate("/sitemap.xml"))).toBeUndefined()
    expect(await serve(navigate("/whitepaper.pdf"))).toBeUndefined()
  })

  it("leaves denied prefixes to the browser", async () => {
    for (const path of ["/api/session", "/assets/x", "/_serverFn/todos"]) {
      expect(await serve(navigate(path))).toBeUndefined()
    }
  })

  it("claims nothing that is not a navigation", async () => {
    const event = new TestFetchEvent(browserRequest("/settings"))
    expect(await serve(event)).toBeUndefined()
  })

  it("turns the preload OFF on activate", async () => {
    //no navigation here reaches the network, so a preload is a document
    //fetched and thrown away on every navigation
    await activate()
    expect(
      sw.scope.registration.navigationPreload.disable,
    ).toHaveBeenCalled()
    expect(
      sw.scope.registration.navigationPreload.enable,
    ).not.toHaveBeenCalled()
  })
})

describe("spa — an app's deny prefixes", () => {
  it("replace the defaults, and the file rule survives", async () => {
    registerNavigationRoute({
      mode: "spa",
      appShellUrl: SPA_SHELL,
      denyPathPrefixes: ["/auth/"],
    })
    expect(await serve(navigate("/auth/callback"))).toBeUndefined()
    //`/api/` was only a default: restating the list dropped it
    await expect(
      (await serve(navigate("/api/session")))?.text(),
    ).resolves.toBe(`shell:${SPA_SHELL}`)
    expect(await serve(navigate("/files/report.pdf"))).toBeUndefined()
  })
})

describe("ssr — the network first, the shell only as a fallback", () => {
  beforeEach(() => {
    registerNavigationRoute({ mode: "ssr", appShellUrl: SSR_SHELL })
  })

  it("serves the preload the browser started, and fetches nothing", async () => {
    const response = await serve(
      navigate("/settings", {
        preload: Promise.resolve(new Response("preloaded")),
      }),
    )
    await expect(response?.text()).resolves.toBe("preloaded")
    expect(sw.fetch).not.toHaveBeenCalled()
  })

  it("fetches the ORIGINAL request where the browser has no preload (Firefox)", async () => {
    //Firefox and Safari < 17.4 have no preload at all, so this fetch is what
    //every navigation runs there — and preload being on hides it from every
    //Chromium run (memory: preload-masks-the-fallback-fetch). It must be the
    //request itself: `fetch(url.href)` loses `redirect: "manual"`, and every
    //redirected navigation dies with "Response served by service worker has
    //redirections".
    sw.fetch.mockResolvedValue(new Response("server render"))
    const event = navigate("/settings")
    expect("preloadResponse" in event).toBe(false)

    const response = await serve(event)

    await expect(response?.text()).resolves.toBe("server render")
    expect(sw.fetch).toHaveBeenCalledOnce()
    expect(sw.fetch.mock.calls[0][0]).toBe(event.request)
  })

  it("fetches the original request when the preload resolves undefined", async () => {
    //preload supported but not applied yet — the first navigation after an
    //install. Not a network failure, so not a shell boot.
    sw.fetch.mockResolvedValue(new Response("server render"))
    const event = navigate("/settings", {
      preload: Promise.resolve(undefined),
    })
    const response = await serve(event)
    await expect(response?.text()).resolves.toBe("server render")
    expect(sw.fetch.mock.calls[0][0]).toBe(event.request)
    expect(precache.matched).toEqual([])
  })

  it("boots from the precached shell offline", async () => {
    const response = await serve(navigate("/todos/42"))
    await expect(response?.text()).resolves.toBe(`shell:${SSR_SHELL}`)
    expect(precache.matched).toEqual([SSR_SHELL])
    //the shell is bound by name, never written: nothing may cache a document
    expect(await sw.caches.keys()).toEqual([])
  })

  it("boots from the shell when the preload itself fails", async () => {
    const response = await serve(
      navigate("/todos/42", {
        preload: Promise.reject(new TypeError("Failed to fetch")),
      }),
    )
    await expect(response?.text()).resolves.toBe(`shell:${SSR_SHELL}`)
    expect(sw.fetch).not.toHaveBeenCalled()
  })

  it("returns a network error when the shell is gone too", async () => {
    precache.shell = false
    const response = await serve(navigate("/todos/42"))
    expect(response?.type).toBe("error")
  })

  it("claims a file link and passes it to the network", async () => {
    //claimed on purpose — declining leaves the browser's preload unread and
    //MEASURED two document hits at the origin for one `/whitepaper.pdf`
    sw.fetch.mockResolvedValue(new Response("%PDF"))
    const response = await serve(navigate("/whitepaper.pdf"))
    await expect(response?.text()).resolves.toBe("%PDF")
  })

  it("never answers a file link with the shell offline", async () => {
    //HTML where a PDF was asked for is worse than the browser's own error
    const response = await serve(navigate("/whitepaper.pdf"))
    expect(response?.type).toBe("error")
    expect(precache.matched).toEqual([])
  })

  it("leaves denied prefixes and non-navigations to the browser", async () => {
    expect(await serve(navigate("/api/session"))).toBeUndefined()
    expect(
      await serve(new TestFetchEvent(browserRequest("/settings"))),
    ).toBeUndefined()
    expect(sw.fetch).not.toHaveBeenCalled()
  })

  it("never sees a POST navigation — a form submit goes straight to the browser", async () => {
    //§3.3: `registerRoute` matches GET only
    expect(
      await serve(navigate("/login", { method: "POST" })),
    ).toBeUndefined()
    expect(sw.fetch).not.toHaveBeenCalled()
  })

  it("turns the preload ON on activate", async () => {
    await activate()
    expect(
      sw.scope.registration.navigationPreload.enable,
    ).toHaveBeenCalled()
    expect(
      sw.scope.registration.navigationPreload.disable,
    ).not.toHaveBeenCalled()
  })
})

describe("ssr — the deadline", () => {
  const never = () => new Promise<Response>(() => {})

  it("boots from the shell after 3 seconds by default", async () => {
    vi.useFakeTimers()
    registerNavigationRoute({ mode: "ssr", appShellUrl: SSR_SHELL })
    sw.fetch.mockImplementation(never)

    let settled = false
    const pending = serve(navigate("/settings")).then((response) => {
      settled = true
      return response
    })
    await vi.advanceTimersByTimeAsync(2999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect((await pending)?.text()).resolves.toBe(
      `shell:${SSR_SHELL}`,
    )
  })

  it("uses the app's networkTimeoutSeconds, and holds the event open for the abandoned preload", async () => {
    vi.useFakeTimers()
    registerNavigationRoute({
      mode: "ssr",
      appShellUrl: SSR_SHELL,
      networkTimeoutSeconds: 1,
    })
    const event = navigate("/settings", { preload: never() })

    const pending = serve(event)
    await vi.advanceTimersByTimeAsync(1000)

    await expect((await pending)?.text()).resolves.toBe(
      `shell:${SSR_SHELL}`,
    )
    //dropping the event here cancels the browser's own preload and logs a
    //warning on a navigation that behaved exactly as designed
    expect(event.pending).toHaveLength(1)
  })
})

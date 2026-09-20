/// <reference lib="webworker" />

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ExpirationPlugin } from "workbox-expiration"
import type { Route } from "workbox-routing"
import type { Strategy } from "workbox-strategies"
import type { CacheRouteOptions } from "#adaptv/sw/sw.cache-route"
import { cacheRoute } from "#adaptv/sw/sw.cache-route"
import { selectStaleCaches } from "#adaptv/sw/sw.navigation-policy"
import type { TestServiceWorkerScope } from "#adaptv/sw/sw.test-helper"
import {
  browserRequest,
  installServiceWorkerScope,
  ORIGIN,
  routeThrough,
  TestFetchEvent,
} from "#adaptv/sw/sw.test-helper"

/*
 * `cacheRoute` — runtime caching for an app's OWN requests, from a module in
 * `serviceWorkers: []`. Workbox's Router, Route and strategies are the real
 * ones; only `registerRoute`'s singleton is swapped for a list the test routes
 * through, so the default router never adds a fetch listener to a fake scope.
 */

const routes = vi.hoisted(() => [] as unknown[])

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

let sw: TestServiceWorkerScope

beforeEach(() => {
  routes.length = 0
  sw = installServiceWorkerScope()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const API = `${ORIGIN}/data/todos`

function register(overrides: Partial<CacheRouteOptions> = {}) {
  cacheRoute({
    match: (url) => url.pathname.startsWith("/data/"),
    strategy: "network-first",
    cacheName: "todos",
    ...overrides,
  })
  expect(routes).toHaveLength(1)
  const route = routes[0] as Route
  return { route, strategy: route.handler as unknown as Strategy }
}

async function get(path = "/data/todos", init = {}) {
  const event = new TestFetchEvent(browserRequest(path, init))
  const response = await routeThrough(routes as Route[], event)
  //the strategy writes the cache after it answers, inside waitUntil
  await event.settled()
  return response
}

function json(body: string, status = 200) {
  return new Response(body, { status })
}

describe("cacheRoute — which strategy, which bucket", () => {
  it("maps each strategy string to its Workbox strategy", () => {
    //a string, not a constructed object, so the caching library stays an
    //implementation detail adaptv can swap (rendering §3.6)
    const expected = {
      "network-first": "NetworkFirst",
      "cache-first": "CacheFirst",
      "stale-while-revalidate": "StaleWhileRevalidate",
    } as const
    for (const [strategy, className] of Object.entries(expected)) {
      routes.length = 0
      const registered = register({
        strategy: strategy as keyof typeof expected,
      })
      expect(registered.strategy.constructor.name).toBe(className)
    }
  })

  it("namespaces the bucket as app-<name>", () => {
    expect(register({ cacheName: "todos" }).strategy.cacheName).toBe(
      "app-todos",
    )
  })

  it("names buckets the build sweep can never take, whatever the app calls them", () => {
    //an app naming its cache "static-v1" must not lose it on the next deploy
    //just because adaptv owns the `static-<tag>` shape (register B2)
    const names = ["static-v1", "pages-old", "documents"].map(
      (cacheName) => {
        routes.length = 0
        return register({ cacheName }).strategy.cacheName
      },
    )
    expect(selectStaleCaches(names, "myapp-2f9c1a", "/")).toEqual([])
  })

  it("passes the network timeout to network-first", () => {
    const { strategy } = register({ networkTimeoutSeconds: 4 })
    expect(
      (strategy as unknown as { _networkTimeoutSeconds: number })
        ._networkTimeoutSeconds,
    ).toBe(4)
  })

  it("is a permanent cache unless a window is given", () => {
    const hasExpiration = (s: Strategy) =>
      s.plugins.some((plugin) => plugin instanceof ExpirationPlugin)
    expect(hasExpiration(register().strategy)).toBe(false)
    routes.length = 0
    expect(hasExpiration(register({ maxEntries: 50 }).strategy)).toBe(true)
    routes.length = 0
    expect(hasExpiration(register({ maxAgeSeconds: 60 }).strategy)).toBe(
      true,
    )
  })
})

describe("cacheRoute — what it may claim", () => {
  it("asks the app's matcher with the url and the request", () => {
    const match = vi.fn(() => true)
    const { route } = register({ match })
    const request = browserRequest("/data/todos")
    const url = new URL(request.url)
    expect(route.match({ url, request } as never)).toBe(true)
    expect(match).toHaveBeenCalledWith(url, request)
  })

  it("never answers a navigation, even when the app's matcher says yes", async () => {
    //on the capacitor target no navigation route sits in front, so this guard
    //is the only thing between a broad matcher and a document served out of a
    //shared cache — a cross-user leak (rendering §3.2, register B25)
    const match = vi.fn(() => true)
    register({ match })
    sw.caches.seed("app-todos", "/dashboard", json("someone's page"))
    await expect(get("/dashboard", { mode: "navigate" })).resolves.toBe(
      undefined,
    )
    expect(match).not.toHaveBeenCalled()
  })

  it("never claims a non-GET, even when the app's matcher says yes", async () => {
    register({ match: () => true })
    await expect(get("/data/todos", { method: "POST" })).resolves.toBe(
      undefined,
    )
    expect(sw.fetch).not.toHaveBeenCalled()
  })

  it("leaves requests the app's matcher declines to the browser", async () => {
    register()
    await expect(get("/elsewhere")).resolves.toBe(undefined)
  })
})

describe("cacheRoute — network-first", () => {
  it("serves the network and keeps a copy", async () => {
    sw.fetch.mockResolvedValue(json("fresh"))
    register()
    await expect((await get())?.text()).resolves.toBe("fresh")
    expect(sw.caches.urlsIn("app-todos")).toEqual([API])
  })

  it("falls back to the copy when the network fails", async () => {
    sw.caches.seed("app-todos", API, json("cached"))
    sw.fetch.mockRejectedValue(new TypeError("Failed to fetch"))
    register()
    await expect((await get())?.text()).resolves.toBe("cached")
  })

  it("rejects when the network fails and there is no copy", async () => {
    //no fallback to invent: the app's fetch sees the network error it caused
    sw.fetch.mockRejectedValue(new TypeError("Failed to fetch"))
    register()
    await expect(get()).rejects.toThrow()
  })

  it("does not keep an error response", async () => {
    sw.fetch.mockResolvedValue(json("oops", 500))
    register()
    expect((await get())?.status).toBe(500)
    expect(sw.caches.urlsIn("app-todos")).toEqual([])
  })

  it("does not keep an opaque response", async () => {
    //status 0: nothing can be known about it, including whether it is an
    //error — Workbox would cache it by default, adaptv's plugin refuses
    const opaque = json("")
    Object.defineProperty(opaque, "status", { value: 0 })
    Object.defineProperty(opaque, "type", { value: "opaque" })
    sw.fetch.mockResolvedValue(opaque)
    register({ match: () => true })
    await get("https://cdn.example/lib.js", { mode: "no-cors" })
    expect(sw.caches.urlsIn("app-todos")).toEqual([])
  })
})

describe("cacheRoute — cache-first", () => {
  it("serves a hit without touching the network", async () => {
    sw.caches.seed("app-todos", API, json("cached"))
    register({ strategy: "cache-first" })
    await expect((await get())?.text()).resolves.toBe("cached")
    expect(sw.fetch).not.toHaveBeenCalled()
  })

  it("fetches a miss and keeps it", async () => {
    sw.fetch.mockResolvedValue(json("fresh"))
    register({ strategy: "cache-first" })
    await expect((await get())?.text()).resolves.toBe("fresh")
    expect(sw.caches.urlsIn("app-todos")).toEqual([API])
  })

  it("rejects a miss when the network fails", async () => {
    sw.fetch.mockRejectedValue(new TypeError("Failed to fetch"))
    register({ strategy: "cache-first" })
    await expect(get()).rejects.toThrow()
  })

  it("only reads its own bucket", async () => {
    //another rule's copy of the same URL is not this rule's cache
    sw.caches.seed("app-other", API, json("someone else's"))
    sw.fetch.mockResolvedValue(json("fresh"))
    register({ strategy: "cache-first" })
    await expect((await get())?.text()).resolves.toBe("fresh")
  })
})

describe("cacheRoute — stale-while-revalidate", () => {
  it("answers from the copy and refreshes it for next time", async () => {
    sw.caches.seed("app-todos", API, json("stale"))
    sw.fetch.mockResolvedValue(json("fresh"))
    register({ strategy: "stale-while-revalidate" })

    await expect((await get())?.text()).resolves.toBe("stale")
    expect(sw.fetch).toHaveBeenCalledOnce()
    const next = await sw.caches.match(API, { cacheName: "app-todos" })
    await expect(next?.text()).resolves.toBe("fresh")
  })

  it("still answers from the copy when the refresh fails", async () => {
    sw.caches.seed("app-todos", API, json("stale"))
    sw.fetch.mockRejectedValue(new TypeError("Failed to fetch"))
    register({ strategy: "stale-while-revalidate" })
    await expect((await get())?.text()).resolves.toBe("stale")
  })
})

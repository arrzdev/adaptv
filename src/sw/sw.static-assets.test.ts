/// <reference lib="webworker" />

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Route } from "workbox-routing"
import { registerServiceWorkerLifecycle } from "#adaptv/sw/sw.lifecycle"
import { registerStaticAssetsRoute } from "#adaptv/sw/sw.static-assets"
import type { TestServiceWorkerScope } from "#adaptv/sw/sw.test-helper"
import {
  browserRequest,
  installServiceWorkerScope,
  ORIGIN,
  routeThrough,
  TestExtendableEvent,
  TestFetchEvent,
} from "#adaptv/sw/sw.test-helper"

/*
 * adaptv's one runtime asset route: CacheFirst into `static-<buildTag>`.
 * → `docs/design/rendering.md §3.3`, register B2. Real Workbox Router, Route
 * and CacheFirst; only the singleton `registerRoute` is swapped for a list.
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

const TAG = "myapp-2f9c1a"
const PREVIOUS = "myapp-0000aa"
const ICON = `${ORIGIN}/icon-192.png`

let sw: TestServiceWorkerScope

beforeEach(() => {
  routes.length = 0
  sw = installServiceWorkerScope()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function request(
  path: string,
  init: Parameters<typeof browserRequest>[1] = { destination: "image" },
) {
  const event = new TestFetchEvent(browserRequest(path, init))
  const response = await routeThrough(routes as Route[], event)
  await event.settled()
  return response
}

function png(body: string) {
  return new Response(body, { headers: { "content-type": "image/png" } })
}

describe("registerStaticAssetsRoute — bound to this build's bucket", () => {
  it("caches into static-<buildTag>, cache-first, ignoring Vary", () => {
    const { strategy } = registerStaticAssetsRoute({ buildTag: TAG })
    expect(strategy.cacheName).toBe(`static-${TAG}`)
    expect(strategy.constructor.name).toBe("CacheFirst")
    //safe only because the filename or the bucket is the version (B25)
    expect(strategy.matchOptions?.ignoreVary).toBe(true)
  })

  it("serves a hit from this build's bucket without the network", async () => {
    sw.caches.seed(`static-${TAG}`, ICON, png("this build"))
    registerStaticAssetsRoute({ buildTag: TAG })
    await expect((await request("/icon-192.png"))?.text()).resolves.toBe(
      "this build",
    )
    expect(sw.fetch).not.toHaveBeenCalled()
  })

  it("refetches an unhashed file once the build changes", async () => {
    //why CacheFirst is correct for `/icon-192.png` at all: the previous
    //build's copy sits in a bucket this worker never reads
    sw.caches.seed(`static-${PREVIOUS}`, ICON, png("last build"))
    sw.fetch.mockResolvedValue(png("this build"))
    registerStaticAssetsRoute({ buildTag: TAG })

    await expect((await request("/icon-192.png"))?.text()).resolves.toBe(
      "this build",
    )
    expect(sw.caches.urlsIn(`static-${TAG}`)).toEqual([ICON])
  })

  it("rejects a miss when the network is down — no cross-build fallback", async () => {
    sw.caches.seed(`static-${PREVIOUS}`, ICON, png("last build"))
    registerStaticAssetsRoute({ buildTag: TAG })
    await expect(request("/icon-192.png")).rejects.toThrow()
  })

  it("claims through the asset matcher and nothing wider", async () => {
    sw.fetch.mockResolvedValue(png("net"))
    registerStaticAssetsRoute({
      buildTag: TAG,
      excludePathPrefixes: ["/uploads/"],
    })
    expect(await request("/uploads/me.png")).toBeUndefined()
    expect(await request("/api/avatar.png")).toBeUndefined()
    expect(
      await request("/icon.png", {
        mode: "navigate",
        destination: "image",
      }),
    ).toBeUndefined()
    expect(
      await request("https://cdn.example/icon.png", {
        destination: "image",
      }),
    ).toBeUndefined()
    expect(
      await request("/assets/a.png", {
        method: "POST",
        destination: "image",
      }),
    ).toBeUndefined()
    expect(sw.fetch).not.toHaveBeenCalled()
  })
})

describe("the asset bucket across a deploy — register B2 end to end", () => {
  it("activate removes the previous build's asset bucket and keeps this one", async () => {
    //the whole lifecycle of one unhashed file across a deploy, on one scope:
    //build N-1 left a bucket behind, build N serves and fills its own, and
    //build N's activate frees N-1's — the growth B2 was filed for
    sw.caches.seed(`static-${PREVIOUS}`, ICON, png("last build"))
    sw.caches.seed("app-avatars", ICON, png("the app's own"))
    sw.fetch.mockResolvedValue(png("this build"))

    registerStaticAssetsRoute({ buildTag: TAG })
    registerServiceWorkerLifecycle({ buildTag: TAG })

    await request("/icon-192.png")
    const activate = sw.dispatch(new TestExtendableEvent("activate"))
    await activate.settled()

    expect((await sw.caches.keys()).sort()).toEqual([
      "app-avatars",
      `static-${TAG}`,
    ])
  })
})

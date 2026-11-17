/// <reference lib="webworker" />

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { WorkboxPlugin } from "workbox-core/types"
import { createCacheOkResponsesPlugin } from "#adaptv/sw/sw.plugins"
import { createCacheFirstStrategy } from "#adaptv/sw/sw.strategies"
import type { TestServiceWorkerScope } from "#adaptv/sw/sw.test-helper"
import {
  browserRequest,
  installServiceWorkerScope,
  ORIGIN,
  TestFetchEvent,
} from "#adaptv/sw/sw.test-helper"

/*
 * `createCacheOkResponsesPlugin` — the gate every adaptv strategy puts in front
 * of the cache. Only a 200 is kept: an opaque response hides its status (it may
 * be a 500), a redirect or a 206 is not the resource itself, and an error body
 * cached once would be served offline for as long as the entry lives.
 */

function cacheWillUpdate(response: Response | undefined) {
  const plugin = createCacheOkResponsesPlugin()
  return plugin.cacheWillUpdate?.({
    request: new Request(`${ORIGIN}/data/item`),
    response: response as Response,
    event: new Event("fetch") as ExtendableEvent,
    state: {},
  })
}

/** What a cross-origin `no-cors` fetch returns: status 0, body unreadable. */
function opaqueResponse(): Response {
  const response = new Response(null)
  Object.defineProperty(response, "status", { value: 0 })
  Object.defineProperty(response, "type", { value: "opaque" })
  return response
}

describe("createCacheOkResponsesPlugin — cacheWillUpdate", () => {
  it("keeps a 200 as it is", async () => {
    const response = new Response("ok", { status: 200 })
    expect(await cacheWillUpdate(response)).toBe(response)
  })

  it("refuses an opaque response — its status could be anything", async () => {
    expect(await cacheWillUpdate(opaqueResponse())).toBeNull()
  })

  it("refuses a network error", async () => {
    expect(await cacheWillUpdate(Response.error())).toBeNull()
  })

  it.each([
    [204, "no content"],
    [206, "a partial body"],
    [301, "a redirect"],
    [304, "a revalidation with no body"],
  ])(
    "refuses a %i (%s) — only the full resource is kept",
    async (status) => {
      const body = status === 204 || status === 304 ? null : "x"
      expect(
        await cacheWillUpdate(new Response(body, { status })),
      ).toBeNull()
    },
  )

  it.each([400, 401, 403, 404, 410, 429])(
    "refuses a %i client error",
    async (status) => {
      expect(
        await cacheWillUpdate(new Response("nope", { status })),
      ).toBeNull()
    },
  )

  it.each([500, 502, 503, 504])(
    "refuses a %i server error",
    async (status) => {
      expect(
        await cacheWillUpdate(new Response("down", { status })),
      ).toBeNull()
    },
  )

  it("refuses when there is no response at all", async () => {
    expect(await cacheWillUpdate(undefined)).toBeNull()
  })
})

describe("createCacheOkResponsesPlugin — inside a real strategy", () => {
  let sw: TestServiceWorkerScope

  beforeEach(() => {
    sw = installServiceWorkerScope()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function fetchThrough(path: string, plugins?: WorkboxPlugin[]) {
    const strategy = createCacheFirstStrategy({
      cacheName: "assets",
      plugins,
    })
    const event = new TestFetchEvent(browserRequest(path))
    const response = await strategy.handle({
      request: event.request,
      event: event as unknown as FetchEvent,
    })
    await event.settled()
    return response
  }

  it("caches a 200 the network returned", async () => {
    sw.fetch.mockResolvedValue(new Response("logo", { status: 200 }))
    const response = await fetchThrough("/img/logo.png")
    expect(response.status).toBe(200)
    expect(sw.caches.urlsIn("assets")).toEqual([`${ORIGIN}/img/logo.png`])
  })

  it("still hands a 500 to the page but does not cache it", async () => {
    sw.fetch.mockResolvedValue(new Response("down", { status: 500 }))
    const response = await fetchThrough("/img/logo.png")
    expect(response.status).toBe(500)
    expect(sw.caches.urlsIn("assets")).toEqual([])
  })

  it("still hands a 404 to the page but does not cache it", async () => {
    sw.fetch.mockResolvedValue(new Response("gone", { status: 404 }))
    const response = await fetchThrough("/img/missing.png")
    expect(response.status).toBe(404)
    expect(sw.caches.urlsIn("assets")).toEqual([])
  })

  it("does not cache an opaque response", async () => {
    sw.fetch.mockResolvedValue(opaqueResponse())
    await fetchThrough("/img/logo.png")
    expect(sw.caches.urlsIn("assets")).toEqual([])
  })

  it("runs before an app's own plugin, so that plugin never sees a 500", async () => {
    //Workbox only applies its own 200-only default when NO plugin defines
    //`cacheWillUpdate`; an app plugin that does would otherwise switch it off
    const keepEverything = vi.fn(
      async ({ response }: { response: Response }) => response,
    )
    sw.fetch.mockResolvedValue(new Response("down", { status: 500 }))
    await fetchThrough("/img/logo.png", [
      { cacheWillUpdate: keepEverything },
    ])
    expect(keepEverything).not.toHaveBeenCalled()
    expect(sw.caches.urlsIn("assets")).toEqual([])
  })
})

/// <reference lib="webworker" />

import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { executeQuotaErrorCallbacks } from "workbox-core/_private/executeQuotaErrorCallbacks.js"
import { ExpirationPlugin } from "workbox-expiration"
import { createExpirationPlugins } from "#adaptv/sw/sw.expiration"
import { createCacheFirstStrategy } from "#adaptv/sw/sw.strategies"
import type { TestServiceWorkerScope } from "#adaptv/sw/sw.test-helper"
import {
  browserRequest,
  installServiceWorkerScope,
  ORIGIN,
  TestFetchEvent,
} from "#adaptv/sw/sw.test-helper"
import type { CacheExpirationOptions } from "#adaptv/sw/sw.types"

/*
 * `createExpirationPlugins` — how long a runtime cache keeps what it stored.
 *
 * Workbox's ExpirationPlugin is the real one, with its IndexedDB timestamp
 * store on `fake-indexeddb`; the strategy is adaptv's own cache-first. So a
 * test reads the cache the way the worker would, not the options object.
 */

let sw: TestServiceWorkerScope
let now: number

beforeEach(() => {
  sw = installServiceWorkerScope()
  sw.fetch.mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url
    return new Response(`body of ${url}`, {
      status: 200,
      headers: { date: new Date(now).toUTCString() },
    })
  })
  //one tick per request, so "oldest" is never a tie on the same millisecond
  now = Date.UTC(2026, 10, 17, 12)
  vi.spyOn(Date, "now").mockImplementation(() => now)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

//each test gets caches the timestamp store has never seen
let caseId = 0
function cacheName(label: string) {
  caseId += 1
  return `${label}-${caseId}`
}

function strategyFor(name: string, expiration: CacheExpirationOptions) {
  return createCacheFirstStrategy({ cacheName: name, expiration })
}

async function request(
  strategy: ReturnType<typeof strategyFor>,
  path: string,
) {
  now += 1000
  const event = new TestFetchEvent(browserRequest(path))
  const response = await strategy.handle({
    request: event.request,
    event: event as unknown as FetchEvent,
  })
  await event.settled()
  return response
}

describe("createExpirationPlugins — when it adds a plugin", () => {
  it("adds none for a permanent cache", () => {
    expect(createExpirationPlugins(undefined)).toEqual([])
  })

  it("adds exactly one ExpirationPlugin when a window is given", () => {
    const plugins = createExpirationPlugins({ maxEntries: 10 })
    expect(plugins).toHaveLength(1)
    expect(plugins[0]).toBeInstanceOf(ExpirationPlugin)
  })
})

describe("createExpirationPlugins — maxEntries", () => {
  it("keeps the newest entries and evicts the oldest past the limit", async () => {
    const name = cacheName("images")
    const strategy = strategyFor(name, { maxEntries: 2 })
    await request(strategy, "/img/a.png")
    await request(strategy, "/img/b.png")
    await request(strategy, "/img/c.png")
    expect(sw.caches.urlsIn(name).sort()).toEqual([
      `${ORIGIN}/img/b.png`,
      `${ORIGIN}/img/c.png`,
    ])
  })

  it("counts a cache hit as use, so a re-read entry outlives a newer one", async () => {
    const name = cacheName("images")
    const strategy = strategyFor(name, { maxEntries: 2 })
    await request(strategy, "/img/a.png")
    await request(strategy, "/img/b.png")
    await request(strategy, "/img/a.png") //served from cache, timestamp bumped
    await request(strategy, "/img/c.png")
    expect(sw.caches.urlsIn(name).sort()).toEqual([
      `${ORIGIN}/img/a.png`,
      `${ORIGIN}/img/c.png`,
    ])
  })

  it("applies per cache — one cache's limit never evicts from another", async () => {
    const small = cacheName("thumbs")
    const large = cacheName("photos")
    const thumbs = strategyFor(small, { maxEntries: 1 })
    const photos = strategyFor(large, { maxEntries: 3 })
    for (const path of ["/t/1", "/t/2", "/t/3"]) {
      await request(thumbs, path)
    }
    for (const path of ["/p/1", "/p/2", "/p/3"]) {
      await request(photos, path)
    }
    expect(sw.caches.urlsIn(small)).toEqual([`${ORIGIN}/t/3`])
    expect(sw.caches.urlsIn(large).sort()).toEqual([
      `${ORIGIN}/p/1`,
      `${ORIGIN}/p/2`,
      `${ORIGIN}/p/3`,
    ])
  })
})

describe("createExpirationPlugins — maxAgeSeconds", () => {
  it("serves a cached entry while it is younger than the limit", async () => {
    const name = cacheName("feed")
    const strategy = strategyFor(name, { maxAgeSeconds: 60 })
    const first = await request(strategy, "/feed.json")
    sw.fetch.mockClear()
    now += 30_000
    const second = await request(strategy, "/feed.json")
    expect(sw.fetch).not.toHaveBeenCalled()
    expect(await second.text()).toBe(await first.text())
  })

  it("goes back to the network once the entry is older than the limit", async () => {
    const name = cacheName("feed")
    const strategy = strategyFor(name, { maxAgeSeconds: 60 })
    await request(strategy, "/feed.json")
    sw.fetch.mockClear()
    now += 120_000
    await request(strategy, "/feed.json")
    expect(sw.fetch).toHaveBeenCalledTimes(1)
  })

  it("deletes expired entries from the cache, not only skips them", async () => {
    const name = cacheName("feed")
    const strategy = strategyFor(name, { maxAgeSeconds: 60 })
    await request(strategy, "/old.json")
    now += 120_000
    await request(strategy, "/new.json")
    expect(sw.caches.urlsIn(name)).toEqual([`${ORIGIN}/new.json`])
  })
})

describe("createExpirationPlugins — purgeOnQuotaError", () => {
  //quota callbacks are process-wide in Workbox, so earlier tests' plugins run
  //too; each test only reads its own cache
  it("defaults on: a quota error drops the whole cache", async () => {
    const name = cacheName("big")
    const strategy = strategyFor(name, { maxEntries: 10 })
    await request(strategy, "/blob/1")
    expect(sw.caches.urlsIn(name)).toHaveLength(1)
    await executeQuotaErrorCallbacks()
    expect(await sw.caches.has(name)).toBe(false)
  })

  it("can be turned off, and then the cache survives a quota error", async () => {
    const name = cacheName("keep")
    const strategy = strategyFor(name, {
      maxEntries: 10,
      purgeOnQuotaError: false,
    })
    await request(strategy, "/blob/1")
    await executeQuotaErrorCallbacks()
    expect(sw.caches.urlsIn(name)).toEqual([`${ORIGIN}/blob/1`])
  })
})

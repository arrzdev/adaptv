/// <reference lib="webworker" />

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TestServiceWorkerScope } from "#adaptv/sw/sw.test-helper"
import {
  browserRequest,
  installServiceWorkerScope,
  ORIGIN,
  TestExtendableEvent,
  TestFetchEvent,
} from "#adaptv/sw/sw.test-helper"
import type { PrecacheManifestEntry } from "#adaptv/sw/sw.types"

/*
 * `setupPrecache` — the build manifest the worker installs before it takes over,
 * and the sweep of what an older worker precached.
 *
 * Workbox's precaching is the real one, end to end: its controller, its default
 * router's fetch listener and its activate-time cleanup. They are singletons
 * that read the scope at import time (the precache cache name ends in
 * `registration.scope`), so every test stubs the scope first and then imports
 * fresh modules.
 */

const SCOPE = `${ORIGIN}/`
const PRECACHE = `workbox-precache-v2-${SCOPE}`

let sw: TestServiceWorkerScope

beforeEach(() => {
  vi.resetModules()
  sw = installServiceWorkerScope()
  vi.stubGlobal("registration", sw.scope.registration)
  sw.fetch.mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url
    return new Response(`network: ${new URL(url).pathname}`, {
      status: 200,
    })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function setup(manifest: PrecacheManifestEntry[]) {
  const { setupPrecache } = await import("#adaptv/sw/sw.precache")
  setupPrecache(manifest)
}

async function install() {
  const event = sw.dispatch(new TestExtendableEvent("install"))
  await event.settled()
}

async function activate() {
  const event = sw.dispatch(new TestExtendableEvent("activate"))
  await event.settled()
}

/** Dispatch a fetch the way the browser does and read what the worker answered. */
async function navigateFetch(path: string) {
  const event = new TestFetchEvent(browserRequest(path))
  let answered: Promise<Response> | undefined
  Object.defineProperty(event, "respondWith", {
    value: (response: Promise<Response>) => {
      answered = response
    },
  })
  sw.dispatch(event)
  return answered && (await answered)
}

const MANIFEST: PrecacheManifestEntry[] = [
  { url: "/index.html", revision: "rev-1" },
  { url: "/assets/app.4f2a9c.js", revision: null },
]

describe("setupPrecache — registration", () => {
  it("listens for install, activate and fetch", async () => {
    await setup(MANIFEST)
    expect(sw.listenerCount("install")).toBe(1)
    expect(sw.listenerCount("fetch")).toBe(1)
    //one from the precache controller, one from cleanupOutdatedCaches
    expect(sw.listenerCount("activate")).toBe(2)
  })

  it("does not keep a reference to the caller's manifest array", async () => {
    const manifest = [...MANIFEST]
    await setup(manifest)
    manifest.push({ url: "/late.html", revision: "x" })
    await install()
    expect(sw.caches.urlsIn(PRECACHE)).not.toContain(
      expect.stringContaining("late.html"),
    )
  })
})

describe("setupPrecache — install", () => {
  it("stores every manifest entry, keyed by its revision", async () => {
    await setup(MANIFEST)
    await install()
    expect(sw.caches.urlsIn(PRECACHE).sort()).toEqual([
      `${ORIGIN}/assets/app.4f2a9c.js`,
      `${ORIGIN}/index.html?__WB_REVISION__=rev-1`,
    ])
  })

  it("fails the install when an entry cannot be fetched", async () => {
    //a worker that activated with half its shell would serve a broken app
    //offline; the browser keeps the old worker instead
    sw.fetch.mockImplementation(async (input) => {
      const url =
        typeof input === "string" ? input : (input as Request).url
      return url.includes("app.4f2a9c")
        ? new Response("missing", { status: 404 })
        : new Response("ok", { status: 200 })
    })
    await setup(MANIFEST)
    const event = sw.dispatch(new TestExtendableEvent("install"))
    const results = await Promise.allSettled(event.pending)
    expect(results.some((r) => r.status === "rejected")).toBe(true)
  })
})

describe("setupPrecache — serving", () => {
  it("answers a precached URL from the precache, without the network", async () => {
    await setup(MANIFEST)
    await install()
    await activate()
    sw.fetch.mockClear()
    const response = await navigateFetch("/index.html")
    expect(response?.status).toBe(200)
    expect(await response?.text()).toBe("network: /index.html")
    expect(sw.fetch).not.toHaveBeenCalled()
  })

  it("leaves a URL outside the manifest to the browser", async () => {
    await setup(MANIFEST)
    await install()
    await activate()
    expect(await navigateFetch("/not-precached.json")).toBeUndefined()
  })
})

describe("setupPrecache — cleanup", () => {
  it("drops an entry whose revision changed, keeping only the new one", async () => {
    sw.caches.seed(
      PRECACHE,
      "/index.html?__WB_REVISION__=rev-0",
      new Response("old shell"),
    )
    await setup(MANIFEST)
    await install()
    await activate()
    const urls = sw.caches.urlsIn(PRECACHE)
    expect(urls).toContain(`${ORIGIN}/index.html?__WB_REVISION__=rev-1`)
    expect(urls).not.toContain(
      `${ORIGIN}/index.html?__WB_REVISION__=rev-0`,
    )
  })

  it("drops an entry the new manifest no longer lists", async () => {
    sw.caches.seed(PRECACHE, "/assets/app.0ld000.js", new Response("old"))
    await setup(MANIFEST)
    await install()
    await activate()
    expect(sw.caches.urlsIn(PRECACHE)).not.toContain(
      `${ORIGIN}/assets/app.0ld000.js`,
    )
  })

  it("deletes a precache left by an older Workbox format on activate", async () => {
    const v1 = `workbox-precache-${SCOPE}`
    sw.caches.seed(v1, "/index.html", new Response("v1 shell"))
    await setup(MANIFEST)
    await install()
    await activate()
    expect(await sw.caches.has(v1)).toBe(false)
    expect(await sw.caches.has(PRECACHE)).toBe(true)
  })

  it("leaves runtime caches alone", async () => {
    const runtime = "static-myapp-2f9c1a"
    sw.caches.seed(runtime, "/img/a.png", new Response("a"))
    await setup(MANIFEST)
    await install()
    await activate()
    expect(await sw.caches.has(runtime)).toBe(true)
  })

  it("leaves the precache of an app under a nested scope alone", async () => {
    //Cache Storage is shared by every worker on the origin: a user site at `/`
    //and a project site at `/docs/` on the same GitHub Pages host both have
    //one. The root worker's scope is a substring of the nested one's precache
    //name, so a substring match deletes that app's offline shell.
    const nested = `workbox-precache-v2-${ORIGIN}/docs/`
    const nestedV1 = `workbox-precache-${ORIGIN}/docs/`
    sw.caches.seed(nested, "/docs/index.html", new Response("docs shell"))
    sw.caches.seed(nestedV1, "/docs/index.html", new Response("docs v1"))
    await setup(MANIFEST)
    await install()
    await activate()
    expect(await sw.caches.has(nested)).toBe(true)
    expect(await sw.caches.has(nestedV1)).toBe(true)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  applyNavigationPreload,
  registerNavigationPreload,
  registerServiceWorkerLifecycle,
  sweepStaleRuntimeCaches,
} from "#adaptv/sw/sw.lifecycle"
import type { TestServiceWorkerScope } from "#adaptv/sw/sw.test-helper"
import {
  installServiceWorkerScope,
  TestExtendableEvent,
  TestExtendableMessageEvent,
} from "#adaptv/sw/sw.test-helper"

const TAG = "myapp-2f9c1a"

function stubCaches(names: string[]) {
  const deleted: string[] = []
  vi.stubGlobal("caches", {
    keys: () => Promise.resolve(names),
    delete: (name: string) => {
      deleted.push(name)
      return Promise.resolve(true)
    },
  })
  return deleted
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("sweepStaleRuntimeCaches — B2", () => {
  it("deletes previous builds' runtime caches", () => {
    const deleted = stubCaches([
      `static-${TAG}`,
      "static-myapp-old111",
      "pages-myapp-old111",
    ])
    return sweepStaleRuntimeCaches(TAG, "/").then(() => {
      expect(deleted.sort()).toEqual([
        "pages-myapp-old111",
        "static-myapp-old111",
      ])
    })
  })

  it("leaves the current build and foreign caches alone", async () => {
    const deleted = stubCaches([
      `static-${TAG}`,
      "workbox-precache-v2-https://example.com/",
      "some-other-app",
    ])
    await sweepStaleRuntimeCaches(TAG, "/")
    expect(deleted).toEqual([])
  })

  it("under a subpath base, leaves the root app's and other bases' buckets alone", async () => {
    const deleted = stubCaches([
      `/app/static-${TAG}`,
      "/app/static-myapp-old111",
      "static-myapp-old111",
      "/other/static-other-old111",
    ])
    await sweepStaleRuntimeCaches(TAG, "/app/")
    expect(deleted).toEqual(["/app/static-myapp-old111"])
  })

  it("never rejects — a failed sweep must not break activation", async () => {
    //this runs inside event.waitUntil(); a rejection there can leave the worker
    //stuck and the app unbootable. Losing a sweep is survivable; losing activate
    //is not.
    vi.stubGlobal("caches", {
      keys: () => Promise.reject(new Error("storage unavailable")),
      delete: () => Promise.resolve(true),
    })
    await expect(
      sweepStaleRuntimeCaches(TAG, "/"),
    ).resolves.toBeUndefined()
  })

  it("survives an individual delete failing", async () => {
    vi.stubGlobal("caches", {
      keys: () => Promise.resolve(["static-old", "pages-old"]),
      delete: () => Promise.reject(new Error("locked")),
    })
    await expect(
      sweepStaleRuntimeCaches(TAG, "/"),
    ).resolves.toBeUndefined()
  })

  it("is a no-op where CacheStorage is absent", async () => {
    vi.stubGlobal("caches", undefined)
    await expect(
      sweepStaleRuntimeCaches(TAG, "/"),
    ).resolves.toBeUndefined()
  })
})

/** Stand in for `self`, recording what the preload API was asked to do. */
function stubScope(navigationPreload?: Record<string, unknown>) {
  const listeners: Array<(event: ExtendableEvent) => void> = []
  vi.stubGlobal("self", {
    registration: navigationPreload ? { navigationPreload } : {},
    addEventListener: (type: string, listener: () => void) => {
      if (type === "activate") listeners.push(listener)
    },
  })
  return listeners
}

function preloadSpy() {
  return { enable: vi.fn(async () => {}), disable: vi.fn(async () => {}) }
}

describe("applyNavigationPreload", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("turns preload on", async () => {
    const preload = preloadSpy()
    stubScope(preload)
    await expect(applyNavigationPreload(true)).resolves.toBe(true)
    expect(preload.enable).toHaveBeenCalledOnce()
    expect(preload.disable).not.toHaveBeenCalled()
  })

  it("actively turns preload OFF rather than just skipping it", async () => {
    //the enabled flag lives on the REGISTRATION and survives every worker
    //update, so an app that switches `render` from ssr to spa would otherwise
    //keep preloading a document its new worker never reads — one wasted request
    //per navigation, plus a cancellation warning on each one
    const preload = preloadSpy()
    stubScope(preload)
    await expect(applyNavigationPreload(false)).resolves.toBe(false)
    expect(preload.disable).toHaveBeenCalledOnce()
    expect(preload.enable).not.toHaveBeenCalled()
  })

  it("reports false where the browser has no preload", async () => {
    //Safari only shipped it in 17.4 — the navigation handler must still work
    stubScope(undefined)
    await expect(applyNavigationPreload(true)).resolves.toBe(false)
  })

  it("never rejects — this runs inside activate's waitUntil", async () => {
    //a rejection here can leave the worker stuck and the app unbootable, and
    //preload is an optimisation while activation is not
    stubScope({
      enable: () => Promise.reject(new Error("not allowed")),
      disable: () => Promise.reject(new Error("not allowed")),
    })
    await expect(applyNavigationPreload(true)).resolves.toBe(false)
    await expect(applyNavigationPreload(false)).resolves.toBe(false)
  })
})

describe("registerNavigationPreload", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("applies the decision on activate, inside waitUntil", async () => {
    const preload = preloadSpy()
    const listeners = stubScope(preload)
    registerNavigationPreload(true)
    expect(listeners).toHaveLength(1)

    const waited: Promise<unknown>[] = []
    listeners[0]({
      waitUntil: (work: Promise<unknown>) => waited.push(work),
    } as unknown as ExtendableEvent)

    //not waitUntil'd, activation can finish before preload is on — and the first
    //navigation, the cold one this exists for, gets no preload at all
    expect(waited).toHaveLength(1)
    await waited[0]
    expect(preload.enable).toHaveBeenCalledOnce()
  })
})

describe("registerServiceWorkerLifecycle — what adaptv's worker wires", () => {
  let sw: TestServiceWorkerScope

  beforeEach(() => {
    sw = installServiceWorkerScope()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function activate() {
    const event = sw.dispatch(new TestExtendableEvent("activate"))
    await event.settled()
    return event
  }

  it("applies a waiting worker when the shell posts SKIP_WAITING", () => {
    //the cold-launch apply path: boot → SKIP_WAITING → controllerchange →
    //reload. Without this listener the worker waits forever. → rendering §3.4
    registerServiceWorkerLifecycle()
    sw.dispatch(new TestExtendableMessageEvent({ type: "SKIP_WAITING" }))
    expect(sw.scope.skipWaiting).toHaveBeenCalledOnce()
  })

  it("does not apply on any other message", () => {
    //a worker that skips waiting mid-session prunes the open tab's module
    //graph; only the shell's cold-launch message may do it
    registerServiceWorkerLifecycle()
    for (const data of [
      null,
      undefined,
      "SKIP_WAITING",
      { type: "skip_waiting" },
      { type: "GET_VERSION" },
      { kind: "SKIP_WAITING" },
    ]) {
      sw.dispatch(new TestExtendableMessageEvent(data))
    }
    expect(sw.scope.skipWaiting).not.toHaveBeenCalled()
  })

  it("claims clients on activate, inside waitUntil", async () => {
    registerServiceWorkerLifecycle()
    const event = await activate()
    expect(sw.scope.clients.claim).toHaveBeenCalledOnce()
    //not waitUntil'd, the activate can finish before the claim lands and the
    //first page load stays uncontrolled
    expect(event.pending).toHaveLength(1)
  })

  it("sweeps previous builds' buckets on activate — B2, and only those", async () => {
    const current = "myapp-2f9c1a"
    const ok = () => new Response("x")
    for (const name of [
      `static-${current}`,
      "static-myapp-0000aa",
      "pages-myapp-0000aa",
      "documents-myapp-0000aa",
      "workbox-precache-v2-https://app.example/",
      "app-api-cache",
      "some-other-app-cache",
    ]) {
      sw.caches.seed(name, "/x", ok())
    }

    registerServiceWorkerLifecycle({ buildTag: current, base: "/" })
    await activate()

    expect((await sw.caches.keys()).sort()).toEqual([
      "app-api-cache",
      "some-other-app-cache",
      `static-${current}`,
      "workbox-precache-v2-https://app.example/",
    ])
  })

  it("holds activate open until the sweep has finished", async () => {
    //the sweep is async; outside waitUntil the browser may stop the worker
    //with half the stale buckets still on disk
    sw.caches.seed("static-old", "/x", new Response("x"))
    registerServiceWorkerLifecycle({ buildTag: "new", base: "/" })
    const event = sw.dispatch(new TestExtendableEvent("activate"))
    expect(event.pending).toHaveLength(2)
    await event.settled()
    expect(await sw.caches.has("static-old")).toBe(false)
  })

  it("does not sweep at all without a build tag", async () => {
    //nothing to compare against: sweeping would delete everything or nothing
    const keys = vi.spyOn(sw.caches, "keys")
    sw.caches.seed("static-old", "/x", new Response("x"))
    registerServiceWorkerLifecycle({})
    await activate()
    expect(keys).not.toHaveBeenCalled()
    expect(await sw.caches.has("static-old")).toBe(true)
  })

  it("honours turning claim and skip-waiting off", async () => {
    registerServiceWorkerLifecycle({
      claimClients: false,
      skipWaitingOnMessage: false,
    })
    expect(sw.listenerCount("activate")).toBe(0)
    expect(sw.listenerCount("message")).toBe(0)
    sw.dispatch(new TestExtendableMessageEvent({ type: "SKIP_WAITING" }))
    await activate()
    expect(sw.scope.skipWaiting).not.toHaveBeenCalled()
    expect(sw.scope.clients.claim).not.toHaveBeenCalled()
  })

  it("wires exactly what default-worker.ts asks for", () => {
    //`{ claimClients: true, skipWaitingOnMessage: true, buildTag, base }`: one
    //message listener, two activate listeners (claim + sweep)
    registerServiceWorkerLifecycle({
      claimClients: true,
      skipWaitingOnMessage: true,
      buildTag: "myapp-2f9c1a",
      base: "/",
    })
    expect(sw.listenerCount("message")).toBe(1)
    expect(sw.listenerCount("activate")).toBe(2)
  })
})

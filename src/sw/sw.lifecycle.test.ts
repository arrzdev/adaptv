import { afterEach, describe, expect, it, vi } from "vitest"
import {
  applyNavigationPreload,
  registerNavigationPreload,
  sweepStaleRuntimeCaches,
} from "#adaptv/sw/sw.lifecycle"

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
    return sweepStaleRuntimeCaches(TAG).then(() => {
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
    await sweepStaleRuntimeCaches(TAG)
    expect(deleted).toEqual([])
  })

  it("never rejects — a failed sweep must not break activation", async () => {
    //this runs inside event.waitUntil(); a rejection there can leave the worker
    //stuck and the app unbootable. Losing a sweep is survivable; losing activate
    //is not.
    vi.stubGlobal("caches", {
      keys: () => Promise.reject(new Error("storage unavailable")),
      delete: () => Promise.resolve(true),
    })
    await expect(sweepStaleRuntimeCaches(TAG)).resolves.toBeUndefined()
  })

  it("survives an individual delete failing", async () => {
    vi.stubGlobal("caches", {
      keys: () => Promise.resolve(["static-old", "pages-old"]),
      delete: () => Promise.reject(new Error("locked")),
    })
    await expect(sweepStaleRuntimeCaches(TAG)).resolves.toBeUndefined()
  })

  it("is a no-op where CacheStorage is absent", async () => {
    vi.stubGlobal("caches", undefined)
    await expect(sweepStaleRuntimeCaches(TAG)).resolves.toBeUndefined()
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

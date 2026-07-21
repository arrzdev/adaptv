import { afterEach, describe, expect, it, vi } from "vitest"
import { sweepStaleRuntimeCaches } from "#nativ/sw/sw.lifecycle"

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

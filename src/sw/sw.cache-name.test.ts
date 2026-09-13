import { describe, expect, it } from "vitest"
import { createCacheName } from "#adaptv/sw/sw.cache-name"
import {
  isStaleRuntimeCache,
  selectStaleCaches,
} from "#adaptv/sw/sw.navigation-policy"

const TAG = "myapp-2f9c1a"
const PREVIOUS = "myapp-0000aa"

describe("createCacheName — the name the B2 sweep has to recognise", () => {
  it("is `<bucket>-<buildTag>`", () => {
    expect(createCacheName(TAG, "static", "/")).toBe(`static-${TAG}`)
  })

  it("mints a new bucket for every build", () => {
    //the rotation IS the invalidation for unhashed files on the CacheFirst
    //asset route — `docs/design/rendering.md §3.3`
    expect(createCacheName(TAG, "static", "/")).not.toBe(
      createCacheName(PREVIOUS, "static", "/"),
    )
  })

  it("names buckets the activate sweep reads back — previous build out, current kept", () => {
    //The name is written in one file and parsed in another. If the two ever
    //disagree on the shape, the sweep silently matches nothing and every deploy
    //leaks a full bucket again: register B2, back with no error anywhere.
    for (const bucket of ["static", "pages", "documents"]) {
      expect(
        isStaleRuntimeCache(
          createCacheName(PREVIOUS, bucket, "/"),
          TAG,
          "/",
        ),
      ).toBe(true)
      expect(
        isStaleRuntimeCache(createCacheName(TAG, bucket, "/"), TAG, "/"),
      ).toBe(false)
    }
  })

  it("keeps a build tag that itself contains dashes intact", () => {
    //build tags are `<app>-<hash>`, and an app name can carry dashes of its
    //own; the bucket is everything before the FIRST dash, the tag all after it
    const current = "my-todo-app-2f9c1a"
    const names = [
      createCacheName(current, "static", "/"),
      createCacheName("my-todo-app-0000aa", "static", "/"),
    ]
    expect(selectStaleCaches(names, current, "/")).toEqual([
      "static-my-todo-app-0000aa",
    ])
  })

  it("keeps the root name unchanged and puts a subpath base in front", () => {
    //Cache Storage is per origin, not per scope: two project sites on one
    //github.io origin read each other's cache names
    expect(createCacheName(TAG, "static", "/")).toBe(`static-${TAG}`)
    expect(createCacheName(TAG, "static", "/app/")).toBe(
      `/app/static-${TAG}`,
    )
    //the base's own slashes are not load-bearing
    expect(createCacheName(TAG, "static", "/app")).toBe(
      `/app/static-${TAG}`,
    )
  })

  it("lets each app on the origin sweep only its own previous builds", () => {
    const names = [
      createCacheName(TAG, "static", "/"),
      createCacheName(PREVIOUS, "static", "/"),
      createCacheName(TAG, "static", "/a/"),
      createCacheName(PREVIOUS, "static", "/a/"),
      createCacheName("other-0000bb", "static", "/b/"),
      createCacheName(PREVIOUS, "static", "/a/b/"),
    ]
    expect(selectStaleCaches(names, TAG, "/a/")).toEqual([
      `/a/static-${PREVIOUS}`,
    ])
    //`/b/` deploys a build `/a/` has never heard of: still `/b/`'s to sweep
    expect(selectStaleCaches(names, "other-1111cc", "/b/")).toEqual([
      "/b/static-other-0000bb",
    ])
    //a root app treats every name that starts with the base as foreign
    expect(selectStaleCaches(names, TAG, "/")).toEqual([
      `static-${PREVIOUS}`,
    ])
  })
})

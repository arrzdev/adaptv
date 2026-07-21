import { describe, expect, it } from "vitest"
import {
  isStaleRuntimeCache,
  resolveNavigationPolicy,
  selectStaleCaches,
} from "#nativ/sw/sw.navigation-policy"

describe("resolveNavigationPolicy — a pure function of render mode", () => {
  //RENDERING §3.1. The whole point of making this a *function* is that the SW
  //never guesses: the same config that produced the build decides how navigation
  //is served, so the two can't drift.
  it("serves SSR from the network, with the shell only as a fallback", () => {
    //Caching SSR documents is a cross-user data leak (§3.2) AND it silently turns
    //an SSR app into a stale SPA for every returning visitor. NetworkOnly keeps
    //the per-request render on every online navigation.
    const policy = resolveNavigationPolicy("ssr")
    expect(policy.kind).toBe("network-only-with-shell-fallback")
    expect(policy.cachesDocuments).toBe(false)
  })

  it("serves SPA from the app shell — there is no render to preserve", () => {
    const policy = resolveNavigationPolicy("spa")
    expect(policy.kind).toBe("app-shell")
    expect(policy.cachesDocuments).toBe(false)
  })

  it("registers no service worker at all on capacitor", () => {
    //§3.5: impossible on iOS (custom scheme), silently inconsistent on Android,
    //pointless (bundle is on-disk), and actively hostile to OTA.
    const policy = resolveNavigationPolicy("capacitor")
    expect(policy.kind).toBe("none")
  })

  it("never caches documents in any mode — that is the invariant", () => {
    //stated as its own test because it is the property that matters, and it must
    //survive anyone adding a fourth mode
    for (const mode of ["ssr", "spa", "capacitor"] as const) {
      expect(resolveNavigationPolicy(mode).cachesDocuments).toBe(false)
    }
  })
})

describe("isStaleRuntimeCache — B2, unbounded cache growth", () => {
  //Runtime buckets are namespaced `<bucket>-<buildTag>`, so every deploy mints
  //new ones. Only cleanupOutdatedCaches() ran, and that purges PRECACHES only —
  //so every prior deploy's runtime caches accumulated forever.
  const TAG = "myapp-2f9c1a"

  it("marks a previous build's runtime cache as stale", () => {
    expect(isStaleRuntimeCache("static-myapp-0000aa", TAG)).toBe(true)
    expect(isStaleRuntimeCache("pages-myapp-0000aa", TAG)).toBe(true)
  })

  it("keeps the current build's caches", () => {
    expect(isStaleRuntimeCache(`static-${TAG}`, TAG)).toBe(false)
    expect(isStaleRuntimeCache(`documents-${TAG}`, TAG)).toBe(false)
  })

  it("never touches a cache it does not own", () => {
    //deleting a foreign cache would break whatever created it — another app on
    //the same origin, a third-party SW, or Workbox's own precache bookkeeping
    expect(
      isStaleRuntimeCache("workbox-precache-v2-https://x/", TAG),
    ).toBe(false)
    expect(isStaleRuntimeCache("some-other-app-cache", TAG)).toBe(false)
    expect(isStaleRuntimeCache("google-fonts", TAG)).toBe(false)
  })

  it("requires the bucket separator, not a bare prefix match", () => {
    //`staticky-<tag>` is not a `static` bucket
    expect(isStaleRuntimeCache("staticky-myapp-0000aa", TAG)).toBe(false)
  })
})

describe("selectStaleCaches", () => {
  const TAG = "myapp-2f9c1a"

  it("selects exactly the stale nativ buckets from a real cache list", () => {
    const names = [
      `static-${TAG}`,
      "static-myapp-old111",
      `documents-${TAG}`,
      "documents-myapp-old111",
      "pages-myapp-ancient",
      "workbox-precache-v2-https://example.com/",
      "unrelated-third-party",
    ]
    expect(selectStaleCaches(names, TAG).sort()).toEqual([
      "documents-myapp-old111",
      "pages-myapp-ancient",
      "static-myapp-old111",
    ])
  })

  it("selects nothing on a first deploy", () => {
    expect(selectStaleCaches([`static-${TAG}`], TAG)).toEqual([])
  })
})

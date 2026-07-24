import { describe, expect, it } from "vitest"
import {
  createCacheFirstStrategy,
  createHashedAssetStrategy,
  createNetworkFirstStrategy,
} from "#adaptv/sw/sw.strategies"

/** Workbox stores the options we care about on the strategy instance. */
function matchOptionsOf(strategy: unknown): Record<string, unknown> {
  return (
    (strategy as { matchOptions?: Record<string, unknown> })
      .matchOptions ?? {}
  )
}

describe("ignoreVary is per-rule, never a global default — B5/B25", () => {
  //The old code forced `ignoreVary: true` on EVERY strategy. On hashed assets
  //that is harmless and useful. On documents it defeats `Vary: Cookie` — the one
  //HTTP mechanism that would partition a per-user response — so user A's
  //server-rendered HTML could be served to user B on the same device.
  //
  //The fix is not to ban it, it is to stop applying it where it is unsafe.
  it("does NOT ignore Vary by default", () => {
    const strategy = createCacheFirstStrategy({ cacheName: "x" })
    expect(matchOptionsOf(strategy).ignoreVary).not.toBe(true)
  })

  it("does not ignore Vary on a network-first strategy either", () => {
    const strategy = createNetworkFirstStrategy({ cacheName: "x" })
    expect(matchOptionsOf(strategy).ignoreVary).not.toBe(true)
  })

  it("DOES ignore Vary for hashed assets, where it is safe and useful", () => {
    //a content-hashed filename IS the version, so response headers cannot make
    //two entries meaningfully different — and honouring Vary here causes
    //redundant misses on Accept-Encoding
    const strategy = createHashedAssetStrategy({ cacheName: "static-x" })
    expect(matchOptionsOf(strategy).ignoreVary).toBe(true)
  })

  it("still lets a caller opt in explicitly", () => {
    const strategy = createCacheFirstStrategy({
      cacheName: "x",
      matchOptions: { ignoreVary: true },
    })
    expect(matchOptionsOf(strategy).ignoreVary).toBe(true)
  })
})

describe("createHashedAssetStrategy", () => {
  it("is cache-first — a content-hashed URL can never be stale", () => {
    //the old code used stale-while-revalidate here, which revalidates every
    //hashed asset on every load: guaranteed-useless network traffic, since a
    //changed file gets a changed filename
    const strategy = createHashedAssetStrategy({ cacheName: "static-x" })
    expect(strategy.constructor.name).toBe("CacheFirst")
  })
})

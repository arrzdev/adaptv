import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createStaticAssetMatcher } from "#adaptv/sw/sw.matchers"
import {
  browserRequest,
  installServiceWorkerScope,
} from "#adaptv/sw/sw.test-helper"

/*
 * The runtime asset route's claim: same-origin GET requests whose destination
 * is a script, style, font or image, plus anything under `/assets/*`.
 * → `docs/design/rendering.md §3.3` ("One runtime asset route, CacheFirst")
 */

function matches(
  path: string,
  init: Parameters<typeof browserRequest>[1] = {},
  options?: Parameters<typeof createStaticAssetMatcher>[0],
): boolean {
  const request = browserRequest(path, init)
  return createStaticAssetMatcher(options)(new URL(request.url), request)
}

beforeEach(() => {
  installServiceWorkerScope()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("createStaticAssetMatcher — what it claims", () => {
  it("claims every asset destination the docs list", () => {
    //icons and fonts are unhashed, and they are on this route on purpose: the
    //bucket rotates per build, so CacheFirst still refetches them per deploy
    expect(matches("/entry.js", { destination: "script" })).toBe(true)
    expect(matches("/styles.css", { destination: "style" })).toBe(true)
    expect(matches("/inter.woff2", { destination: "font" })).toBe(true)
    expect(matches("/icon-192.png", { destination: "image" })).toBe(true)
  })

  it("claims anything under /assets/, whatever its destination", () => {
    //a `fetch()` from app code has an empty destination, and a hashed build
    //asset is still immutable when it is read that way
    expect(matches("/assets/data-4f2a.json")).toBe(true)
    expect(matches("/assets/chunk-9c1b.js", { destination: "" })).toBe(
      true,
    )
  })
})

describe("createStaticAssetMatcher — what it declines", () => {
  it("declines another origin, even for a script", () => {
    //a CDN response is opaque or CORS-governed and not this build's; caching
    //it cache-first under this build's tag would pin a third party's file
    expect(
      matches("https://cdn.example/entry.js", { destination: "script" }),
    ).toBe(false)
    expect(
      matches("https://cdn.example/assets/app-4f2a.js", {
        destination: "script",
      }),
    ).toBe(false)
  })

  it("declines anything that is not a GET", () => {
    for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
      expect(
        matches("/assets/upload", { method, destination: "image" }),
      ).toBe(false)
    }
  })

  it("declines a navigation, even to a path under /assets/", () => {
    //documents are never cached (§3.2); a link to a hashed file is still a
    //document request the browser owns
    expect(matches("/assets/report.pdf", { mode: "navigate" })).toBe(false)
    expect(
      matches("/icon.png", { mode: "navigate", destination: "image" }),
    ).toBe(false)
  })

  it("declines /api/ — API responses are never cached by the worker", () => {
    //"That's the data layer's job, on purpose." (§3.3) — an image served by
    //the API is still an API response
    expect(matches("/api/avatar.png", { destination: "image" })).toBe(
      false,
    )
    expect(matches("/api/assets/x.js", { destination: "script" })).toBe(
      false,
    )
  })

  it("declines what is neither an asset destination nor under /assets/", () => {
    expect(matches("/todos.json")).toBe(false)
    expect(matches("/video.mp4", { destination: "video" })).toBe(false)
    expect(matches("/frame", { destination: "iframe" })).toBe(false)
  })

  it("lets an app ADD excluded prefixes without losing /api/", () => {
    //unlike the navigation route's `denyPathPrefixes`, which replaces its
    //defaults, the asset matcher extends them
    const options = { excludePathPrefixes: ["/uploads/"] }
    expect(
      matches("/uploads/me.png", { destination: "image" }, options),
    ).toBe(false)
    expect(
      matches("/api/avatar.png", { destination: "image" }, options),
    ).toBe(false)
    expect(matches("/icon.png", { destination: "image" }, options)).toBe(
      true,
    )
  })
})

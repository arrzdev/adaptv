import { describe, expect, it } from "vitest"
import type { RouteTint } from "#adaptv/shell/route-tints"
import {
  routeIdToPath,
  routePathToPattern,
  sortRouteTints,
  tintForRouteId,
} from "#adaptv/shell/route-tints"

const tint = (id: string, colour = "#0b6e4f"): RouteTint => ({
  id,
  path: routeIdToPath(id),
  tint: colour,
})

describe("routeIdToPath", () => {
  it("drops pathless layout segments, which are in the id but not the URL", () => {
    //the shape every adaptv app has: an app-wide providers layout that renders
    //no segment of its own. Keeping `_providers` in the pattern would mean the
    //pre-paint script never matched a single route.
    expect(routeIdToPath("/_providers/lab/route-tint")).toBe(
      "/lab/route-tint",
    )
  })

  it("resolves an index route to its parent's path", () => {
    expect(routeIdToPath("/_providers/")).toBe("/")
    expect(routeIdToPath("/")).toBe("/")
  })

  it("drops route groups", () => {
    expect(routeIdToPath("/(marketing)/pricing")).toBe("/pricing")
  })

  it("keeps param segments — matching them is the pattern's job", () => {
    expect(routeIdToPath("/posts/$postId")).toBe("/posts/$postId")
  })
})

describe("routePathToPattern", () => {
  const matches = (path: string, pathname: string) =>
    new RegExp(routePathToPattern(path)).test(pathname)

  it("matches the path, with or without a trailing slash", () => {
    //a cold launch can arrive as either, and they are the same screen
    expect(matches("/settings", "/settings")).toBe(true)
    expect(matches("/settings", "/settings/")).toBe(true)
  })

  it("does not match a longer path that merely starts the same", () => {
    expect(matches("/lab", "/lab/route-tint")).toBe(false)
    expect(matches("/settings", "/settings-old")).toBe(false)
  })

  it("matches the root", () => {
    expect(matches("/", "/")).toBe(true)
    expect(matches("/", "/lab")).toBe(false)
  })

  it("takes one segment for a param and the rest for a splat", () => {
    expect(matches("/posts/$postId", "/posts/17")).toBe(true)
    expect(matches("/posts/$postId", "/posts/17/edit")).toBe(false)
    expect(matches("/files/$", "/files/a/b/c")).toBe(true)
  })

  it("escapes regex metacharacters in a static segment", () => {
    //a route path is not a regex, and a `.` in one must not match any character
    expect(matches("/a.b", "/axb")).toBe(false)
    expect(matches("/a.b", "/a.b")).toBe(true)
  })
})

describe("sortRouteTints", () => {
  it("puts a static route ahead of the parameterised one it would collide with", () => {
    //the script takes the FIRST pattern that matches and stops, so `/posts/new`
    //has to be tried before `/posts/$postId` or it can never win
    const sorted = sortRouteTints([
      tint("/posts/$postId"),
      tint("/posts/new"),
    ])
    expect(sorted.map((t) => t.path)).toEqual([
      "/posts/new",
      "/posts/$postId",
    ])
  })

  it("puts a deeper route ahead of a shallower one", () => {
    const sorted = sortRouteTints([tint("/lab"), tint("/lab/route-tint")])
    expect(sorted.map((t) => t.path)).toEqual(["/lab/route-tint", "/lab"])
  })
})

describe("tintForRouteId", () => {
  const tints = [tint("/_providers/lab/route-tint", "#0b6e4f")]

  it("finds the leaf route's own tint", () => {
    expect(tintForRouteId(tints, "/_providers/lab/route-tint")).toBe(
      "#0b6e4f",
    )
  })

  it("returns null for a route that declares nothing — NOT the parent's tint", () => {
    //the fallback is always the app's global theme colours. A layout that pins
    //the chrome must not drag every child along with it.
    expect(tintForRouteId(tints, "/_providers/lab")).toBeNull()
    expect(tintForRouteId(tints, undefined)).toBeNull()
  })
})

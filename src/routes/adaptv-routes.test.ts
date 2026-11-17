// @vitest-environment node
// The route DSL is a façade over `@tanstack/virtual-file-routes`: the generator
// reads the nodes it returns, so every overload must hand back exactly the node
// upstream's would. The one place adaptv has an opinion is `rootRoute`, which
// supplies the root file itself when the app passes only children.
import * as upstream from "@tanstack/virtual-file-routes"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { RouteNode } from "#adaptv/routes/adaptv-routes.ts"
import {
  index,
  layout,
  physical,
  rootRoute,
  route,
} from "#adaptv/routes/adaptv-routes.ts"

const ROOT_FILE = "../../node_modules/adaptv/src/routes/root-route.tsx"

let saved: string | undefined
beforeEach(() => {
  saved = process.env.ADAPTV_ROOT_ROUTE_FILE
  delete process.env.ADAPTV_ROOT_ROUTE_FILE
})
afterEach(() => {
  if (saved === undefined) delete process.env.ADAPTV_ROOT_ROUTE_FILE
  else process.env.ADAPTV_ROOT_ROUTE_FILE = saved
})

describe("rootRoute", () => {
  it("wires in adaptv's root file when given only children", () => {
    process.env.ADAPTV_ROOT_ROUTE_FILE = ROOT_FILE
    const children = [index("pages/home.tsx")]
    expect(rootRoute(children)).toEqual({
      type: "root",
      file: ROOT_FILE,
      children,
    })
  })

  it("wires in adaptv's root file with no arguments at all", () => {
    process.env.ADAPTV_ROOT_ROUTE_FILE = ROOT_FILE
    expect(rootRoute()).toEqual(upstream.rootRoute(ROOT_FILE))
  })

  it("throws a named error when evaluated outside the Vite plugin", () => {
    expect(() => rootRoute([])).toThrow(/ADAPTV_ROOT_ROUTE_FILE is unset/)
  })

  it("treats an empty variable as unset rather than resolving to ''", () => {
    process.env.ADAPTV_ROOT_ROUTE_FILE = ""
    expect(() => rootRoute([])).toThrow(/ADAPTV_ROOT_ROUTE_FILE is unset/)
  })

  it("uses an ejected root file as given and never reads the variable", () => {
    const children = [index("pages/home.tsx")]
    expect(rootRoute("layouts/_root.tsx", children)).toEqual(
      upstream.rootRoute("layouts/_root.tsx", children),
    )
    expect(rootRoute("layouts/_root.tsx")).toEqual({
      type: "root",
      file: "layouts/_root.tsx",
    })
  })
})

describe("the non-root nodes match upstream's", () => {
  const kids: RouteNode[] = [index("pages/a.tsx")]

  it("index", () => {
    expect(index("pages/home.tsx")).toEqual({
      type: "index",
      file: "pages/home.tsx",
    })
  })

  it("layout(file, children)", () => {
    expect(layout("layouts/app.tsx", kids)).toEqual(
      upstream.layout("layouts/app.tsx", kids),
    )
    expect(layout("layouts/app.tsx", kids)).not.toHaveProperty("id")
  })

  it("layout(id, file, children)", () => {
    expect(layout("app", "layouts/app.tsx", kids)).toEqual({
      type: "layout",
      id: "app",
      file: "layouts/app.tsx",
      children: kids,
    })
  })

  it("layout(id, file) from untyped code gets an empty children list", () => {
    //the overloads require children; a .js route config can still omit them
    const untyped = layout as unknown as (
      id: string,
      file: string,
    ) => RouteNode
    expect(untyped("app", "layouts/app.tsx")).toEqual({
      type: "layout",
      id: "app",
      file: "layouts/app.tsx",
      children: [],
    })
  })

  it("route(path, children) has no file", () => {
    expect(route("/settings", kids)).toEqual(
      upstream.route("/settings", kids),
    )
    expect(route("/settings", kids)).not.toHaveProperty("file")
  })

  it("route(path, file) has no children", () => {
    expect(route("/settings", "pages/settings.tsx")).toEqual({
      type: "route",
      path: "/settings",
      file: "pages/settings.tsx",
    })
  })

  it("route(path, file, children) keeps both, even an empty list", () => {
    expect(route("/s", "pages/s.tsx", kids)).toEqual(
      upstream.route("/s", "pages/s.tsx", kids),
    )
    expect(route("/s", "pages/s.tsx", [])).toEqual({
      type: "route",
      path: "/s",
      file: "pages/s.tsx",
      children: [],
    })
  })

  it("physical(directory) mounts at this level", () => {
    expect(physical("blog")).toEqual({
      type: "physical",
      directory: "blog",
      pathPrefix: "",
    })
  })

  it("physical(prefix, directory) mounts at the prefix", () => {
    expect(physical("/blog", "blog")).toEqual(
      upstream.physical("/blog", "blog"),
    )
    expect(physical("/blog", "blog")).toMatchObject({
      pathPrefix: "/blog",
    })
  })

  it("physical with an empty directory still takes the two-argument form", () => {
    //`maybeDirectory === undefined`, not falsiness, picks the overload
    expect(physical("/blog", "")).toEqual(upstream.physical("/blog", ""))
  })
})

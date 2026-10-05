// @vitest-environment node
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { adaptvTanstackResolvePlugin } from "#adaptv/vite/tanstack-resolve.ts"

/*
 * TanStack's code-splitter writes `@tanstack/react-router` into the app's route
 * modules, and a standalone pnpm app has no TanStack of its own: `adaptv build web`
 * on a created app failed to resolve it. The import has to resolve from adaptv.
 * The end-to-end proof is `packages/create-adaptv/create.test.mjs`, which builds a
 * created app outside this repo.
 */

const APP = path.resolve("/work/my-app")
const ADAPTV = path.resolve("/pkgs/adaptv")

function resolveFrom(source: string, importer: string | undefined) {
  const plugin = adaptvTanstackResolvePlugin(APP, ADAPTV)
  const resolve = vi.fn(async () => ({ id: "/resolved" }))
  const hook = plugin.resolveId as (
    this: unknown,
    source: string,
    importer: string | undefined,
    options: object,
  ) => unknown
  const result = hook.call({ resolve }, source, importer, { ssr: false })
  return { result, resolve }
}

describe("adaptvTanstackResolvePlugin", () => {
  it("resolves a TanStack import in an app route module from adaptv's package", () => {
    const { resolve } = resolveFrom(
      "@tanstack/react-router",
      path.join(
        APP,
        "src/routing/pages/home.page.tsx?tsr-split=component",
      ),
    )
    expect(resolve).toHaveBeenCalledWith(
      "@tanstack/react-router",
      path.join(ADAPTV, "package.json"),
      { ssr: false, skipSelf: true },
    )
  })

  it("leaves packages and adaptv's own source to resolve their own imports", () => {
    for (const importer of [
      path.join(APP, "node_modules/@tanstack/react-start/dist/index.js"),
      path.join(ADAPTV, "src/routes/root-route.tsx"),
      undefined,
    ]) {
      const { result, resolve } = resolveFrom(
        "@tanstack/react-router",
        importer,
      )
      expect(result).toBeNull()
      expect(resolve).not.toHaveBeenCalled()
    }
  })

  it("leaves every other specifier alone", () => {
    const { result } = resolveFrom("react", path.join(APP, "src/app.tsx"))
    expect(result).toBeNull()
  })
})

/*
 * In dev, Vite's SSR import analysis externalizes a bare import before any plugin
 * resolves it, so the split route's `@tanstack/react-router` went to Node from the app,
 * and a standalone pnpm app served a 500. The end-to-end proof is a created app,
 * installed from the tarball outside the repo, running `adaptv dev web`.
 */
describe("adaptvTanstackResolvePlugin in dev", () => {
  function configFor(command: "serve" | "build") {
    const hook = adaptvTanstackResolvePlugin(APP, ADAPTV).config as (
      config: object,
      env: { command: string; mode: string },
    ) => unknown
    return hook({}, { command, mode: "development" })
  }

  it("inlines the router on the server, so the app's import reaches the redirect", () => {
    expect(configFor("serve")).toEqual({
      resolve: { noExternal: ["@tanstack/react-router"] },
    })
  })

  it("leaves a build to the bundler, which resolves through the redirect already", () => {
    expect(configFor("build")).toBeUndefined()
  })
})

/*
 * Start dedupes its packages, and Vite resolves a deduped package from the app root.
 * An app with no TanStack of its own, inside a repo that has one, loaded TanStack and
 * a second React from the repo's `node_modules`, and `adaptv dev web` served a 500.
 * The end-to-end proof is `examples/basic`, run by the README quick start.
 */
describe("adaptvTanstackResolvePlugin dedupe", () => {
  function dedupeAfter(dedupe: string[] | undefined) {
    const hook = adaptvTanstackResolvePlugin(APP, ADAPTV)
      .configEnvironment as {
      order?: string
      handler: (name: string, options: { resolve?: object }) => void
    }
    const options = { resolve: dedupe ? { dedupe } : undefined }
    hook.handler("ssr", options)
    return { order: hook.order, options }
  }

  it("drops Start's TanStack entries after Start has added them", () => {
    const { order, options } = dedupeAfter([
      "react",
      "react-dom",
      "@tanstack/react-start",
      "@tanstack/react-router",
    ])
    expect(order).toBe("post")
    expect(options.resolve).toEqual({ dedupe: ["react", "react-dom"] })
  })

  it("keeps an app's own TanStack entry", () => {
    const { options } = dedupeAfter([
      "react",
      "@tanstack/react-query",
      "@tanstack/react-start",
      "@tanstack/react-router",
    ])
    expect(options.resolve).toEqual({
      dedupe: ["react", "@tanstack/react-query"],
    })
  })

  it("leaves an environment with no dedupe as it was", () => {
    expect(dedupeAfter(undefined).options).toEqual({ resolve: undefined })
  })
})

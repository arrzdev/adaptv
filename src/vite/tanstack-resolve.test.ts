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

  it("leaves an environment with no dedupe as it was", () => {
    expect(dedupeAfter(undefined).options).toEqual({ resolve: undefined })
  })
})

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

// @vitest-environment node
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import { adaptvRootRoutePlugin } from "#adaptv/vite/root-route-module.ts"

const ROOT_ROUTE_ID = "\0virtual:adaptv/root-route"

function resolveWith(id: string, importer: string | undefined) {
  const plugin = adaptvRootRoutePlugin({
    appRoot: "/app",
  } as AdaptvContext)
  const resolve = vi.fn(async () => ({ id: "/app/src/styles/main.css" }))
  const hook = plugin.resolveId as unknown as (
    this: { resolve: typeof resolve },
    id: string,
    importer: string | undefined,
    options: { isEntry: boolean },
  ) => Promise<unknown>
  const result = hook.call({ resolve }, id, importer, { isEntry: false })
  return { result, resolve }
}

describe("adaptv:root-route resolveId", () => {
  it("resolves the root route's imports as the app's config file would", async () => {
    const { result, resolve } = resolveWith(
      "@/styles/main.css?url",
      ROOT_ROUTE_ID,
    )
    expect(await result).toEqual({ id: "/app/src/styles/main.css" })
    expect(resolve).toHaveBeenCalledWith(
      "@/styles/main.css?url",
      path.join("/app", "adaptv.config.ts"),
      expect.objectContaining({ skipSelf: true }),
    )
  })

  it("leaves other importers to Vite", async () => {
    const { result, resolve } = resolveWith("@/x", "/app/src/a.ts")
    expect(await result).toBeNull()
    expect(resolve).not.toHaveBeenCalled()
  })
})

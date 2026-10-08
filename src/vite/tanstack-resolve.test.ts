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
const LAZY = path.join(ADAPTV, "dist/lazy-route-component.mjs")

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
  it("resolves a TanStack import in an app module from adaptv's package", () => {
    const { resolve } = resolveFrom(
      "@tanstack/react-start",
      path.join(APP, "src/app.tsx"),
    )
    expect(resolve).toHaveBeenCalledWith(
      "@tanstack/react-start",
      path.join(ADAPTV, "package.json"),
      { ssr: false, skipSelf: true },
    )
  })

  //react-router 1.170.19 checks the stale-chunk reload key at render time, so the
  //second render of a route whose chunk was gone threw to the error screen while the
  //reload was in flight. The end-to-end proof is `e2e-sw/stale-chunk.spec.ts`.
  it("gives an app route module the router with adaptv's lazyRouteComponent", async () => {
    const { result } = resolveFrom(
      "@tanstack/react-router",
      path.join(
        APP,
        "src/routing/pages/home.page.tsx?tsr-split=component",
      ),
    )
    const id = await result
    expect(id).toBe("\0virtual:adaptv/react-router")

    const plugin = adaptvTanstackResolvePlugin(APP, ADAPTV, LAZY)
    const load = plugin.load as (id: string) => string | null
    expect(load(id as string)).toBe(
      [
        'export * from "@tanstack/react-router"',
        `export { lazyRouteComponent } from ${JSON.stringify(LAZY)}`,
        "",
      ].join("\n"),
    )
  })

  it("resolves that module's own router import from adaptv's package", () => {
    const { resolve } = resolveFrom(
      "@tanstack/react-router",
      "\0virtual:adaptv/react-router",
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
 *
 * A build resolves a bare import from the app root instead. Inside a repo with its own
 * TanStack, the server bundle left the router to Node, which loaded it and
 * `react-dom/server` from the repo, and the prerender of `adaptv build android` in
 * `examples/basic` saw two Reacts. The end-to-end proof is that build, in the checkout.
 *
 * adaptv itself is inlined in both commands: its modules import `virtual:adaptv-*`,
 * which Node refuses, so every app used to carry `ssr.noExternal: ["@arrzdev/adaptv"]`.
 */
describe("adaptvTanstackResolvePlugin noExternal", () => {
  function configFor(command: "serve" | "build") {
    const hook = adaptvTanstackResolvePlugin(APP, ADAPTV).config as (
      config: object,
      env: { command: string; mode: string },
    ) => unknown
    return hook({}, { command, mode: "development" })
  }

  it("inlines adaptv and the router on the server, so the app's import reaches the redirect", () => {
    expect(configFor("serve")).toMatchObject({
      resolve: {
        noExternal: ["@arrzdev/adaptv", "@tanstack/react-router"],
      },
    })
  })

  //Start excludes the router from the optimizer, so its router-core imports were
  //found only when the first page asked for them, and the dev server reloaded that
  //page seconds after it had hydrated. The end-to-end proof is the first stress spec
  //(`stress-app-state.spec.ts`) on a cold server, which lost half its flips to it.
  it("pre-bundles every router-core entry the router imports, from adaptv's own dependencies", () => {
    expect(configFor("serve")).toMatchObject({
      optimizeDeps: {
        include: [
          "@arrzdev/adaptv > @tanstack/react-router > @tanstack/router-core",
          "@arrzdev/adaptv > @tanstack/react-router > @tanstack/router-core/isServer",
          "@arrzdev/adaptv > @tanstack/react-router > @tanstack/router-core/scroll-restoration-script",
        ],
      },
    })
  })

  it("inlines adaptv and TanStack in a build, so the server loads one React", () => {
    expect(configFor("build")).toEqual({
      resolve: { noExternal: ["@arrzdev/adaptv", /^@tanstack\//] },
    })
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

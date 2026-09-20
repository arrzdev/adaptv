import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Plugin, ViteDevServer } from "vite"
import { createServer } from "vite"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { RouteTint } from "#adaptv/shell/route-tints.ts"
import {
  adaptvRouteTintsPlugin,
  ROUTE_TINTS_VIRTUAL_ID,
} from "#adaptv/vite/route-tints-module.ts"

let appRoot: string
let routesDir: string
let server: ViteDevServer | null = null

/** A route file under the routes directory that declares `tint` (or none). */
function route(file: string, id: string, tint?: string) {
  const full = path.join(routesDir, file)
  mkdirSync(path.dirname(full), { recursive: true })
  const option = tint ? `chromeTint: ${JSON.stringify(tint)},` : ""
  writeFileSync(
    full,
    `export const Route = createFileRoute(${JSON.stringify(id)})({ ${option} })\n`,
  )
  return full
}

/** Each saved file as the client environment's plugins after this one saw it. */
let handled: Array<{ file: string; modules: string[] }> = []

/**
 * Runs after the plugin under test, so `save` waits for that plugin to have
 * handled the file instead of guessing how long the watcher takes, and sees the
 * update list the plugin left for Vite. A hook that returns an array replaces
 * that list, and an empty one tells Vite no module needs updating.
 */
const after: Plugin = {
  name: "test:after-route-tints",
  hotUpdate({ file, modules }) {
    if (this.environment.name !== "client") return
    handled.push({ file, modules: modules.map((m) => m.file ?? "") })
  },
}

/** A real dev server running only this plugin — the module graph is Vite's own. */
async function devServer(): Promise<ViteDevServer> {
  server = await createServer({
    root: appRoot,
    configFile: false,
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true, watch: null, ws: false },
    plugins: [adaptvRouteTintsPlugin(routesDir), after],
  })
  return server
}

async function table(dev: ViteDevServer): Promise<RouteTint[]> {
  const mod = await dev.ssrLoadModule(ROUTE_TINTS_VIRTUAL_ID)
  return mod.ROUTE_TINTS as RouteTint[]
}

/**
 * What Vite's own watcher does with a saved file: run every `hotUpdate`. Returns
 * the modules left to update for it once the plugin under test has run.
 */
async function save(dev: ViteDevServer, file: string) {
  handled = []
  dev.watcher.emit("change", file)
  await vi.waitFor(() =>
    expect(handled.map((h) => h.file)).toContain(file),
  )
  return handled.filter((h) => h.file === file).flatMap((h) => h.modules)
}

beforeEach(() => {
  //real path: Vite keys modules by it, and macOS's tmpdir sits behind a symlink
  appRoot = realpathSync(
    mkdtempSync(path.join(tmpdir(), "adaptv-route-tints-")),
  )
  routesDir = path.join(appRoot, "src", "routing")
  mkdirSync(routesDir, { recursive: true })
})

afterEach(async () => {
  try {
    await server?.close()
  } finally {
    server = null
    rmSync(appRoot, { recursive: true, force: true })
    vi.restoreAllMocks()
  }
})

describe("adaptvRouteTintsPlugin", () => {
  it("serves the table scanned from the routes directory", async () => {
    route("settings.page.tsx", "/_p/settings", "#0b6e4f")
    route("home.page.tsx", "/_p/")
    //a tinted route beside the routes directory, not in it, stays out of the table
    const drafts = path.join(
      appRoot,
      "src",
      "routing-drafts",
      "x.page.tsx",
    )
    mkdirSync(path.dirname(drafts), { recursive: true })
    writeFileSync(
      drafts,
      'export const Route = createFileRoute("/_p/x")({ chromeTint: "#ff00ff" })\n',
    )
    const dev = await devServer()
    expect(await table(dev)).toEqual([
      { id: "/_p/settings", path: "/settings", tint: "#0b6e4f" },
    ])
  })

  it("claims only its own id", () => {
    const plugin = adaptvRouteTintsPlugin(routesDir)
    // biome-ignore lint/suspicious/noExplicitAny: calling Vite hooks outside Vite
    const resolveId = plugin.resolveId as any
    // biome-ignore lint/suspicious/noExplicitAny: calling Vite hooks outside Vite
    const load = plugin.load as any
    expect(resolveId.call({}, "react", undefined, {})).toBeNull()
    expect(load.call({}, "/app/src/main.tsx", {})).toBeNull()
    //the table is served under the id resolveId hands back, not the bare one
    expect(load.call({}, ROUTE_TINTS_VIRTUAL_ID, {})).toBeNull()
  })

  it("rescans when a route file is saved, without a restart", async () => {
    //The one reason for the hotUpdate hook: the virtual module depends on no file
    //Vite knows about, so without the invalidation Vite keeps serving the table
    //from the first load, and editing `chromeTint` does nothing until a restart.
    const file = route("settings.page.tsx", "/_p/settings", "#0b6e4f")
    const dev = await devServer()
    expect(await table(dev)).toHaveLength(1)

    //the saved file is a module in its own right, and its own HMR update must
    //still reach Vite after this plugin has invalidated the table
    await dev.environments.client.transformRequest(
      "/src/routing/settings.page.tsx",
    )
    route("settings.page.tsx", "/_p/settings", "#aa0000")
    expect(await save(dev, file)).toEqual([file])
    expect(await table(dev)).toEqual([
      { id: "/_p/settings", path: "/settings", tint: "#aa0000" },
    ])

    const nested = route("lab/tint.page.tsx", "/_p/lab/tint", "#0000aa")
    await save(dev, nested)
    expect((await table(dev)).map((t) => t.tint).sort()).toEqual([
      "#0000aa",
      "#aa0000",
    ])
  })

  it("leaves the table alone for a file outside the routes directory", async () => {
    //`startsWith` on a bare prefix would also match `src/routing-drafts/`
    route("settings.page.tsx", "/_p/settings", "#0b6e4f")
    const dev = await devServer()
    await table(dev)
    const invalidate = vi.spyOn(dev.moduleGraph, "invalidateModule")

    const drafts = path.join(
      appRoot,
      "src",
      "routing-drafts",
      "x.page.tsx",
    )
    mkdirSync(path.dirname(drafts), { recursive: true })
    writeFileSync(drafts, "export {}\n")
    await save(dev, drafts)
    await save(dev, path.join(appRoot, "src", "main.tsx"))
    expect(invalidate).not.toHaveBeenCalled()
  })

  it("does not fail a save that lands before anything loaded the table", async () => {
    //Vite swallows a throwing hook into its log, so this calls it directly
    const file = route("settings.page.tsx", "/_p/settings", "#0b6e4f")
    const dev = await devServer()
    const plugin = dev.config.plugins.find(
      (p) => p.name === "adaptv:route-tints",
    )
    // biome-ignore lint/suspicious/noExplicitAny: calling Vite hooks outside Vite
    const hotUpdate = plugin?.hotUpdate as any
    expect(() => hotUpdate.call({}, { file })).not.toThrow()
    expect(await table(dev)).toHaveLength(1)
  })

  it("ignores a hotUpdate outside a dev server", () => {
    //no configureServer has run, so there is no module graph to invalidate
    const plugin = adaptvRouteTintsPlugin(routesDir)
    // biome-ignore lint/suspicious/noExplicitAny: calling Vite hooks outside Vite
    const hotUpdate = plugin.hotUpdate as any
    expect(() =>
      hotUpdate.call({}, { file: path.join(routesDir, "a.page.tsx") }),
    ).not.toThrow()
  })
})

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import type { Plugin, PluginOption } from "vite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  adaptvRouteConfigWatchPlugin,
  ROUTE_GENERATOR_PLUGIN,
  routeConfigModules,
} from "#adaptv/vite/route-config-watch"

//The generator Start runs in dev, loaded from where Start itself resolves it rather
//than from adaptv's own dependencies (it is not one). Same copy, same patches, same
//jiti — which is the point: the stale read lives in that module cache, not in a fake.
async function loadGeneratorFactory(): Promise<
  (options: Record<string, unknown>) => Plugin
> {
  const fromAdaptv = createRequire(import.meta.url)
  const fromStart = createRequire(
    fromAdaptv.resolve("@tanstack/react-start/package.json"),
  )
  const fromCore = createRequire(
    fromStart.resolve("@tanstack/start-plugin-core/package.json"),
  )
  const pluginDir = path.dirname(
    fromCore.resolve("@tanstack/router-plugin/package.json"),
  )
  const mod = await import(
    pathToFileURL(path.join(pluginDir, "dist/esm/vite.js")).href
  )
  return mod.tanstackRouterGenerator
}

type Hook = (
  id: string,
  change: { event: "create" | "update" | "delete" },
) => void | Promise<void>

/** The route config source: a plain virtual-route object, so the temp app needs no packages. */
function configSource(paths: string[], importFrom?: string): string {
  const children = paths
    .map(
      (p) =>
        `{ type: "route", path: ${JSON.stringify(p)}, file: ${JSON.stringify(`${p.slice(1)}.tsx`)} }`,
    )
    .join(", ")
  if (importFrom)
    return `import { extra } from ${JSON.stringify(importFrom)}\nexport const routes = { type: "root", file: "__root.tsx", children: [${children}, ...extra] }\n`
  return `export const routes = { type: "root", file: "__root.tsx", children: [${children}] }\n`
}

function helperSource(paths: string[]): string {
  return `export const extra = [${paths
    .map(
      (p) =>
        `{ type: "route", path: ${JSON.stringify(p)}, file: ${JSON.stringify(`${p.slice(1)}.tsx`)} }`,
    )
    .join(", ")}]\n`
}

let appRoot: string
let routesDir: string
let treePath: string

const routeFile = (name: string, routePath: string) =>
  writeFileSync(
    path.join(routesDir, `${name}.tsx`),
    `import { createFileRoute } from "@tanstack/react-router"\nexport const Route = createFileRoute(${JSON.stringify(routePath)})({})\n`,
  )

beforeEach(() => {
  appRoot = realpathSync(
    mkdtempSync(path.join(tmpdir(), "adaptv-route-config-")),
  )
  routesDir = path.join(appRoot, "src/routing")
  treePath = path.join(appRoot, ".adaptv/routeTree.gen.ts")
  mkdirSync(routesDir, { recursive: true })
  writeFileSync(
    path.join(routesDir, "__root.tsx"),
    `import { createRootRoute } from "@tanstack/react-router"\nexport const Route = createRootRoute()\n`,
  )
  for (const name of ["a", "b", "c"]) routeFile(name, `/${name}`)
})

afterEach(() => {
  //the cache is process-wide: leave nothing of this app behind for the next case
  const cache = createRequire(import.meta.url).cache
  for (const id of Object.keys(cache))
    if (id.startsWith(appRoot)) delete cache[id]
  rmSync(appRoot, { recursive: true, force: true })
})

/**
 * Boots the real generator for the temp app, and delivers watch events the way
 * Vite's plugin container does: every `watchChange` handler is CALLED in plugin
 * order before any of them is awaited (`hookParallel`). adaptv's plugin sits before
 * Start's, so it is called first — but its eviction is synchronous, so the order is
 * not what the result rests on.
 */
async function boot(routerConfig: string, withAdaptv: boolean) {
  const factory = await loadGeneratorFactory()
  const generator = factory({
    target: "react",
    routesDirectory: routesDir,
    generatedRouteTree: treePath,
    virtualRouteConfig: routerConfig,
    tmpDir: path.join(appRoot, ".adaptv/tmp"),
    disableLogging: true,
  })
  const adaptv = adaptvRouteConfigWatchPlugin({
    routerConfig: path.resolve(appRoot, routerConfig),
    routesDir,
  })
  const plugins: Plugin[] = withAdaptv ? [adaptv, generator] : [generator]
  const resolved = { root: appRoot, plugins }
  for (const plugin of plugins) {
    const hook = plugin.configResolved as
      | ((config: unknown) => unknown)
      | { handler: (config: unknown) => unknown }
      | undefined
    if (typeof hook === "function") await hook.call({}, resolved)
    else if (hook) await hook.handler.call({}, resolved)
  }
  return {
    //the paths the tree declares, as the generator writes them: `path: '/a'`
    routes: () =>
      [...readFileSync(treePath, "utf8").matchAll(/path: '([^']+)'/g)].map(
        (m) => m[1],
      ),
    async change(file: string) {
      const pending = plugins.map((plugin) =>
        (plugin.watchChange as Hook | undefined)?.call({}, file, {
          event: "update",
        }),
      )
      await Promise.all(pending)
    },
  }
}

describe("a running dev server and the route config", () => {
  it("CONTROL: the generator alone keeps serving the config it loaded first", async () => {
    //This is the bug, pinned. When this assertion fails, upstream reads the config
    //fresh on every run and adaptv's plugin can be deleted.
    const config = path.join(routesDir, "config.ts")
    writeFileSync(config, configSource(["/a"]))
    const dev = await boot("./src/routing/config.ts", false)
    expect(dev.routes()).toContain("/a")

    writeFileSync(config, configSource(["/a", "/b"]))
    await dev.change(config)

    expect(dev.routes()).not.toContain("/b")
  })

  it("regenerates when a route is added to the config", async () => {
    const config = path.join(routesDir, "config.ts")
    writeFileSync(config, configSource(["/a"]))
    const dev = await boot("./src/routing/config.ts", true)
    expect(dev.routes()).not.toContain("/b")

    writeFileSync(config, configSource(["/a", "/b"]))
    await dev.change(config)
    expect(dev.routes()).toContain("/b")

    //and again: the fresh load must not become the new stale one
    writeFileSync(config, configSource(["/a", "/b", "/c"]))
    await dev.change(config)
    expect(dev.routes()).toContain("/c")
  })

  it("regenerates when a module the config imports changes", async () => {
    const config = path.join(routesDir, "config.ts")
    const helper = path.join(routesDir, "more.ts")
    writeFileSync(helper, helperSource(["/b"]))
    writeFileSync(config, configSource(["/a"], "./more"))
    const dev = await boot("./src/routing/config.ts", true)
    expect(dev.routes()).toContain("/b")

    writeFileSync(helper, helperSource(["/b", "/c"]))
    await dev.change(helper)
    expect(dev.routes()).toContain("/c")
  })

  it("regenerates for a config that lives outside the routes directory", async () => {
    //`routerConfig` and `routesDirectory` are independent knobs. The generator decides
    //an event is about the config by comparing the absolute watched path with the
    //RELATIVE option it was given, which never matches — so outside the routes folder
    //it drops the event before reading anything, stale or not.
    const config = path.join(appRoot, "src/routes.ts")
    writeFileSync(config, configSource(["/a"]))
    const dev = await boot("./src/routes.ts", true)
    expect(dev.routes()).not.toContain("/b")

    writeFileSync(config, configSource(["/a", "/b"]))
    await dev.change(config)
    expect(dev.routes()).toContain("/b")
  })

  it("recovers from a config that failed to load", async () => {
    const config = path.join(routesDir, "config.ts")
    writeFileSync(config, configSource(["/a"]))
    const dev = await boot("./src/routing/config.ts", true)

    writeFileSync(config, "export const routes = = {}\n")
    await dev.change(config)
    expect(dev.routes()).not.toContain("/b")

    writeFileSync(config, configSource(["/a", "/b"]))
    await dev.change(config)
    expect(dev.routes()).toContain("/b")
  })
})

describe("routeConfigModules", () => {
  it("is the config plus what it imports, never a package", () => {
    const config = "/app/src/routing/config.ts"
    const helper = "/app/src/routing/lab.ts"
    const pkg = "/app/node_modules/zod/index.js"
    const cache = {
      [config]: { children: [{ filename: helper }, { filename: pkg }] },
      [helper]: { children: [{ filename: config }] },
      [pkg]: { children: [] },
    }
    expect([...routeConfigModules(config, cache)].sort()).toEqual(
      [config, helper].sort(),
    )
  })

  it("still names the config when nothing is cached for it", () => {
    expect([...routeConfigModules("/app/src/routes.ts", {})]).toEqual([
      "/app/src/routes.ts",
    ])
  })
})

describe("the plugin adaptv hands the change to", () => {
  //the fallback for a config outside the routes directory finds the generator by
  //name in the resolved plugin list. A rename upstream would make that fallback
  //silently do nothing, so the name is asserted against the real Start plugin list.
  it("exists under that name in Start's plugins", async () => {
    const flat: Plugin[] = []
    const walk = async (option: PluginOption): Promise<void> => {
      const value = await option
      if (Array.isArray(value)) for (const item of value) await walk(item)
      else if (value && typeof value === "object" && "name" in value)
        flat.push(value as Plugin)
    }
    await walk(tanstackStart() as PluginOption)
    expect(flat.map((p) => p.name)).toContain(ROUTE_GENERATOR_PLUGIN)
  })
})

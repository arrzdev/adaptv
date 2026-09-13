/**
 * Lets a running dev server hear an edit to the route config.
 *
 * ## The bug
 *
 * Adding `route("/x", "pages/x.page.tsx")` to `src/routing/config.ts` did nothing
 * until the dev server restarted: `.adaptv/routeTree.gen.ts` kept its old content and
 * `/x` answered 404. The watch event did reach the route generator, and it did run.
 * It read the config through jiti, and jiti keeps every module it has loaded in
 * Node's process-wide `require.cache`, so each run got back the module object from
 * the first load, generated the same tree, and wrote nothing. Measured against the
 * installed jiti: load a file, edit it, load it again, and the second load returns
 * the first contents. The cache holds what the config imports as well, so evicting
 * only the config still serves a stale import.
 *
 * A second gap sits behind it. The generator decides whether an event concerns the
 * route config by comparing the absolute watched path with the option it was given,
 * and that option is relative (`./src/routing/config.ts`), so it never matches. The
 * default config is only heard because it happens to sit inside the routes
 * directory, which counts as relevant on its own. `routerConfig` and
 * `routesDirectory` are independent keys, so a config placed outside that folder, or
 * a module the config imports from outside it, was dropped before anything was read.
 *
 * ## The fix
 *
 * On a watch event for the config or anything it loaded, this plugin evicts that
 * whole set from the module cache, so the next generation reads the files on disk.
 * The eviction is synchronous, and it has to be: Vite's plugin container calls
 * every `watchChange` handler before awaiting any of them, and the generator's
 * handler does not reach its config load until several awaits later. The eviction
 * therefore lands first whatever order the plugins run in.
 *
 * When the changed file is outside the routes directory, the generator would ignore
 * the event, so this plugin hands it one it does not ignore: the routes directory
 * itself, sent to the generator's own `watchChange`. The generator uses an event
 * only to decide whether to run. Each run re-crawls the whole config, so the path
 * it is given never reaches the output.
 *
 * Neither lever is a patch. The generator's `plugins` option, which would have
 * handed over the generator instance, is overwritten by Start with its own list.
 *
 * → `docs/decisions/register.md` L20 (fix in adaptv's plugin, never in the consumer)
 */

import { createRequire } from "node:module"
import path from "node:path"
import type { Plugin } from "vite"

/**
 * The name of the generator's Vite plugin inside Start's plugin list. It is looked
 * up only for the out-of-folder case, and a test asserts it against the real list so
 * an upstream rename fails CI instead of silently disabling that case.
 */
export const ROUTE_GENERATOR_PLUGIN = "tanstack:router-generator"

type CachedModule = { children?: readonly { filename: string }[] }

/**
 * The route config and every module it loaded, read from the module cache.
 *
 * The walk follows `children`, which jiti fills in as it loads imports (measured:
 * config → helper → helper's own import). Packages are skipped. They do not change
 * while the server runs, and evicting one would re-evaluate a dependency the rest of
 * the process still holds. The config itself is always included, even with no cache
 * entry: after a load that failed, the next edit to the config must still count.
 */
export function routeConfigModules(
  entry: string,
  cache: Readonly<Record<string, CachedModule | undefined>>,
): Set<string> {
  const found = new Set<string>()
  const visit = (file: string) => {
    if (found.has(file)) return
    if (file.split(path.sep).includes("node_modules")) return
    found.add(file)
    for (const child of cache[file]?.children ?? []) visit(child.filename)
  }
  visit(entry)
  return found
}

type WatchChange = (
  this: unknown,
  id: string,
  change: { event: "create" | "update" | "delete" },
) => unknown

export function adaptvRouteConfigWatchPlugin(options: {
  /** Absolute path of the app's route config. */
  routerConfig: string
  /** Absolute path of the routes directory, as the generator resolves it. */
  routesDir: string
}): Plugin {
  const cache = createRequire(import.meta.url).cache as Record<
    string,
    CachedModule | undefined
  >
  const routesDir = path.resolve(options.routesDir)
  const insideRoutesDir = (file: string) =>
    file === routesDir || file.startsWith(routesDir + path.sep)
  let generatorWatchChange: WatchChange | undefined

  return {
    name: "adaptv:route-config-watch",
    apply: "serve",
    enforce: "pre",
    configResolved(config) {
      const generator = config.plugins.find(
        (plugin) => plugin.name === ROUTE_GENERATOR_PLUGIN,
      )
      const hook = generator?.watchChange
      generatorWatchChange = (
        typeof hook === "function" ? hook : hook?.handler
      ) as WatchChange | undefined
    },
    watchChange(id, change) {
      const file = path.resolve(id)
      const loaded = routeConfigModules(options.routerConfig, cache)
      if (!loaded.has(file)) return
      //synchronous, before the first await: see the module comment
      for (const module of loaded) delete cache[module]
      if (insideRoutesDir(file)) return //the generator hears this event itself
      return generatorWatchChange?.call(this, routesDir, {
        event: change.event,
      }) as Promise<void> | undefined
    },
  }
}

import path from "node:path"
import type { Plugin } from "vite"
import { adaptvPackageRoot } from "#adaptv/vite/package-files.ts"

//The entries Start adds to `resolve.dedupe` (`@tanstack/react-start`'s `plugin/vite.js`).
//Only these go: an app's own `@tanstack/*` entry, such as `@tanstack/react-query`, stays.
const START_DEDUPE = new Set([
  "@tanstack/react-start",
  "@tanstack/react-router",
])

//Every `@tanstack/router-core` entry `@tanstack/react-router` imports, reached through
//adaptv's own dependencies (the app has neither package at its root).
const ROUTER_CORE_PREBUNDLE = [
  "@tanstack/router-core",
  "@tanstack/router-core/isServer",
  "@tanstack/router-core/scroll-restoration-script",
].map((entry) => `@arrzdev/adaptv > @tanstack/react-router > ${entry}`)

/**
 * Resolve the `@tanstack/*` imports TanStack writes into the APP's modules from adaptv's
 * own dependencies.
 *
 * The app never imports TanStack (L20), but TanStack's route code-splitter does it for
 * it: a split route module gains `import { lazyRouteComponent } from
 * "@tanstack/react-router"`, resolved from the route file. TanStack is adaptv's
 * dependency, not the app's, so under pnpm's strict layout that import has nothing to
 * find, and a freshly created app failed `adaptv build web` with `Rolldown failed to
 * resolve import "@tanstack/react-router"`. The playground and the website never showed
 * it: they live inside this repo, and resolution walks up to the repo's own
 * `node_modules`.
 *
 * Only importers in the app's own files are redirected. A package in `node_modules`
 * resolves its own dependencies already, and adaptv's source resolves from where it is.
 *
 * Start also lists its two packages in every environment's `resolve.dedupe`, and Vite
 * resolves a deduped package from the app root, whoever imports it. An adaptv app has
 * no TanStack at its root, so that lookup walks up and out of the app: an app inside a
 * repo or monorepo with its own `node_modules` loaded TanStack, and through it a second
 * React, from there, and `adaptv dev web` answered every page with a 500 ("Invalid hook
 * call"). The two entries are dropped, so each import resolves from its importer: the
 * app's through the redirect above, a package's from its own dependencies. React and
 * React DOM stay deduped — they are the app's own dependencies.
 *
 * In `adaptv dev web` the server never reaches the redirect. Vite's SSR import analysis
 * leaves a bare import that it externalizes as written, before any plugin resolves it,
 * and decides that once per specifier: adaptv's own `@tanstack/react-router` import
 * settles it for the app's split route too. The module runner then asks Node for
 * `@tanstack/react-router` from the route file, and a standalone pnpm app answered
 * every page with a 500 ("Cannot find module"). So in dev the router is inlined, and
 * every import of it goes through the redirect. Every importer resolves the same file,
 * so the server still loads one router.
 *
 * A build decides the other way round: Vite resolves a bare import from the app root,
 * whoever imports it, and leaves it to Node if that lookup succeeds. A standalone app
 * has no TanStack at its root, so TanStack is bundled. An app inside a repo found the
 * repo's own TanStack, so the server bundle handed `@tanstack/react-router` to Node,
 * and the router, and through it `react-dom/server`, came from the repo's
 * `node_modules` while the app's modules got the app's React. The prerender of
 * `adaptv build android` in `examples/basic` died on `Cannot read properties of null
 * (reading 'useEffect')`. So a build inlines every `@tanstack/*` package, as it already
 * did for a standalone app, and the only React it imports is the app's.
 *
 * adaptv itself is inlined in both commands. Its modules import the ones its Vite plugin
 * serves (`virtual:adaptv-*`), which Node refuses: a dev server that handed adaptv to
 * Node answered every page with a 500. A build bundles it either way. Every app needs
 * the entry, so the plugin adds it and an app's `vite.config.ts` carries no `ssr` key.
 *
 * In dev the browser's copy of the router is pre-bundled up front. Start puts every
 * package that peers on it, the router and adaptv included, in the client's
 * `optimizeDeps.exclude`, so the router is served as source, and Vite met its
 * `@tanstack/router-core` imports only when the first page asked for them. It then
 * bundled them and reloaded the page: on a cold server that reload landed seconds after
 * the page had hydrated, and whatever the user (or the first e2e spec) had done in
 * between was gone. Listing the entries makes the optimizer bundle them before the first
 * page loads.
 */
export function adaptvTanstackResolvePlugin(
  appRoot: string,
  packageRoot = adaptvPackageRoot(),
): Plugin {
  const from = path.join(packageRoot, "package.json")
  const appDir = `${path.resolve(appRoot)}${path.sep}`
  return {
    name: "adaptv:tanstack-resolve",
    enforce: "pre",
    config: (_config, { command }) =>
      command === "serve"
        ? {
            resolve: {
              noExternal: ["@arrzdev/adaptv", "@tanstack/react-router"],
            },
            optimizeDeps: { include: ROUTER_CORE_PREBUNDLE },
          }
        : { resolve: { noExternal: ["@arrzdev/adaptv", /^@tanstack\//] } },
    //`post`: Start adds the entries in its own `configEnvironment`, merged before this
    //runs. Removing one takes a write to the merged options, not a returned partial,
    //because Vite concatenates arrays when it merges.
    configEnvironment: {
      order: "post",
      handler(_name, options) {
        const resolve = options.resolve
        if (!resolve?.dedupe) return
        resolve.dedupe = resolve.dedupe.filter(
          (id) => !START_DEDUPE.has(id),
        )
      },
    },
    resolveId(source, importer, options) {
      if (!source.startsWith("@tanstack/") || !importer) return null
      const file = importer.split("?")[0] ?? importer
      if (
        !file.startsWith(appDir) ||
        file.includes(`${path.sep}node_modules${path.sep}`)
      )
        return null
      return this.resolve(source, from, { ...options, skipSelf: true })
    },
  }
}

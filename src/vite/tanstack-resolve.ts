import path from "node:path"
import type { Plugin } from "vite"
import { adaptvPackageRoot } from "#adaptv/vite/package-files.ts"

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
    //`post`: Start adds the entries in its own `configEnvironment`, merged before this
    //runs. Removing one takes a write to the merged options, not a returned partial,
    //because Vite concatenates arrays when it merges.
    configEnvironment: {
      order: "post",
      handler(_name, options) {
        const resolve = options.resolve
        if (!resolve?.dedupe) return
        resolve.dedupe = resolve.dedupe.filter(
          (id) => !id.startsWith("@tanstack/"),
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

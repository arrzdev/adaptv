import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "vite"

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
 */
export function adaptvTanstackResolvePlugin(
  appRoot: string,
  //the package root — two levels up from src/vite/
  packageRoot = fileURLToPath(new URL("../..", import.meta.url)),
): Plugin {
  const from = path.join(packageRoot, "package.json")
  const appDir = `${path.resolve(appRoot)}${path.sep}`
  return {
    name: "adaptv:tanstack-resolve",
    enforce: "pre",
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

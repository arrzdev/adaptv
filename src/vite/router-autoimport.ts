/**
 * In-memory safety net for the route-factory import. → `DECISIONS.md §3.2`
 *
 * ## How TanStack opacity works now
 *
 * `@tanstack/router-generator` maintains the `createFileRoute` import in route
 * files itself — it parses each route, normalises the call to
 * `createFileRoute("/path")({ … })`, and writes the matching import back to disk.
 * Newer versions removed the `verboseFileRoutes` escape hatch AND the standalone
 * `tanstack-router:autoimport` plugin adaptv used to fight, folding both into the
 * generator.
 *
 * adaptv keeps that write opaque with a one-line patch on the generator's
 * `targetModule` (`transform.js`): it reads `ADAPTV_ROUTER_PKG` (set by the vite
 * plugin) so the import the generator writes points at `@arrzdev/adaptv/router`,
 * never `@tanstack/*`. So a route file ends up as:
 *
 * ```ts
 * import { createFileRoute } from "@arrzdev/adaptv/router"
 * export const Route = createFileRoute("/settings")({ … })
 * ```
 *
 * with zero `@tanstack/*` in the consumer's source — and the import merges into an
 * existing `@arrzdev/adaptv/router` import if the file already has one.
 *
 * ## What this plugin is for
 *
 * A **race guard**, not the primary mechanism. In dev a freshly-created route file
 * can be transformed and served before the generator has written its import — so
 * `createFileRoute` would be an undefined binding for one beat. This supplies the
 * barrel binding in-memory to cover that window; once the generator writes the
 * import to disk, `importsRouteFactory` sees it and this plugin no-ops.
 *
 * ## The gate that makes it safe
 *
 * It MUST gate on `globalThis.TSR_ROUTES_BY_ID_MAP`, populated by the generator to
 * identify *real* route files. Without it the transform also fires on the virtual
 * modules the code-splitter produces
 * (`tanstack-router:code-splitter:compile-virtual-file`) and can re-add an import
 * that collides: `Identifier 'createFileRoute' has already been declared`, in files
 * that were correct on disk. Measured, not theorised.
 *
 * `stripTanStackAutoImport` below is now defensive: the upstream
 * `tanstack-router:autoimport` plugin it removes no longer exists, so the filter is
 * a no-op unless a future TanStack release re-introduces it.
 */
import type { Plugin, PluginOption } from "vite"

/** The upstream plugin adaptv replaces. */
export const TANSTACK_AUTOIMPORT_PLUGIN = "tanstack-router:autoimport"

/** The specifier adaptv's route files import the route factory from. */
export const ADAPTV_ROUTER_SPECIFIER = "@arrzdev/adaptv/router"

const ROUTE_FACTORIES = ["createFileRoute", "createLazyFileRoute"] as const

/**
 * Walk a (possibly deeply nested) Vite plugin array and drop the upstream
 * autoimport plugin.
 *
 * Matched **by name**, which is stable public metadata, rather than by position —
 * Start reorders its internals between releases, and an index-based removal would
 * silently start deleting the wrong plugin.
 */
export function stripTanStackAutoImport(
  plugins: PluginOption[],
): PluginOption[] {
  const keep = (plugin: PluginOption): boolean =>
    !(
      plugin &&
      typeof plugin === "object" &&
      "name" in plugin &&
      plugin.name === TANSTACK_AUTOIMPORT_PLUGIN
    )

  return plugins.filter(keep).map((plugin) => {
    if (Array.isArray(plugin)) return stripTanStackAutoImport(plugin)
    return plugin
  })
}

/**
 * Whether `code` already binds `factory`, from any module.
 *
 * Source-agnostic on purpose. The upstream plugin only accepts its own specifier,
 * which is what makes it fight a re-export; adaptv accepts either, so a route file
 * that still imports from `@tanstack/react-router` keeps working untouched. That
 * matters for migration: an app can move route files over one at a time.
 */
export function importsRouteFactory(
  code: string,
  factory: string,
): boolean {
  //match `import { … factory … } from "…"`, allowing aliases and multiline lists
  const importPattern = new RegExp(
    `import\\s*\\{[^}]*\\b${factory}\\b[^}]*\\}\\s*from`,
    "s",
  )
  return importPattern.test(code)
}

/** Which route factory, if any, this module uses. */
export function detectRouteFactory(code: string): string | null {
  for (const factory of ROUTE_FACTORIES) {
    if (code.includes(`${factory}(`)) return factory
  }
  return null
}

/**
 * The import statement to prepend, or `null` when nothing is needed.
 * Pure, so the decision is testable without a bundler.
 */
export function resolveAutoImport(
  code: string,
  specifier: string = ADAPTV_ROUTER_SPECIFIER,
): string | null {
  const factory = detectRouteFactory(code)
  if (factory === null) return null
  if (importsRouteFactory(code, factory)) return null
  return `import { ${factory} } from "${specifier}"\n`
}

/**
 * Whether `id` is a real route file, per the generator's own registry.
 *
 * `TSR_ROUTES_BY_ID_MAP` is a global the generator populates. Gating on it is not
 * an optimisation — it is what stops the transform firing on the code-splitter's
 * derived virtual modules and producing a duplicate binding.
 */
function isKnownRouteFile(id: string): boolean {
  const map = (
    globalThis as { TSR_ROUTES_BY_ID_MAP?: Map<string, unknown> }
  ).TSR_ROUTES_BY_ID_MAP
  //before the generator has run there is no registry; treating "unknown" as
  //"not a route" is the safe default — a missing import is a clear error, a
  //duplicate one is a confusing parse failure in a file that looks correct
  return map?.has(normalizeId(id)) ?? false
}

/** The generator stores POSIX-separated paths; match that on every platform. */
export function normalizeId(id: string): string {
  return id.replace(/\\/g, "/")
}

/**
 * adaptv's replacement autoimport plugin.
 *
 * `enforce: "pre"` mirrors the upstream ordering — the binding has to exist
 * before anything else parses the module.
 */
export function adaptvRouteAutoImportPlugin(
  specifier: string = ADAPTV_ROUTER_SPECIFIER,
): Plugin {
  return {
    name: "adaptv:route-autoimport",
    enforce: "pre",
    transform(code, id) {
      if (!/\.(m|c)?(j|t)sx?$/.test(id)) return null
      //cheap prefilter — the overwhelming majority of modules are not routes
      if (
        !code.includes("createFileRoute(") &&
        !code.includes("createLazyFileRoute(")
      ) {
        return null
      }
      if (!isKnownRouteFile(id)) return null

      const statement = resolveAutoImport(code, specifier)
      if (statement === null) return null
      return { code: statement + code, map: null }
    },
  }
}

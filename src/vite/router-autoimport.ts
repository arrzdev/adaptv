/**
 * Replacing TanStack's route-autoimport plugin. → `DECISIONS.md §3.2`
 *
 * ## The problem, reproduced rather than reasoned about
 *
 * A route file is supposed to read:
 *
 * ```ts
 * import { createFileRoute } from "@arrzdev/nativ/router"
 * export const Route = createFileRoute("/settings")({ … })
 * ```
 *
 * Switching a real route file to that import and building produces a **parse
 * error**, and the file on disk ends up with two imports:
 *
 * ```ts
 * import { createFileRoute } from "@tanstack/react-router"   // ← added by TanStack
 * import { createFileRoute } from "@arrzdev/nativ/router"    // ← what we wrote
 * ```
 *
 * The cause is `tanstack-router:autoimport` (in `@tanstack/router-plugin`). It
 * transforms any file whose code matches `createFileRoute(`, checks whether that
 * identifier was imported **from the literal specifier `@tanstack/<target>-router`**,
 * and if not, prepends the import itself. An import from anywhere else is
 * invisible to it, so it always fires — producing a duplicate binding.
 *
 * So the barrier to TanStack opacity is not that the generator fails to *find*
 * the route. It is that this plugin actively rewrites the import back.
 *
 * ## The two-part fix
 *
 * Swapping the plugin alone is not enough — there are **two** writers of that
 * import, and they have to be handled together.
 *
 * **1. `verboseFileRoutes: false` disarms the generator.** Read from
 * `@tanstack/router-generator/dist/esm/transform/transform.js`: the generator
 * maintains route-file imports via a `{ required, banned }` policy, and the
 * `verboseFileRoutes === false` branch **bans** `createFileRoute` /
 * `createLazyFileRoute` from `@tanstack/<target>-router` and requires nothing. So
 * instead of fighting the generator, nativ asks it to strip the import — leaving
 * route files on disk with **no router import at all**, which is exactly the goal:
 * the consumer's source contains zero `@tanstack/*`.
 *
 * **2. This plugin supplies the binding at build time**, from nativ's specifier.
 *
 * ## The gate that makes it safe
 *
 * The replacement MUST gate on `globalThis.TSR_ROUTES_BY_ID_MAP`, populated by the
 * generator to identify *real* route files — exactly as upstream does. Without it
 * the transform also fires on the virtual modules the code-splitter produces
 * (`tanstack-router:code-splitter:compile-virtual-file`), where the import has
 * already been stripped, and re-adds one that then collides:
 * `Identifier 'createFileRoute' has already been declared`, in files that were
 * correct on disk. Measured, not theorised.
 */
import type { Plugin, PluginOption } from "vite"

/** The upstream plugin nativ replaces. */
export const TANSTACK_AUTOIMPORT_PLUGIN = "tanstack-router:autoimport"

/** The specifier nativ's route files import the route factory from. */
export const NATIV_ROUTER_SPECIFIER = "@arrzdev/nativ/router"

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
 * which is what makes it fight a re-export; nativ accepts either, so a route file
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
  specifier: string = NATIV_ROUTER_SPECIFIER,
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
 * nativ's replacement autoimport plugin.
 *
 * `enforce: "pre"` mirrors the upstream ordering — the binding has to exist
 * before anything else parses the module.
 */
export function nativRouteAutoImportPlugin(
  specifier: string = NATIV_ROUTER_SPECIFIER,
): Plugin {
  return {
    name: "nativ:route-autoimport",
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

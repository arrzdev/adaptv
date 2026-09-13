import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import { ADAPTV_DIR, nextGitignore } from "#adaptv/vite/adaptv-dir.ts"

/**
 * Project wiring for the generated directory.
 *
 * **This file used to generate four modules into every consumer's repo** — the
 * root route, the router entry, the service worker, and an ambient type
 * declaration. All four turned out to be framework code with a handful of config
 * values threaded through, so all four now live in the package and reach their
 * app-specific inputs through virtual modules and aliases.
 *
 * What remains is the wiring those need: an ignore entry and two tsconfig
 * entries. All three touch files the *consumer* owns, so all three are
 * idempotent and never reformat anything.
 *
 * What this file no longer stamps into `.adaptv/` is the point: the only module it
 * still puts there is TanStack's generated route tree, which genuinely is derived
 * from the app's own route files. (Other producers write into the same directory —
 * `sw.gen.ts`, `tmp/router/`, the native `web/` bundle — see `adaptv-dir.ts`.)
 */

const ROUTE_TREE_ALIAS = "#adaptv-route-tree"

/** Ensure the app's ignore + tsconfig wiring is present. */
export function stampGeneratedFiles(context: AdaptvContext): void {
  if (!context.loaded) return

  //the consumer must not wire the hidden dir up by hand — a path mapping or
  //ignore entry that has to stay in sync with a framework internal is exactly
  //the per-project babysitting adaptv exists to remove
  ensureGitignored(context.appRoot)
  ensureTsconfigWiring(context.appRoot)
}

/**
 * Add everything adaptv generates (`ADAPTV_GITIGNORED`) to the app's `.gitignore`.
 *
 * Appends rather than rewrites, and only adds the entries that are actually missing —
 * this runs on every config load, so it must never reorder or reformat a file the
 * consumer owns. Checking per-entry (rather than bailing when the first one is present)
 * is what lets an app that already ignores `.adaptv/` pick up a later addition.
 */
function ensureGitignored(appRoot: string): void {
  const gitignorePath = path.resolve(appRoot, ".gitignore")
  try {
    const current = existsSync(gitignorePath)
      ? readFileSync(gitignorePath, "utf8")
      : ""
    const next = nextGitignore(current)
    if (next !== null) writeFileSync(gitignorePath, next)
  } catch {
    //a read-only or absent working tree is not a reason to fail the build
  }
}

/**
 * Give the app's tsconfig what adaptv's package modules need.
 *
 * Two entries, each for a specific failure:
 *
 * 1. **`include` → adaptv's ambient route types.** A route file is authored with no
 *    import — the generator writes the `@arrzdev/adaptv/router` one in later — so
 *    until it does, TypeScript must be told where `createFileRoute` comes from,
 *    otherwise a freshly-written route file reports `Cannot find name
 *    'createFileRoute'` in a project whose *build* passes.
 * 2. **`paths` → `#adaptv-route-tree`.** adaptv's router entry is a package module
 *    and cannot reach the app's route tree relatively. Aliasing for the bundler
 *    alone is not enough: the route tree's concrete **type** has to flow into the
 *    `Register` augmentation, and a bundler-only alias builds fine while silently
 *    collapsing typed routing to `any`.
 *
 * Edited at string level rather than parsed: a real tsconfig routinely holds
 * comments and trailing commas that `JSON.parse` rejects and `JSON.stringify`
 * would silently strip, reformatting a file we do not own.
 */
function ensureTsconfigWiring(appRoot: string): void {
  const tsconfigPath = path.resolve(appRoot, "tsconfig.json")
  const includes = [
    "node_modules/@arrzdev/adaptv/src/interface/route-globals.d.ts",
    `${ADAPTV_DIR}/**/*.ts`,
  ]

  try {
    if (!existsSync(tsconfigPath)) return
    let raw = readFileSync(tsconfigPath, "utf8")
    const before = raw

    const missing = includes.filter((entry) => !raw.includes(entry))
    if (missing.length > 0) {
      const includeMatch = raw.match(/("include"\s*:\s*\[)/)
      if (includeMatch) {
        raw = raw.replace(
          includeMatch[1],
          `${includeMatch[1]}${missing
            .map((entry) => `${JSON.stringify(entry)}, `)
            .join("")}`,
        )
      }
    }

    if (!raw.includes(ROUTE_TREE_ALIAS)) {
      const pathsMatch = raw.match(/("paths"\s*:\s*\{)/)
      if (pathsMatch) {
        raw = raw.replace(
          pathsMatch[1],
          `${pathsMatch[1]}\n      ${JSON.stringify(ROUTE_TREE_ALIAS)}: ["./${ADAPTV_DIR}/routeTree.gen.ts"],`,
        )
      }
    }

    if (raw !== before) writeFileSync(tsconfigPath, raw)
  } catch {
    //never fail a build over editor ergonomics
  }
}

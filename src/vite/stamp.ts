import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { NativContext } from "#nativ/vite/nativ-context.ts"
import {
  NATIV_DIR,
  nativDirGitignoreEntry,
} from "#nativ/vite/nativ-dir.ts"

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
 * `.nativ/` now holds exactly one file — TanStack's generated route tree, which
 * genuinely is derived from the app's own route files.
 */

//An app can eject either surface by writing the real file; nativ then defers.
//The eject paths stay in the app's OWN src tree — ejecting means "this is my
//file now", so it belongs with their code.
const ROOT_EJECT_REL = "routing/layouts/_root.tsx"
const ROUTER_EJECT_REL = "router.tsx"

const ROUTE_TREE_ALIAS = "#nativ-route-tree"

export type EjectState = {
  root: boolean
  router: boolean
}

/** Ensure the app's ignore + tsconfig wiring is present. Returns eject state. */
export function stampGeneratedFiles(context: NativContext): EjectState {
  if (!context.loaded) return { root: false, router: false }
  const srcDir = path.resolve(context.appRoot, "src")

  const rootEjected = existsSync(path.resolve(srcDir, ROOT_EJECT_REL))
  const routerEjected = existsSync(path.resolve(srcDir, ROUTER_EJECT_REL))

  //the consumer must not wire the hidden dir up by hand — a path mapping or
  //ignore entry that has to stay in sync with a framework internal is exactly
  //the per-project babysitting nativ exists to remove
  ensureGitignored(context.appRoot)
  ensureTsconfigWiring(context.appRoot)

  return { root: rootEjected, router: routerEjected }
}

/**
 * Add `.nativ/` to the app's `.gitignore` if it isn't already covered.
 *
 * Appends rather than rewrites, and is a no-op when present — this runs on every
 * config load, so it must never reorder or reformat a file the consumer owns.
 */
function ensureGitignored(appRoot: string): void {
  const gitignorePath = path.resolve(appRoot, ".gitignore")
  try {
    const current = existsSync(gitignorePath)
      ? readFileSync(gitignorePath, "utf8")
      : ""
    if (
      current
        .split(/\r?\n/)
        .some((line) => line.trim() === `${NATIV_DIR}/`)
    ) {
      return
    }
    const prefix =
      current.length > 0 && !current.endsWith("\n") ? "\n" : ""
    writeFileSync(
      gitignorePath,
      `${current}${prefix}\n${nativDirGitignoreEntry()}\n`,
    )
  } catch {
    //a read-only or absent working tree is not a reason to fail the build
  }
}

/**
 * Give the app's tsconfig what nativ's package modules need.
 *
 * Two entries, each for a specific failure:
 *
 * 1. **`include` → nativ's ambient route types.** With `verboseFileRoutes: false`
 *    the route factory has no import, so TypeScript must be told where the name
 *    comes from — otherwise every route file reports `Cannot find name
 *    'createFileRoute'` in a project whose *build* passes.
 * 2. **`paths` → `#nativ-route-tree`.** nativ's router entry is a package module
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
    "node_modules/@arrzdev/nativ/src/interface/route-globals.d.ts",
    `${NATIV_DIR}/**/*.ts`,
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
          `${pathsMatch[1]}\n      ${JSON.stringify(ROUTE_TREE_ALIAS)}: ["./${NATIV_DIR}/routeTree.gen.ts"],`,
        )
      }
    }

    if (raw !== before) writeFileSync(tsconfigPath, raw)
  } catch {
    //never fail a build over editor ergonomics
  }
}

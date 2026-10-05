import { readFileSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "vite"
import { parseAst } from "vite"
import { isBannedServerModule } from "#adaptv/vite/ban-server-apis.ts"
import { adaptvPackageRoot } from "#adaptv/vite/package-files.ts"

/**
 * adaptv's own dependencies are not the app's (L20).
 *
 * An app imports what its own `package.json` lists and what `@arrzdev/adaptv/*`
 * exports. The packages adaptv is built on are its business: a direct import of one
 * ties the app to a version adaptv may change in any release, and it teaches the dev
 * the machinery the barrels exist to hide. → docs/decisions/facade-and-opacity.md §1
 *
 * Nothing else stopped it. pnpm's strict layout did, by accident, for a package the app
 * did not list — until `tanstack-resolve.ts` began resolving every `@tanstack/*` import
 * in the app's files from adaptv, which TanStack's code-splitter needs. npm and Yarn
 * hoist adaptv's dependencies to the app's `node_modules`, so there it always resolved.
 * So the rule is not where a package happens to be installed: it is what the app
 * declares, read from the source the dev wrote, before any plugin adds imports of its
 * own to it.
 *
 * A package the app lists is the app's, and imports like any other. The server-only
 * modules are left to `ban-server-apis.ts`, which refuses them whether the app lists
 * them or not, with the message that says why.
 */

/** The package a bare specifier names, or `null` for a relative, absolute or virtual one. */
export function packageOf(specifier: string): string | null {
  if (!/^[@a-z0-9]/i.test(specifier) || specifier.includes(":"))
    return null
  const parts = specifier.split("/")
  if (specifier.startsWith("@"))
    return parts.length > 1 ? `${parts[0]}/${parts[1]}` : null
  return parts[0] ?? null
}

/**
 * The packages an app may not import without listing them: every dependency adaptv
 * declares, and the whole `@tanstack/` scope, because the engine's own packages reach
 * the app's `node_modules` through adaptv's (npm hoists `@tanstack/router-core` as
 * readily as `@tanstack/react-router`). An app's own `@tanstack/react-query` is fine:
 * it lists it.
 */
export function isInternalPackage(
  name: string,
  adaptvDependencies: ReadonlySet<string>,
): boolean {
  return adaptvDependencies.has(name) || name.startsWith("@tanstack/")
}

type Found = { source: string; start: number }

/** Every module specifier in `code`: static and dynamic imports, and re-exports. */
export function importsIn(code: string, file: string): Found[] {
  const ext = path.extname(file.split("?")[0] ?? file)
  const lang = /^\.[mc]?ts$/.test(ext)
    ? "ts"
    : ext === ".tsx"
      ? "tsx"
      : ext === ".jsx"
        ? "jsx"
        : "js"
  const found: Found[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    const n = node as {
      type?: string
      source?: { type?: string; value?: unknown; start: number }
    }
    if (
      (n.type === "ImportDeclaration" ||
        n.type === "ExportNamedDeclaration" ||
        n.type === "ExportAllDeclaration" ||
        n.type === "ImportExpression") &&
      n.source?.type === "Literal" &&
      typeof n.source.value === "string"
    )
      found.push({ source: n.source.value, start: n.source.start })
    for (const value of Object.values(node)) walk(value)
  }
  walk(parseAst(code, { lang }))
  return found
}

/** The packages an app's `package.json` lists, in any of its dependency fields. */
export function declaredBy(appRoot: string): Set<string> {
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(
      readFileSync(path.join(appRoot, "package.json"), "utf8"),
    )
  } catch {
    return new Set()
  }
  const names = new Set<string>()
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    const deps = pkg[field]
    if (deps && typeof deps === "object")
      for (const name of Object.keys(deps)) names.add(name)
  }
  return names
}

/**
 * The refusal. The first line is the whole of it: the file, what is wrong, and the two
 * ways out. The CLI shows only that line, and drops any line that names the engine
 * (`bin/lib/opacity.mjs`), so the import the dev wrote waits on the second line, for the
 * dev overlay and a plain `vite build`, where the caret frame points at it anyway.
 */
export function describeEngineImport(
  source: string,
  file: string,
): string {
  return (
    `${file} imports a package missing from the app's package.json — add it there, ` +
    `or import from an @arrzdev/adaptv subpath.\n` +
    `The import is "${source}". adaptv's own dependencies are not part of the app.`
  )
}

/**
 * The check, in the app's own files only: not a package (`node_modules`), not adaptv's
 * source in a checkout, not a module another plugin made up. `enforce: "pre"` and an
 * early place in `adaptv()`'s array put it ahead of every plugin that writes imports
 * into the app's modules, so what it reads is what the dev wrote. A module with a query
 * (`?tsr-split=component`) is a view of a file this already read without one.
 */
export function adaptvEngineImportsPlugin(
  appRoot: string,
  packageRoot = adaptvPackageRoot(),
): Plugin {
  const appDir = `${path.resolve(appRoot)}${path.sep}`
  let internal: Set<string> | undefined
  const adaptvDependencies = () => {
    internal ??= new Set(
      Object.keys(
        JSON.parse(
          readFileSync(path.join(packageRoot, "package.json"), "utf8"),
        ).dependencies ?? {},
      ),
    )
    return internal
  }
  return {
    name: "adaptv:engine-imports",
    enforce: "pre",
    transform(code, id) {
      if (
        !id.startsWith(appDir) ||
        id.includes("?") ||
        id.includes(`${path.sep}node_modules${path.sep}`) ||
        !/\.[mc]?[jt]sx?$/.test(id)
      )
        return null
      const deps = adaptvDependencies()
      //the parse is the only expensive part, and almost no module names a package adaptv
      //depends on — so ask the cheap question first
      if (
        !code.includes("@tanstack/") &&
        ![...deps].some((name) => code.includes(name))
      )
        return null
      const candidates = importsIn(code, id).filter(({ source }) => {
        const name = packageOf(source)
        return (
          name !== null &&
          !isBannedServerModule(source) &&
          isInternalPackage(name, deps)
        )
      })
      if (candidates.length === 0) return null
      //read on demand, not once: a dev who adds the package to package.json while the
      //dev server runs should not have to restart it to be believed
      const declared = declaredBy(appRoot)
      const hit = candidates.find(
        ({ source }) => !declared.has(packageOf(source) as string),
      )
      if (!hit) return null
      this.error(
        {
          message: describeEngineImport(
            hit.source,
            path.relative(appRoot, id).split(path.sep).join("/"),
          ),
          id,
        },
        hit.start,
      )
    },
  }
}

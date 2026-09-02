import { readdirSync, readFileSync } from "node:fs"
import { relative, resolve } from "node:path"

/*
 * The pieces the five barrel guards share, and only those: a walk of `src/` that
 * skips tests, and a reading of a barrel's `export … from` lines. What each guard
 * CHECKS — the Node-only set, the namespace-as-value, the tier table — differs on
 * purpose and stays in the guard.
 *
 * A barrel is read as TEXT, never imported: the property every guard is after is
 * "a human wrote this line" (`docs/roadmap/src-reorg.md` §2.5), and an import
 * would answer "the module resolves", which `tsc` already answers. This is a plain
 * module, not a test, so `execution-boundary.test.ts` names it in its allow-list
 * and proves no published entry reaches it.
 */

const ROOT = process.cwd()

/**
 * The non-test `.ts`/`.tsx` under `src/` whose text matches `pattern`,
 * repo-relative and sorted. `exclude` names files to leave out — a guard passes
 * its own barrel, which mentions every module by definition.
 */
export function callSitesOf(
  pattern: RegExp,
  exclude: readonly string[] = [],
): string[] {
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name) &&
        !exclude.includes(relative(ROOT, full)) &&
        pattern.test(readFileSync(full, "utf8"))
      )
        hits.push(relative(ROOT, full))
    }
  }
  walk(resolve(ROOT, "src"))
  return hits.sort()
}

export type BarrelExport = {
  /** As written — `"../hooks/use-share"`, `"#adaptv/storage/kv"`. */
  spec: string
  /** `null` for `export *`; a named list's names otherwise. */
  names: string[] | null
  /** `export type { … } from` — erased at build. */
  typeOnly: boolean
}

/**
 * Every `export … from "<spec>"` in a barrel's source, in order. Two shapes,
 * because two are written: `export *` carries everything, and a named list
 * `export [type] { a, b } from` is the only way to hold a name back.
 */
export function exportsOf(barrelSource: string): BarrelExport[] {
  const line =
    /^export\s+(?:(type)\s+)?(?:(\*)|\{([^}]*)\})\s*from\s*"([^"]+)"/gm
  return [...barrelSource.matchAll(line)].map(
    ([, type, star, list, spec]) => ({
      spec: spec ?? "",
      names: star
        ? null
        : (list ?? "")
            .split(",")
            .map((name) => name.trim().replace(/^type\s+/, ""))
            .filter((name) => name.length > 0),
      typeOnly: type === "type",
    }),
  )
}

/** Top-level `export` declarations in a module's source, types included. */
export function declaredExports(moduleSource: string): string[] {
  const declaration =
    /^export\s+(?:async\s+)?(?:function|const|type|class|interface)\s+([A-Za-z0-9_$]+)/gm
  return [...moduleSource.matchAll(declaration)].map((m) => m[1] ?? "")
}

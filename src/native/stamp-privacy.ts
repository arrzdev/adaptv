import type { Dirent } from "node:fs"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type {
  AdaptvPrivacyConfig,
  RequiredReasonApi,
} from "#adaptv/native/privacy-manifest.ts"
import {
  declaredRequiredReasons,
  parseShippedPrivacyManifest,
  renderPrivacyManifest,
  resolveRequiredReasons,
} from "#adaptv/native/privacy-manifest.ts"
import { ADAPTV_DIR } from "#adaptv/vite/adaptv-dir.ts"

/** App roots already stamped this process — see the note in the function. */
const stamped = new Set<string>()

/** The app's own declaration, as the stamper needs it. */
export type PrivacyManifestInput = {
  /** `adaptv.config.ts` `plugins` — Capacitor plugins adaptv does not ship. */
  plugins?: string[]
  /** `adaptv.config.ts` `privacy` — what only the app can know. */
  privacy?: AdaptvPrivacyConfig
  /**
   * adaptv's own package root. **The CLI must pass this.** It loads this module by
   * bundling it into a `data:` URL (`bin/lib/load-ts.mjs`), where `import.meta.url`
   * is not a file path and the self-locating fallback lands on the app's own root —
   * whose `package.json` has no `@capacitor/*` in it, which is the entire bug this
   * file exists to fix, reintroduced by the back door. Vite imports the real module
   * and can leave it out.
   */
  adaptvRoot?: string
}

const MANIFEST_FILE = "PrivacyInfo.xcprivacy"

/**
 * Every Capacitor plugin compiled into the app.
 *
 * **adaptv's own come first, and they are the reason this function exists.** The
 * manifest used to be derived from the app's `package.json` alone, which reads
 * right and is wrong: adaptv OWNS Capacitor, so `@capacitor/device` and
 * `@capacitor/preferences` are adaptv's dependencies and appear nowhere in the
 * consumer's. Every generated manifest therefore declared nothing at all, while the
 * binary shipped two required-reason APIs — the exact silent-at-submission failure
 * this file exists to prevent.
 */
function installedPlugins(
  appRoot: string,
  input: PrivacyManifestInput | undefined,
): string[] {
  const out = new Set<string>()

  //tier 1's real input: what adaptv itself bundles, read from its own manifest so a
  //plugin added to adaptv is covered without a second list to keep in step
  for (const root of adaptvRoots(input?.adaptvRoot)) {
    const deps = readPackageJson(root)?.dependencies
    if (!deps) continue
    for (const name of Object.keys(deps))
      if (name.startsWith("@capacitor/")) out.add(name)
    break
  }

  //the app may `pnpm add` a plugin itself (and did, before `plugins` existed)
  const app = readPackageJson(appRoot)
  for (const name of [
    ...Object.keys(app?.dependencies ?? {}),
    ...Object.keys(app?.devDependencies ?? {}),
  ])
    out.add(name)

  //and the ones it registered in adaptv.config.ts
  for (const name of input?.plugins ?? []) out.add(name)

  return [...out]
}

type PackageJson = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function readPackageJson(dir: string | null): PackageJson | null {
  if (!dir) return null
  try {
    return JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    ) as PackageJson
  } catch {
    return null
  }
}

/**
 * adaptv's own package root — `src/native/` is two levels down from it.
 *
 * The cwd fallback covers loaders that hand out a non-`file:` `import.meta.url`
 * (vitest does), where resolving from the module throws — the same fallback
 * `verify-patches.ts` needs, for the same reason.
 */
function adaptvRoots(given: string | undefined): string[] {
  const roots: string[] = []
  if (given) roots.push(given)
  try {
    roots.push(fileURLToPath(new URL("../..", import.meta.url)))
  } catch {}
  roots.push(process.cwd())
  return roots
}

/** A module path resolution can start from, inside adaptv's own tree. */
function adaptvResolveFrom(given: string | undefined): string {
  if (given) return path.join(given, "package.json")
  try {
    return fileURLToPath(import.meta.url)
  } catch {
    return path.join(process.cwd(), "package.json")
  }
}

/**
 * Where a plugin package lives. Tried from the APP first (a plugin the consumer
 * installed) and then from adaptv (everything adaptv bundles) — the same two-root
 * walk the CLI's native injectors do, for the same reason: under pnpm neither root
 * can see the other's dependencies.
 */
function pluginDir(
  pkg: string,
  appRoot: string,
  adaptvRoot: string | undefined,
): string | null {
  for (const from of [
    path.join(appRoot, "package.json"),
    adaptvResolveFrom(adaptvRoot),
  ]) {
    try {
      return path.dirname(
        createRequire(from).resolve(`${pkg}/package.json`),
      )
    } catch {}
  }
  return null
}

/**
 * Tier 2 — the required-reason APIs a plugin declares in its own manifest.
 *
 * Looked for at the package root and anywhere in its `ios/` tree, which is where
 * CocoaPods and SwiftPM expect it. The walk is depth-capped and skips nested
 * `node_modules`: this runs on every capacitor build, and an unbounded walk of a
 * dependency tree is not something a build step should do.
 */
function shippedRequiredReasons(
  pkg: string,
  appRoot: string,
  adaptvRoot: string | undefined,
): RequiredReasonApi[] {
  const dir = pluginDir(pkg, appRoot, adaptvRoot)
  if (!dir) return []
  const found: RequiredReasonApi[] = []
  const stack: Array<{ dir: string; depth: number }> = [
    { dir, depth: 0 },
    { dir: path.join(dir, "ios"), depth: 1 },
  ]
  const seen = new Set<string>()
  while (stack.length) {
    const current = stack.pop()
    if (!current || seen.has(current.dir) || current.depth > 5) continue
    seen.add(current.dir)
    let entries: Dirent[]
    try {
      entries = readdirSync(current.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        //only descend into the iOS tree; the package root itself is read flat, so a
        //plugin's `dist/`, `android/` and `node_modules/` are never walked
        if (current.depth > 0 && entry.name !== "node_modules")
          stack.push({
            dir: path.join(current.dir, entry.name),
            depth: current.depth + 1,
          })
        continue
      }
      if (entry.name !== MANIFEST_FILE) continue
      try {
        found.push(
          ...parseShippedPrivacyManifest(
            readFileSync(path.join(current.dir, entry.name), "utf8"),
            pkg,
          ),
        )
      } catch {}
    }
  }
  return found
}

/**
 * Write `.adaptv/ios/App/App/PrivacyInfo.xcprivacy` from everything compiled into
 * the app. → `DECISIONS.md §5.0.1`
 *
 * Runs on the capacitor build, alongside the capacitor.config stamp, because the
 * obligation is derivable and nothing else needs to happen first. The alternative —
 * the consumer hand-editing XML — fails silently at App Store submission, days
 * after the code was written; and here it is not even available, since this file is
 * regenerated on every build. Anything adaptv cannot derive comes in through
 * `privacy` in `adaptv.config.ts` instead.
 *
 * Idempotent: unchanged content is not rewritten, so it does not churn Xcode's
 * file watcher or show up as a spurious diff on every build.
 */
export function stampPrivacyManifest(
  appRoot: string,
  input?: PrivacyManifestInput,
): string | null {
  //`adaptv()` is invoked once per Vite environment (client + ssr), so a naive
  //implementation logs the same line three times. Report only the first write.
  if (stamped.has(appRoot)) return null

  const iosAppDir = path.resolve(appRoot, ADAPTV_DIR, "ios/App/App")
  //no iOS project yet — nothing to stamp, and creating the tree would be worse
  //than doing nothing (it would look like a half-initialised native project)
  if (!existsSync(path.resolve(appRoot, ADAPTV_DIR, "ios/App")))
    return null

  const plugins = installedPlugins(appRoot, input)
  const declared = [
    ...plugins.flatMap((pkg) =>
      shippedRequiredReasons(pkg, appRoot, input?.adaptvRoot),
    ),
    ...declaredRequiredReasons(input?.privacy),
  ]
  const contents = renderPrivacyManifest(
    resolveRequiredReasons(plugins, declared),
    input?.privacy,
  )
  const target = path.join(iosAppDir, MANIFEST_FILE)

  stamped.add(appRoot)
  if (existsSync(target) && readFileSync(target, "utf8") === contents) {
    //unchanged — do not rewrite, so Xcode's file watcher stays quiet and this
    //never shows up as a spurious diff
    return null
  }
  mkdirSync(iosAppDir, { recursive: true })
  writeFileSync(target, contents)
  return target
}

/** Test seam — drops the per-process memo so a second stamp actually writes. */
export function resetPrivacyManifestStamps(): void {
  stamped.clear()
}

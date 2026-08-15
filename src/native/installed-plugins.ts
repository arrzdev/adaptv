import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * One enumeration of what is compiled into the native binary, for the two
 * features that must never disagree about it.
 *
 * **adaptv's own plugins come first, and they are the reason this exists.** The
 * list used to be derived from the app's `package.json` alone, which reads right
 * and is wrong: adaptv OWNS Capacitor, so `@capacitor/device` and
 * `@capacitor/preferences` are *adaptv's* dependencies and appear nowhere in the
 * consumer's.
 *
 * ## 🔴 Two consumers, opposite tolerances — do not unify the filters
 *
 * | | `stamp-privacy.ts` | `ota/native-fingerprint.ts` |
 * |---|---|---|
 * | Answers | "what must I declare to Apple?" | "can this JS bundle run on this binary?" |
 * | Over-including | **safe** — a spurious declaration costs nothing | **fatal** — every JS-only dep bump refuses all OTA |
 * | Under-including | **fatal** — silent rejection at submission | **fatal** — a bundle calls a plugin that isn't there |
 *
 * So the privacy manifest deliberately takes {@link installedPlugins} whole,
 * including every app dependency, while the fingerprint narrows it through
 * {@link carriesNativeCode}. Same enumeration, different appetites — collapsing
 * them breaks whichever one you collapse toward, and the fingerprint direction
 * has no symptom until a user's device crashes.
 */

export type PackageJson = {
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  capacitor?: unknown
}

export function readPackageJson(dir: string | null): PackageJson | null {
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
export function adaptvRoots(given: string | undefined): string[] {
  const roots: string[] = []
  if (given) roots.push(given)
  try {
    roots.push(fileURLToPath(new URL("../..", import.meta.url)))
  } catch {}
  roots.push(process.cwd())
  return roots
}

/** A module path resolution can start from, inside adaptv's own tree. */
export function adaptvResolveFrom(given: string | undefined): string {
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
export function pluginDir(
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

/** What the enumeration needs to know about the app's own declarations. */
export type InstalledPluginsInput = {
  /** `adaptv.config.ts` `plugins` — native plugins adaptv does not ship. */
  plugins?: string[]
  /**
   * adaptv's own package root. **The CLI must pass this.** It loads these modules
   * by bundling them into a `data:` URL (`bin/lib/load-ts.mjs`), where
   * `import.meta.url` is not a file path and the self-locating fallback lands on
   * the app's own root — whose `package.json` has no `@capacitor/*` in it, which
   * is the entire bug this file exists to fix, reintroduced by the back door.
   * Vite imports the real module and can leave it out.
   */
  adaptvRoot?: string
}

/**
 * Every candidate package, widest first. **Deliberately over-inclusive** — tier 2
 * adds every app dependency, JS-only ones included. Narrow it with
 * {@link carriesNativeCode} if over-inclusion is not safe for your consumer, and
 * read the table above before deciding that it is.
 */
export function installedPlugins(
  appRoot: string,
  input: InstalledPluginsInput | undefined,
): string[] {
  const out = new Set<string>()

  //tier 1's real input: what adaptv itself bundles, read from its own manifest so a
  //plugin added to adaptv is covered without a second list to keep in step.
  //
  //⚠︎ Taken WHOLE, deliberately — no `@capacitor/` name filter. A prefix test scopes
  //adaptv to one vendor, and the plugin it would have dropped first is
  //`@capawesome/capacitor-live-update`: the OTA mechanism itself, invisible to the
  //very gate that decides whether a bundle may run against it. Over-inclusion is
  //what tier 2 already does with every app dependency, and it is safe for the same
  //reason — `carriesNativeCode` narrows it for the consumer that cannot tolerate it.
  for (const root of adaptvRoots(input?.adaptvRoot)) {
    const deps = readPackageJson(root)?.dependencies
    if (!deps) continue
    for (const name of Object.keys(deps)) out.add(name)
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

/**
 * Does this package actually contribute code to the native binary?
 *
 * The test is what the native build tools themselves key on: a `capacitor` field
 * in `package.json` (how a plugin declares itself to the native tooling) plus a
 * real platform source directory. Both, not either — `@capacitor/cli` has the
 * field and no platform tree, and a random package can have an `ios/` folder of
 * screenshots.
 *
 * A package that fails this test can still be *in* the JS bundle; it just cannot
 * change what the bundle is able to **call**, which is the only question the
 * fingerprint asks.
 */
export function carriesNativeCode(dir: string | null): boolean {
  if (!dir) return false
  const pkg = readPackageJson(dir)
  if (!pkg || pkg.capacitor === undefined) return false
  return (
    existsSync(path.join(dir, "ios")) ||
    existsSync(path.join(dir, "android"))
  )
}

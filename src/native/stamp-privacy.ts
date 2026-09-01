import type { Dirent } from "node:fs"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import type { InstalledPluginsInput } from "#adaptv/native/installed-plugins.ts"
import {
  installedPlugins,
  pluginDir,
} from "#adaptv/native/installed-plugins.ts"
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
export type PrivacyManifestInput = InstalledPluginsInput & {
  /** `adaptv.config.ts` `privacy` — what only the app can know. */
  privacy?: AdaptvPrivacyConfig
}

const MANIFEST_FILE = "PrivacyInfo.xcprivacy"

//The enumeration lives in `installed-plugins.ts` because the OTA fingerprint asks
//the same question of the same binary. It is taken WHOLE here, JS-only app deps
//included: over-declaring in a privacy manifest costs nothing, and under-declaring
//is rejected at submission with no useful message. The fingerprint narrows it
//instead — see the table in that module before making these agree.

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
 * the app. → `docs/decisions/register.md §5.0.1`
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

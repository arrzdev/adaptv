import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import {
  renderPrivacyManifest,
  resolveRequiredReasons,
} from "#nativ/native/privacy-manifest.ts"
import { NATIV_DIR } from "#nativ/vite/nativ-dir.ts"

/** App roots already stamped this process — see the note in the function. */
const stamped = new Set<string>()

/**
 * Write `.nativ/ios/App/App/PrivacyInfo.xcprivacy` from the app's installed
 * dependencies. → `DECISIONS.md §5.0.1`
 *
 * Runs on the capacitor build, alongside the capacitor.config stamp, because the
 * obligation is derivable from `package.json` and nothing else needs to happen
 * first. The alternative — the consumer hand-editing XML — fails silently at App
 * Store submission, days after the code was written.
 *
 * Idempotent: unchanged content is not rewritten, so it does not churn Xcode's
 * file watcher or show up as a spurious diff on every build.
 */
export function stampPrivacyManifest(appRoot: string): string | null {
  //`nativ()` is invoked once per Vite environment (client + ssr), so a naive
  //implementation logs the same line three times. Report only the first write.
  if (stamped.has(appRoot)) return null

  const iosAppDir = path.resolve(appRoot, NATIV_DIR, "ios/App/App")
  //no iOS project yet — nothing to stamp, and creating the tree would be worse
  //than doing nothing (it would look like a half-initialised native project)
  if (!existsSync(path.resolve(appRoot, NATIV_DIR, "ios/App"))) return null

  let dependencies: string[] = []
  try {
    const pkg = JSON.parse(
      readFileSync(path.resolve(appRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    dependencies = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]
  } catch {
    return null
  }

  const contents = renderPrivacyManifest(
    resolveRequiredReasons(dependencies),
  )
  const target = path.join(iosAppDir, "PrivacyInfo.xcprivacy")

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

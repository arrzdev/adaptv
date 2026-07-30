// The native project's STATE questions, as pure functions.
//
// Each of these was a bug first and a function second — they were inline predicates deep in
// the CLI, which is exactly why nothing caught them. They decide whether the project on disk
// still matches what the running command intends, and every one of them, when wrong, ships a
// working-looking build that does the wrong thing:
//
//   configIsStale()      → `preview` reusing a `dev` install, so the app opens on the
//                          "dev server isn't running" screen instead of the app.
//   podsNeedInstall()    → a Ctrl-C'd CocoaPods leaves `Pods/` with no lockfiles and every
//                          later build dead-ends on "sandbox is not in sync".
//   mergeClassList()     → adaptv's plugins compile but never register, so `SplashScreen.hide()`
//                          throws and the splash hangs forever.
//   mergeSettingsGradle()→ the Android equivalent, and it was worse: 12 of adaptv's 13 plugins
//                          were never even COMPILED into the app, so every native capability
//                          silently degraded to its web fallback.
//
// Pure and side-effect-free so `native-state.test.mjs` can assert the DECISION without a
// simulator, an Xcode toolchain, or a 30-second build.

/**
 * Does the config baked into the native project disagree with what this command intends?
 *
 * Only two fields matter, and both decide what the INSTALLED app does: `appId` (which app
 * this is) and whether a `server.url` is present (a `dev` live-reload shell vs a static
 * build). Everything else in the file is written by `cap sync` and adaptv's own plugin pass
 * (`packageClassList`, plugin settings), so comparing whole objects would report a
 * difference on every run and defeat the caches entirely.
 *
 * Unreadable/absent counts as stale: never reuse an install we can't vouch for.
 */
export function configIsStale(baked, want) {
  if (!baked || typeof baked !== "object") return true
  const intended = want ?? {}
  return (
    baked.appId !== intended.appId ||
    Boolean(baked.server?.url) !== Boolean(intended.server?.url)
  )
}

/**
 * Should `pod install` run?
 *
 * The obvious answer — "only when the Podfile changed" — is what stranded a project: an
 * interrupted CocoaPods run leaves `Pods/` present but its lockfiles missing, the Podfile
 * already correct, and xcodebuild refusing to build ("The sandbox is not in sync with the
 * Podfile.lock") with no way out but a manual `pod install`. So the sandbox being out of
 * sync is a second, independent reason to install.
 */
export function podsNeedInstall({
  podfileChanged,
  hasPodfileLock,
  hasManifestLock,
}) {
  if (podfileChanged) return true
  return !(hasPodfileLock && hasManifestLock)
}

/**
 * The plugin classes the native project must register: whatever `cap sync` discovered, plus
 * adaptv's own (which it cannot discover, because they're adaptv's dependencies and not the
 * consumer's). Order-stable and deduped — `cap` rewrites this list on every sync, so the
 * merge has to be idempotent or it grows without bound.
 */
export function mergeClassList(existing, adaptvClasses) {
  const out = []
  for (const name of [...(existing ?? []), ...(adaptvClasses ?? [])])
    if (name && !out.includes(name)) out.push(name)
  return out
}

/** Did the merge actually add anything? Lets the caller skip a pointless file write. */
export const classListChanged = (existing, merged) =>
  merged.length !== (existing ?? []).length

/* -----------------------------------------------------------------------------
 * Android: the same problem, three files
 *
 * iOS needs one edit (the Podfile) plus the class registry. Android needs three, and
 * missing ANY of them degrades differently — which is why they're separate functions
 * with separate tests rather than one "write the android files" blob:
 *
 *   capacitor.settings.gradle  → the Gradle module isn't in the build at all
 *   app/capacitor.build.gradle → the module builds but the app doesn't depend on it
 *   capacitor.plugins.json     → it ships in the APK but the bridge never registers it
 *
 * All three are rewritten from scratch by every `cap sync`, so every merge here has to
 * be idempotent AND self-healing: run twice, same file; run after a version bump, the
 * paths move with it.
 * -------------------------------------------------------------------------- */

/** Gradle module name for a plugin package — mirrors @capacitor/cli's `getGradlePackageName`
 * (`@capacitor/status-bar` → `capacitor-status-bar`). It has to match byte for byte: cap
 * writes the entries for the plugins IT found under these names, and a mismatch would
 * declare the same plugin twice under two module names. */
export const gradleProjectName = (pkgId) =>
  pkgId.replace("@", "").replace("/", "-")

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Declare each plugin's Gradle module in `capacitor.settings.gradle`.
 *
 * `entries` are `{ project, dir }` — the module name and its project directory, relative to
 * the android project and already unix-separated. An entry cap already wrote has its
 * `projectDir` REWRITTEN rather than skipped: the path points into pnpm's content-addressed
 * store, so it moves on every version bump, and the one code path that can reach a project
 * without a fresh `cap sync` (a cached sync) would otherwise keep a dead path forever.
 */
export function mergeSettingsGradle(existing, entries) {
  let out = existing ?? ""
  const added = []
  for (const { project, dir } of entries ?? []) {
    const decl = `project(':${project}').projectDir = new File('`
    if (out.includes(`include ':${project}'`)) {
      out = out.replace(
        new RegExp(`${escapeRe(decl)}[^']*'\\)`),
        `${decl}${dir}')`,
      )
      continue
    }
    added.push(`\ninclude ':${project}'\n${decl}${dir}')\n`)
  }
  //cap's own template ends each plugin block with a newline, so appending to a file that
  //already ends in one reproduces its exact shape (blank line, include, projectDir).
  return added.length
    ? `${out.replace(/\n*$/, "\n")}${added.join("")}`
    : out
}

/**
 * Make the app module depend on each plugin module, in `app/capacitor.build.gradle`.
 *
 * Inserted at the top of the existing `dependencies` block rather than by rewriting the
 * file: cap also puts the Cordova framework lines and `cordova.variables.gradle` in there,
 * and a regenerated-from-scratch version would drop them.
 */
export function mergeCapacitorBuildGradle(existing, projects) {
  const src = existing ?? ""
  const missing = (projects ?? []).filter(
    (p) => !src.includes(`implementation project(':${p}')`),
  )
  if (missing.length === 0) return src
  const lines = missing
    .map((p) => `    implementation project(':${p}')`)
    .join("\n")
  return src.replace(/dependencies\s*\{/, (m) => `${m}\n${lines}`)
}

/**
 * The bridge's runtime plugin registry (`app/src/main/assets/capacitor.plugins.json`) —
 * Android's answer to iOS's `packageClassList`. Deduped by classpath and order-stable, for
 * the same reason `mergeClassList` is: cap rewrites the file on every sync, so a merge that
 * isn't idempotent grows without bound.
 */
export function mergePluginsJson(existing, entries) {
  const out = []
  const seen = new Set()
  for (const e of [...(existing ?? []), ...(entries ?? [])]) {
    if (!e?.classpath || seen.has(e.classpath)) continue
    seen.add(e.classpath)
    out.push({ pkg: e.pkg, classpath: e.classpath })
  }
  return out
}

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

// The CLI's half of the build stamp — the note every vite build leaves behind saying where
// it wrote and which config it was run under. The stamp itself, and the reasoning for it,
// live in `src/vite/build-stamp.ts`; this file only reaches them.
//
// Loaded through `loadAdaptvModule` rather than reimplemented here for the usual reason:
// the writer and the reader of one file must not be two implementations. The CLI already
// pays for this bundler on every native command (`setCapacitorConfigEnv`), and the module
// is tiny.
import { appConfigFingerprint } from "./fingerprint.mjs"
import { loadAdaptvModule } from "./load-ts.mjs"

const stampModule = () => loadAdaptvModule("vite/build-stamp.ts")

/**
 * The env additions every vite build the CLI runs must carry.
 *
 * This is the whole fix for the split signal. `appConfigFingerprint` already decides
 * whether the native project's generated assets — the iOS splash colourset, Android's
 * `colors.xml` — are re-derived. Handing the SAME value to the bundle's build makes it the
 * one signal both halves of the app answer to, instead of two that could disagree.
 */
export async function buildIdEnv(appRoot, config) {
  const { BUILD_ID_ENV } = await stampModule()
  return { [BUILD_ID_ENV]: appConfigFingerprint(appRoot, config) }
}

/**
 * Where the last `target` build actually wrote, app-root-relative — or `null` when it left
 * no stamp. Callers must print `null` as nothing rather than guessing: naming a directory
 * the command did not write is the failure this replaces.
 */
export async function builtOutDir(appRoot, target) {
  const { readBuildStamp } = await stampModule()
  return readBuildStamp(appRoot, target)?.outDir ?? null
}

/** Would a sync now copy a bundle that this config did not produce? */
export async function bundleStale(appRoot, target, config) {
  const { bundleIsStale } = await stampModule()
  return bundleIsStale(
    appRoot,
    target,
    appConfigFingerprint(appRoot, config),
  )
}

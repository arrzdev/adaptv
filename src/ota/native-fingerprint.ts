import { createHash } from "node:crypto"
import type { InstalledPluginsInput } from "#adaptv/native/installed-plugins.ts"
import {
  carriesNativeCode,
  installedPlugins,
  pluginDir,
  readPackageJson,
} from "#adaptv/native/installed-plugins.ts"

/**
 * The OTA compatibility gate — a hash of everything a JS bundle can *call*.
 * → `docs/design/ota.md §5.3`
 *
 * An OTA bundle never passes review and never gets a staged rollout, so this is
 * the only thing standing between "shipped a bundle that calls a plugin the
 * installed binary lacks" and a crash on a user's device. It is a
 * **compatibility** check, not a version check.
 *
 * ## 🔴 This is not `nativeFingerprint()` from `bin/lib/fingerprint.mjs`
 *
 * That one is a **build-cache key**: it hashes icons, the config, the pbxproj —
 * everything that should force a native rebuild. Using it here would refuse every
 * OTA update after an icon tweak, which is the failure mode nobody reports because
 * it looks like "OTA just doesn't work".
 *
 * This one hashes only the callable surface. Two functions, one name, opposite
 * tolerances for change. Whoever unifies them breaks the gate in the direction
 * that stays silent until a device crashes.
 *
 * ## What is deliberately NOT in here
 *
 * Icons, splash art, the app name, `pbxproj` churn, build numbers. All of them
 * change the binary; none of them change what the JS can call. Including them
 * would freeze OTA on cosmetic edits, which is precisely the store-release
 * treadmill adaptv exists to remove.
 */

/** The inputs, all of which must be reproducible on any machine. */
export type NativeFingerprintInput = InstalledPluginsInput & {
  /** The app's bundle identifier — `native.appId`. */
  appId: string
}

/** What went into a fingerprint, for diagnosis and for the build warning. */
export type NativeFingerprintResult = {
  /** The hash itself — this is what ships in the manifest and the binary. */
  fingerprint: string
  /** `name@version` for every package that contributes native code, sorted. */
  plugins: string[]
  appId: string
}

/**
 * Compute the fingerprint of the native surface.
 *
 * Deterministic by construction: the plugin list is sorted, versions are read
 * from each package's own `package.json` (not from a lockfile, which differs
 * between install strategies), and nothing about the host machine — paths, times,
 * cwd — reaches the hash. Two machines building the same commit must agree, or
 * the gate refuses updates it should accept.
 */
export function computeNativeFingerprint(
  appRoot: string,
  input: NativeFingerprintInput,
): NativeFingerprintResult {
  const plugins: string[] = []

  for (const name of installedPlugins(appRoot, input)) {
    const dir = pluginDir(name, appRoot, input.adaptvRoot)
    //The narrowing that separates this from the privacy manifest: a package that
    //ships no native code cannot change what the bundle is able to call, so a
    //bump of it must NOT refuse an update.
    if (!carriesNativeCode(dir)) continue
    const version = readPackageJson(dir)?.version ?? "0.0.0"
    plugins.push(`${name}@${version}`)
  }

  plugins.sort()

  //`appId` is in the hash because a bundle built for one application identity has
  //no business booting inside another — that is a mis-wired channel, not an
  //update, and it is worth refusing loudly.
  const payload = JSON.stringify({ appId: input.appId, plugins })

  return {
    fingerprint: createHash("sha256").update(payload).digest("hex"),
    plugins,
    appId: input.appId,
  }
}

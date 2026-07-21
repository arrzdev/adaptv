/**
 * OTA update policy — the pure decisions. → `LIFECYCLE.md §5` (L13)
 *
 * Deliberately free of plugin calls, filesystem and network: *when* to apply an
 * update, *whether* a bundle may be trusted, and *what* to roll back to are
 * policy questions with unpleasant failure modes, and they should be decidable
 * (and testable) without a device in the loop.
 *
 * The mechanism — download, unpack, pointer-flip — is rented from
 * `@capawesome/capacitor-live-update`. Own the policy, rent the swap.
 */

export type BundleState = "pending" | "active" | "known-good" | "failed"

export type Bundle = {
  buildTag: string
  state: BundleState
  /** Native fingerprint the bundle was built against. */
  nativeFingerprint: string
}

export type UpdateManifest = {
  buildTag: string
  url: string
  sha256: string
  /** The native fingerprint this bundle requires. */
  nativeFingerprint: string
  /** Optional signature over the manifest, verified against an app-held key. */
  signature?: string
}

export type UpdateDecision =
  | { action: "install"; reason: string }
  | { action: "skip"; reason: string }

/**
 * Whether a published bundle may be installed.
 *
 * The **fingerprint gate is the important one.** A JS bundle is built against a
 * specific set of native plugins; shipping one that calls a plugin the installed
 * binary does not contain produces a crash on a user's device that no amount of
 * JS-side error handling can prevent — and OTA bundles never pass through review
 * or a staged rollout, so there is no safety net upstream of this check.
 */
export function decideUpdate(options: {
  manifest: UpdateManifest
  currentBuildTag: string
  /** Fingerprint of the *installed native binary*. */
  nativeFingerprint: string
  /** Whether the app requires manifests to be signed. */
  requireSignature: boolean
}): UpdateDecision {
  const {
    manifest,
    currentBuildTag,
    nativeFingerprint,
    requireSignature,
  } = options

  if (manifest.buildTag === currentBuildTag) {
    return { action: "skip", reason: "already running this build" }
  }

  if (manifest.nativeFingerprint !== nativeFingerprint) {
    //Not a version check — a compatibility check. The bundle expects native code
    //this binary does not have.
    return {
      action: "skip",
      reason:
        "native fingerprint mismatch — this bundle was built against a different set of native plugins",
    }
  }

  if (requireSignature && !manifest.signature) {
    //Signing is mandatory by default (§5.4d): without it, anyone who can write
    //to the CDN can push arbitrary JavaScript into every installed app.
    return {
      action: "skip",
      reason:
        "manifest is unsigned and signature verification is required",
    }
  }

  if (!/^[a-f0-9]{64}$/i.test(manifest.sha256)) {
    return { action: "skip", reason: "manifest has no valid sha256" }
  }

  return { action: "install", reason: "newer build, compatible native" }
}

/**
 * Whether a freshly-applied bundle has proved itself.
 *
 * The shell pings "app ready" after a successful boot. A bundle that never pings
 * is assumed broken — which is the only assumption that is safe, because the
 * alternative is an app that cannot start and cannot update itself out of that
 * state.
 */
export function hasProvenItself(options: {
  state: BundleState
  readyPingReceived: boolean
}): boolean {
  return options.state === "pending" && options.readyPingReceived
}

/**
 * Which bundle to boot.
 *
 * A `pending` bundle gets exactly one chance. If it failed to ping last time it
 * is marked `failed`, and this returns the last **known-good** bundle instead —
 * never the failed one, and never nothing.
 */
export function selectBootBundle(
  bundles: readonly Bundle[],
): Bundle | null {
  const pending = bundles.find((b) => b.state === "pending")
  if (pending) return pending

  const active = bundles.find((b) => b.state === "active")
  if (active) return active

  //fall back to the newest known-good; `null` means "boot the built-in bundle",
  //which is always present in the app binary
  const good = bundles.filter((b) => b.state === "known-good")
  return good[good.length - 1] ?? null
}

/**
 * Which bundles may be deleted after a successful boot.
 *
 * Keeps the booting bundle and **at least one** known-good behind it. That
 * retention is not tidiness — it is the thing rollback rolls back *to*. Pruning
 * it converts a bad deploy into a bricked app with no recovery path, which is
 * the one failure OTA must never have. → `LIFECYCLE.md §5.4b`
 */
export function selectPrunableBundles(
  bundles: readonly Bundle[],
  activeBuildTag: string,
  keepKnownGood = 1,
): string[] {
  const knownGood = bundles
    .filter(
      (b) => b.state === "known-good" && b.buildTag !== activeBuildTag,
    )
    .map((b) => b.buildTag)

  //newest known-good entries are at the end; retain that tail
  const retained = keepKnownGood > 0 ? knownGood.slice(-keepKnownGood) : []

  return bundles
    .filter((b) => b.buildTag !== activeBuildTag)
    .filter((b) => !retained.includes(b.buildTag))
    .map((b) => b.buildTag)
}

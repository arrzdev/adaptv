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
 *
 * ## 🔴 Nothing here verifies a signature, and nothing here should
 *
 * This module runs in the WebView — inside the bundle an attacker is trying to
 * replace. A check performed by the code under attack is not a check. So the
 * rules below require the signature to be **present and well-formed** and pass it
 * down; verification happens natively, against a key that can only change through
 * a store release. This is written here because this file reads like the obvious
 * place to put it. → `LIFECYCLE.md §5.4d`
 */

export type BundleState = "pending" | "active" | "known-good" | "failed"

export type Bundle = {
  buildTag: string
  state: BundleState
  /**
   * Identity of the app binary this bundle reached `known-good` under —
   * `versionName+versionCode`, straight from the OS. Absent until it boots.
   *
   * This is **evidence**, where the native fingerprint that used to live here was
   * an inference. → `proven` in `#adaptv/ota/ledger`
   */
  provenOn?: string
}

export type UpdateManifest = {
  buildTag: string
  url: string
  sha256: string
  /** The native fingerprint this bundle requires. */
  nativeFingerprint: string
  /**
   * When the channel published this build, as epoch milliseconds.
   *
   * Load-bearing against replay, and only meaningful **inside** the signed
   * envelope — see {@link decideUpdate}.
   */
  createdAt: number
  /**
   * Signature over the **zip**, verified natively against an app-held key.
   * Presence is checked here; validity is not (see the module note).
   */
  signature?: string
  /**
   * Signature over the manifest's own canonical form — the fields the zip's
   * signature cannot cover, `createdAt` above all. Without it a genuine older
   * bundle can be replayed under a fresh timestamp and every native check still
   * passes. → `#adaptv/ota/manifest-signing`
   */
  manifestSignature?: string
}

/**
 * What to do with a bundle built against a different set of native plugins than
 * the installed binary has. → `LIFECYCLE.md §5.6`
 *
 * ## `"install"` — the default, and the one adaptv is built around
 *
 * The bundle installs and runs; the parts of it that need native code this app
 * does not have report themselves as unavailable, through the `supported` every
 * adaptv capability hook already returns. **Every fix ships**, including the ones
 * that happen to sit in the same release as a native change — which is the whole
 * promise of "once the app is in the store, everything is OTA".
 *
 * The cost is real and worth naming: a feature can be dark on an old install, and
 * only the app can explain that to a user. adaptv makes the state askable
 * (a capability's `supported`, `useStoreRelease`) and declines to invent the copy.
 *
 * ⚠︎ A native call made at module scope is the one thing this policy cannot
 * protect. Importing a Capacitor plugin is safe — it builds a proxy and nothing
 * more — but *calling* one while the module evaluates rejects before the app tree
 * exists, and a bundle that cannot boot is rolled back by the watchdog. That is
 * the net working, and the user still watched a launch fail. Ask first.
 *
 * ## `"refuse"` — for an app whose bundle cannot survive the gap
 *
 * The update is not downloaded at all and the install stays on the last bundle
 * that matched it, until a store release moves it. Right when the release changed
 * a contract the JS cannot work around — a server API, an auth flow, a data shape
 * — because a bundle that would only fail differently is not worth shipping.
 */
export type NativeSkewPolicy = "install" | "refuse"

export type UpdateDecision =
  | {
      action: "install"
      reason: string
      /**
       * Whether this bundle was built against a different native layer than the
       * installed binary has. `true` still installs under `"install"`; it is the
       * app's cue that some features will report unavailable.
       */
      nativeSkew: boolean
    }
  | { action: "skip"; reason: string }
  /** A newer bundle exists upstream, and this policy will not run it here. */
  | { action: "needs-store-release"; reason: string }

/**
 * Whether a published bundle may be installed.
 *
 * The **fingerprint comparison is the interesting one**, and it is a comparison
 * rather than a gate: a JS bundle is built against a specific set of native
 * plugins, and it can legitimately land on an app that has fewer of them. What
 * happens then is {@link NativeSkewPolicy}'s decision, not this function's.
 *
 * ⚠︎ `nativeFingerprint` must be **the binary's** — `binaryFingerprint()` — and
 * not the running bundle's baked-in constant. Once one skewed bundle installs the
 * two stop being the same value, and comparing against the bundle's own reports
 * every later build as compatible. → `LIFECYCLE.md §5.6`
 */
export function decideUpdate(options: {
  manifest: UpdateManifest
  currentBuildTag: string
  /** Fingerprint of the *installed native binary*. */
  nativeFingerprint: string
  /** What to do when the bundle was built against a different native layer. */
  nativeSkew: NativeSkewPolicy
  /** Whether the app requires manifests to be signed. */
  requireSignature: boolean
  /**
   * Build tags this device has already blocked — bundles that caused a rollback.
   *
   * **Without this there is a boot loop**, and it is not a rare one: roll back to
   * A → launch → check → the channel still advertises B, because a rollback is a
   * local event the server knows nothing about → download B → crash → roll back,
   * every single launch, until someone deploys.
   *
   * With no server-side kill switch by design (a second source of truth about
   * "what is current" would compete with the host's own release management), this
   * list **is** the kill switch, scoped to the device that actually observed the
   * failure. Both ways out still work: a fix is a new tag, which is not blocked;
   * promoting the previous deploy re-advertises a tag already cached and proven.
   */
  blockedBuildTags: readonly string[]
  /** `createdAt` of the build this device is running, if it knows it. */
  currentCreatedAt?: number
}): UpdateDecision {
  const {
    manifest,
    currentBuildTag,
    nativeFingerprint,
    nativeSkew: skewPolicy,
    requireSignature,
    blockedBuildTags,
    currentCreatedAt,
  } = options

  if (manifest.buildTag === currentBuildTag) {
    return { action: "skip", reason: "already running this build" }
  }

  if (blockedBuildTags.includes(manifest.buildTag)) {
    return {
      action: "skip",
      reason: "this build already failed to start on this device",
    }
  }

  //Not a version check — the bundle expects a different set of native plugins
  //than this binary carries. Under `"install"` that is a fact to report, not a
  //reason to refuse; under `"refuse"` it is where the update stops.
  const nativeSkew = manifest.nativeFingerprint !== nativeFingerprint
  if (nativeSkew && skewPolicy === "refuse") {
    //Distinct from `skip` because there IS an update and the app may want to say
    //so; it just will not arrive over the air.
    return {
      action: "needs-store-release",
      reason:
        "this build was made for a different set of native plugins than the installed app has",
    }
  }

  if (
    requireSignature &&
    !(manifest.signature && manifest.manifestSignature)
  ) {
    //Signing is mandatory by default (§5.4d): without it, anyone who can write
    //to the CDN can push arbitrary JavaScript into every installed app.
    //
    //BOTH are required, and neither substitutes for the other. The zip signature
    //is the one verified natively and the only thing that keeps attacker code out
    //of the app; the manifest signature is the only thing covering `createdAt`,
    //without which a genuine old bundle can be replayed as if it were new. An
    //update carrying one and not the other is not "partly signed" — it is missing
    //exactly one of the two defences, so it is refused like an unsigned one.
    return {
      action: "skip",
      reason:
        "manifest is unsigned and signature verification is required",
    }
  }

  //Replay defence. It only holds because `createdAt` lives INSIDE the signed
  //envelope: signing the zip alone would leave this field free to rewrite, and an
  //attacker could then replay a genuine old bundle with a fresh timestamp and a
  //genuine signature — a signed downgrade, with both defences switched on.
  if (
    currentCreatedAt !== undefined &&
    manifest.createdAt <= currentCreatedAt
  ) {
    return {
      action: "skip",
      reason: "this build is not newer than the one already installed",
    }
  }

  if (!/^[a-f0-9]{64}$/i.test(manifest.sha256)) {
    return { action: "skip", reason: "manifest has no valid sha256" }
  }

  return {
    action: "install",
    nativeSkew,
    reason: nativeSkew
      ? "newer build, made for a native layer this app does not have"
      : "newer build, compatible native",
  }
}

/**
 * 🔴 **Choosing which bundle boots is not a decision this module gets to make**,
 * and there was once a `selectBootBundle` here that read as though it were.
 *
 * The pointer is resolved in native code before a line of JavaScript runs, so by
 * the time anything here could have an opinion, the bundle it would be choosing
 * between is already the one executing. The same goes for "did it prove itself":
 * the proof is that this code is running at all, which is why `settleLaunch`
 * marks the current bundle rather than asking a predicate about a ping.
 *
 * What adaptv can decide is where the *next* launch lands, which is what
 * `selectRollbackTarget` below is for.
 */

/**
 * Where to land when a bundle fails to prove itself.
 *
 * The rented plugin's answer is "the embedded bundle", unconditionally, and under
 * adaptv's model that is the wrong one: the embedded bundle is from the last
 * store release, which by design may be a year old. One bad deploy would throw
 * every device back a year, and a device happily running last week's bundle would
 * lose it over a defect it never met.
 *
 * `null` means the embedded bundle — the floor, and the last resort rather than
 * the first. → `LIFECYCLE.md §5.5` (the plugin patch that makes this reachable)
 *
 * ⚠︎ `binaryIdentity` is the app the candidate has to have **booted on**, which
 * is not the same as the app it was built for. Under the default skew policy a
 * bundle can be built for a native layer this binary does not have and still be
 * the newest thing known to start here — and that is precisely the bundle a
 * rollback wants.
 */
export function selectRollbackTarget(
  bundles: readonly Bundle[],
  binaryIdentity: string,
  blockedBuildTags: readonly string[] = [],
): string | null {
  const candidates = bundles.filter(
    (b) =>
      b.state === "known-good" &&
      b.provenOn === binaryIdentity &&
      !blockedBuildTags.includes(b.buildTag),
  )
  return candidates[candidates.length - 1]?.buildTag ?? null
}

/**
 * Which bundles may be deleted after a successful boot.
 *
 * Keeps the booting bundle and **at least one** known-good behind it. That
 * retention is not tidiness — it is the thing rollback rolls back *to*. Pruning
 * it converts a bad deploy into a bricked app with no recovery path, which is
 * the one failure OTA must never have. → `LIFECYCLE.md §5.4b`
 *
 * ⚠︎ The retained bundle is the newest one that **booted on this binary**, which
 * under the default skew policy is often a bundle built for a native layer the
 * app does not have. Retaining by build compatibility instead would delete every
 * bundle since the native change and keep the one from before it — the device
 * would hold a cushion years old and re-download the current build on every
 * rollback.
 */
export function selectPrunableBundles(
  bundles: readonly Bundle[],
  activeBuildTag: string,
  binaryIdentity: string,
  keepKnownGood = 1,
): string[] {
  const knownGood = bundles
    .filter(
      (b) =>
        b.state === "known-good" &&
        b.buildTag !== activeBuildTag &&
        b.provenOn === binaryIdentity,
    )
    .map((b) => b.buildTag)

  //newest known-good entries are at the end; retain that tail
  const retained = keepKnownGood > 0 ? knownGood.slice(-keepKnownGood) : []

  return bundles
    .filter((b) => b.buildTag !== activeBuildTag)
    .filter((b) => !retained.includes(b.buildTag))
    .map((b) => b.buildTag)
}

export type FirstLaunchPlan =
  /** Boot now. Either there is nothing to fetch, or nothing fetchable helps. */
  | { action: "boot-now"; reason: string }
  /** Hold the covering surface and apply before the app tree mounts. */
  | { action: "wait"; reason: string; budgetMs: number }

/**
 * Whether the very first launch should wait for the update before mounting.
 *
 * **Everywhere else, blocking on a network check is the wrong trade** and every
 * mature OTA product says so. First launch is the exception, and it is one
 * adaptv's own model creates: if store releases only happen when the native layer
 * changes, the embedded bundle can be arbitrarily old by the time someone
 * installs. Without this, a user installing after fifty deploys gets the year-old
 * onboarding, uses it, and watches the app change under them on the second
 * launch. That is not a stale cache — it is showing a new user a product that no
 * longer exists.
 *
 * The narrowness is the safety: this can only fire when **nothing runnable is
 * cached**, which is true exactly once per install.
 */
export function decideFirstLaunch(options: {
  decision: UpdateDecision
  /** Bundles already on disk that match the device's fingerprint. */
  runnableCachedBundles: number
  budgetMs: number
}): FirstLaunchPlan {
  const { decision, runnableCachedBundles, budgetMs } = options

  if (runnableCachedBundles > 0) {
    return {
      action: "boot-now",
      reason: "a runnable bundle is already on disk",
    }
  }

  if (decision.action === "needs-store-release") {
    //Whoever installs during the store review window: the binary is the old
    //fingerprint, the channel already advertises the new one. Waiting cannot
    //produce anything this device is allowed to run.
    return {
      action: "boot-now",
      reason: "the published build needs a newer app than this one",
    }
  }

  if (decision.action !== "install") {
    return { action: "boot-now", reason: decision.reason }
  }

  return {
    action: "wait",
    reason:
      "first launch with nothing cached — the built-in build may be old",
    budgetMs,
  }
}

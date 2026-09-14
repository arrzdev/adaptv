import { CapacitorHttp } from "@capacitor/core"
import { onResume } from "#adaptv/capabilities/app-state"
import {
  binaryFingerprint,
  createdAtOf,
  forget,
  lastSeenBinary,
  markState,
  proven,
  readLedger,
  recordStaged,
  rememberBinary,
} from "#adaptv/ota/ledger"
import { verifyManifestSignature } from "#adaptv/ota/manifest-signing"
import type { NativeSkewPolicy, UpdateManifest } from "#adaptv/ota/policy"
import {
  decideFirstLaunch,
  decideUpdate,
  selectPrunableBundles,
  selectRollbackTarget,
} from "#adaptv/ota/policy"
import {
  clearStoreRelease,
  noteStoreReleaseRequired,
} from "#adaptv/ota/store-release"
import { isNativePlatform } from "#adaptv/utils/platform"
import type { PluginBox } from "#adaptv/utils/plugin-box"
import { boxPlugin, NO_PLUGIN } from "#adaptv/utils/plugin-box"

export type OtaOptions = {
  /** Where the manifest is published — the app's own deploy, no third-party backend. */
  manifestUrl: string
  /**
   * The native fingerprint **this bundle** was built against.
   *
   * A fallback, not the answer: the device prefers the binary's own fingerprint
   * from the ledger, and only falls back to this when it has not learnt one yet —
   * which is a launch on the embedded bundle, where the two are the same value.
   */
  nativeFingerprint: string
  /** What to do when a bundle was built against a different native layer. */
  nativeSkew?: NativeSkewPolicy
  /** Default `true`. Only disable if you control the CDN end to end. */
  requireSignature?: boolean
  /**
   * The app's OTA public key (SPKI PEM), baked into the store binary.
   *
   * The same key the plugin verifies the zip with natively. This copy verifies
   * the manifest's own signature, which is the only thing covering `createdAt`.
   */
  publicKey?: string | null
  /**
   * How often to look again **while the app stays in the foreground**, in ms.
   * `0` is launch + resume only. Resolved at build time from `otaPollMinutes`
   * (default 60 minutes — `ota/build/ota-config-module.ts`, `DEFAULT_OTA_POLL_MINUTES`)
   * and always supplied by `useOtaUpdates`; the `?? 0` in `armPoll` is the
   * no-timer fallback for a direct caller, not a default this module picks.
   */
  pollIntervalMs?: number
  /** Called when a bundle has been downloaded and will apply at next cold start. */
  onUpdateReady?: (buildTag: string) => void
  /**
   * Called when the channel has moved past this binary — a published build was
   * made against a native layer the installed app does not have.
   *
   * It fires under **both** skew policies, because it is the same fact either
   * way; only the consequence differs. Under `"refuse"` the install is frozen at
   * its last matching bundle. Under `"install"` — the default — the bundle is
   * running, and what is frozen is the native half of whatever it needs: the
   * features that reach for it report unavailable until a store release lands.
   *
   * Extra to the state this already keeps: every launch that reaches this answer
   * also records it in `store-release.ts`, which is what `useStoreRelease` reads.
   * The callback is for apps that want the event as well — telemetry, mostly.
   */
  onStoreReleaseRequired?: (buildTag: string) => void
}

type LiveUpdatePlugin = {
  downloadBundle(options: {
    url: string
    bundleId: string
    checksum?: string
    /**
     * Verified NATIVELY, against a key in the store binary. Passing it is the
     * whole defence: a check run by the code an attacker is replacing is not a
     * check. → `docs/design/ota.md §5.4d`
     */
    signature?: string
  }): Promise<void>
  setNextBundle(options: { bundleId: string }): Promise<void>
  deleteBundle(options: { bundleId: string }): Promise<void>
  getDownloadedBundles(): Promise<{ bundleIds: string[] }>
  getBlockedBundles(): Promise<{ bundleIds: string[] }>
  /** `null` means the bundle embedded in the store binary. */
  getCurrentBundle(): Promise<{ bundleId: string | null }>
  getNextBundle(): Promise<{ bundleId: string | null }>
  /** Point the next launch back at the bundle inside the binary. */
  reset(): Promise<void>
  /** The installed binary's identity, straight from the OS. */
  getVersionCode(): Promise<{ versionCode: string }>
  getVersionName(): Promise<{ versionName: string }>
  /** Swap to the staged bundle now, replacing the document. */
  reload(): Promise<void>
  /**
   * Reports what the watchdog decided at THIS launch — including `rollback`, i.e.
   * the bundle staged last time failed to start and was reverted.
   */
  ready(): Promise<{
    previousBundleId: string | null
    currentBundleId: string | null
    rollback: boolean
  }>
}

/**
 * Stands in for "the bundle that shipped in the binary", which has no build tag.
 *
 * A published tag is a hex content hash, so it can never collide with this — and
 * the comparison it feeds must not accidentally match, or the app would decide it
 * is already running the update it has never downloaded.
 */
const EMBEDDED_BUILD_TAG = "\u0000embedded"

/**
 * How long a first launch may hold the splash waiting for the current build.
 *
 * Short on purpose. The wait is worth having (§5.4a: the embedded bundle can be
 * many deploys old by the time someone installs), but every millisecond of it is
 * spent on a user staring at a launch screen — so the budget is a ceiling, not a
 * target, and blowing through it boots the embedded bundle rather than waiting
 * for a slow network to finish being slow.
 */
const FIRST_LAUNCH_BUDGET_MS = 5000

/**
 * Read the manifest — **natively**, not with `fetch`.
 *
 * In production the app's origin is `capacitor://localhost` (iOS) or
 * `https://localhost` (Android), and the manifest is a static file on the app's
 * own web host. A static host does not send `Access-Control-Allow-Origin`, so a
 * plain `fetch` is blocked by CORS and the update check fails on every device
 * while working perfectly in a browser tab — the worst shape a bug can have.
 *
 * `CapacitorHttp` performs the request in native code, outside the WebView's
 * origin rules. `bin/lib/offline-page.mjs` already leans on the same property for
 * the same reason.
 */
async function fetchManifest(url: string): Promise<UpdateManifest | null> {
  const response = await CapacitorHttp.get({
    url,
    //an update manifest must never be served from cache: the whole point is to
    //learn that something changed
    headers: { "Cache-Control": "no-cache" },
  })
  if (response.status < 200 || response.status >= 300) return null
  return typeof response.data === "string"
    ? (JSON.parse(response.data) as UpdateManifest)
    : (response.data as UpdateManifest)
}

let pluginPromise: Promise<PluginBox<LiveUpdatePlugin>> | null = null

/**
 * Load the update plugin lazily and at most once.
 *
 * 🔴 **Two separate traps live in these four lines**, and both of them failed the
 * same way — the update check simply never happened, with nothing logged and
 * nothing thrown.
 *
 * **1. The specifier must stay a literal, never `@vite-ignore`.** It was
 * `import(/* @vite-ignore *\/ MODULE_CONSTANT)`, and Vite leaves an unanalysable
 * (or ignored) specifier in the output verbatim — so the shipped bundle asked the
 * WebView to resolve a bare `@capawesome/capacitor-live-update`, which it cannot.
 * A literal lets Vite bundle the plugin into its own lazy chunk: off the web
 * build's critical path, and actually present on native.
 *
 * **2. The plugin must come back in a box, never as the resolution value.** A
 * Capacitor plugin is a `Proxy` that answers `then` with a callable, so returning
 * it from this `.then` makes the promise try to adopt it as a thenable and hang
 * for ever. → `#adaptv/utils/plugin-box`, which explains it in full.
 */
function loadPlugin(): Promise<PluginBox<LiveUpdatePlugin>> {
  pluginPromise ??= import("@capawesome/capacitor-live-update")
    .then((mod) =>
      boxPlugin<LiveUpdatePlugin>(
        (mod as { LiveUpdate?: LiveUpdatePlugin }).LiveUpdate,
      ),
    )
    .catch(() => NO_PLUGIN)
  return pluginPromise
}

let holdRelease: (() => void) | null = null
let holdPromise: Promise<void> | null = null

/**
 * Resolves when it is safe to reveal the app on a **first** launch.
 *
 * The shell awaits this before handing the native splash over, so the wait is
 * spent under a full-screen native view rather than on a mounted app that then
 * changes underneath the user. Resolves immediately on every launch that is not
 * the first, on the web, and whenever OTA is off — the hold only exists while
 * `startOtaUpdates` says it should.
 */
export function firstLaunchHold(): Promise<void> {
  return holdPromise ?? Promise.resolve()
}

function releaseHold(): void {
  holdRelease?.()
  holdRelease = null
}

/**
 * Whether the app is still behind its launch screen.
 *
 * 🔴 The only condition under which a bundle may be applied *without* a cold
 * start: nothing is on screen to tear, and nothing the user did is lost. Every
 * release path clears `holdRelease`, including the budget timer, so this goes
 * false the moment the app becomes visible — which is the moment applying in
 * place stops being free. → `decideFirstLaunch`
 */
function launchScreenStillUp(): boolean {
  return holdRelease !== null
}

/**
 * Settle the launch: confirm this bundle works, absorb a rollback, prune.
 *
 * ## The ready ping is the half that is easy to lose
 *
 * `plugin.ready()` is the watchdog's "app reached the user" signal. A freshly
 * applied bundle that never pings is reverted at the next launch, **by design**,
 * because a bundle that cannot boot cannot update itself out of that state. So
 * dropping this call does not disable the watchdog, it *inverts* it: every update
 * rolls itself back one launch later, and the symptom is indistinguishable from
 * updates that never install.
 *
 * ## What it does with the answer
 *
 * `ready()` also reports whether *this* launch was a rollback. That is the only
 * moment the device learns a bundle is bad, and it is a local event no server
 * ever hears about — so it is recorded here or not at all.
 *
 * 🔴 The plugin's rollback lands on the **embedded** bundle, unconditionally. In
 * adaptv's model that is the wrong floor: store releases happen only when the
 * native layer changes, so the embedded bundle may be a year old, and one bad
 * deploy would throw every device back that far — including devices that were
 * happily running last week's build. adaptv cannot change where the plugin lands
 * *this* launch, but it can decide where the next one goes, so it re-points at
 * the newest known-good bundle (`selectRollbackTarget`). The cost is one session
 * on the embedded bundle; the alternative is staying there until someone deploys.
 */
export async function settleLaunch(options: {
  nativeFingerprint: string
}): Promise<void> {
  if (!isNativePlatform()) return
  try {
    const { plugin } = await loadPlugin()
    if (!plugin) return

    //Before anything else: a store release invalidates every cached bundle, and
    //the running one cannot work that out about itself.
    if (await returnToEmbedded(plugin, options.nativeFingerprint)) return

    //Written by the call above, so it is the binary this launch is running on —
    //or, after a reset the plugin refused, still the one before it, so a bundle
    //that could not be dropped proves nothing about the app that replaced it.
    //Everything below is scoped to it: what booted here, what may be kept, what
    //is safe to fall back to. A bundle proved itself on ONE app, not for ever.
    const identity = lastSeenBinary() ?? ""

    const outcome = await plugin.ready().catch(() => null)
    const current = outcome?.currentBundleId ?? null

    if (outcome?.rollback) {
      //`previousBundleId` is the one that was in place before the revert — i.e.
      //the bundle that just failed to start.
      if (outcome.previousBundleId) {
        markState(outcome.previousBundleId, "failed")
      }
      const blocked = await plugin
        .getBlockedBundles()
        .then((r) => r.bundleIds)
        .catch(() => [] as string[])
      const target = selectRollbackTarget(
        proven(identity),
        identity,
        blocked,
      )
      if (target && target !== current) {
        await plugin.setNextBundle({ bundleId: target }).catch(() => {})
      }
    }

    //It booted, and the app tree mounted. That is the whole definition — and it
    //is evidence about THIS binary, which is why the identity is recorded with it.
    if (current) markState(current, "known-good", identity)

    await prune(plugin, current, identity)
  } catch {
    //Nothing here is worth failing a launch over. The app is already on screen.
  }
}

/**
 * After a store release, drop back to the bundle inside the new binary.
 * Returns whether it acted — in which case the document is already being replaced.
 *
 * ## The stuck state this exists to prevent
 *
 * 🔴 Every fingerprint the running JavaScript can see is **baked into itself**.
 * `otaConfig.nativeFingerprint` is the fingerprint the *running bundle* was built
 * against, not the one the binary underneath it actually has — and there is no
 * way for a bundle to observe the latter, because the only thing that could tell
 * it is a newer bundle it is not running.
 *
 * So a store release that changes the plugin set leaves the device pointed at a
 * bundle built for the old one. The channel then advertises a bundle for the new
 * fingerprint, `decideUpdate` compares it against the *stale* fingerprint, sees a
 * mismatch, and answers `needs-store-release` — for a store release the user has
 * already installed. Nothing on the device or the channel can break that loop:
 * the app is stuck on that bundle for good, quietly, with updates that look like
 * they are simply not being published.
 *
 * ## Why the app version is the signal, and why the answer is "the embedded one"
 *
 * The version is what the OS changes on a store release, and it is readable from
 * JavaScript when the fingerprint is not. It over-triggers — a version bump that
 * touched no native code still fires — and that is deliberate: the embedded
 * bundle of a new binary is compatible **by construction**, so a false positive
 * costs one download and a reload, while a false negative costs the app.
 * → `docs/design/ota.md §5.3`
 *
 * The version is remembered once the reset has landed and **before** the reload,
 * so a reload that races a second launch cannot loop: the next pass sees a
 * version it already knows. Not before the reset — a reset the plugin refused
 * has to be asked for again, and a remembered version is what stops the asking.
 *
 * ## The other thing this launch is the only chance to learn
 *
 * When `current` is `null` the embedded bundle is executing, and that is the one
 * moment `runningFingerprint` describes the **binary** rather than a bundle that
 * landed on it later. It is recorded here for the same reason the version is:
 * this function runs on every launch, and it is where a store release is noticed.
 * → `binaryFingerprint` in `#adaptv/ota/ledger`
 */
async function returnToEmbedded(
  plugin: LiveUpdatePlugin,
  runningFingerprint: string,
): Promise<boolean> {
  const [name, code, current] = await Promise.all([
    plugin
      .getVersionName()
      .then((r) => r.versionName)
      .catch(() => null),
    plugin
      .getVersionCode()
      .then((r) => r.versionCode)
      .catch(() => null),
    plugin
      .getCurrentBundle()
      .then((r) => r.bundleId)
      .catch(() => null),
  ])
  //An unreadable version is not a changed one. Guessing here would reset a
  //healthy device on every launch.
  if (!name || !code) return false

  const identity = `${name}+${code}`
  const last = lastSeenBinary()
  //`null` is a first launch, not a change — and `current === null` means this is
  //already the embedded bundle, so there is nothing to drop back to.
  if (last === null || last === identity || current === null) {
    rememberBinary(
      identity,
      current === null ? runningFingerprint : undefined,
    )
    return false
  }

  try {
    await plugin.reset()
  } catch {
    //🔴 Not remembered, so the next launch asks again. Remembering a reset that
    //never took is the stranding above by another road: every later launch sees
    //a version it already knows, and the old bundle keeps proving itself on a
    //binary it was never meant to outlive.
    return false
  }
  rememberBinary(identity)
  try {
    await plugin.reload()
    return true
  } catch {
    //The pointer has moved; the next cold start applies it either way.
    return false
  }
}

/**
 * Delete bundles this device will never boot again.
 *
 * Bounded by what the ledger knows, deliberately: a bundle adaptv has no record
 * of is one it cannot reason about, and deleting it could take out the very thing
 * the plugin would fall back to. Leaving a stranger on disk costs storage; taking
 * it costs the recovery path.
 */
async function prune(
  plugin: LiveUpdatePlugin,
  currentBuildTag: string | null,
  binaryIdentity: string,
): Promise<void> {
  const [downloaded, next] = await Promise.all([
    plugin
      .getDownloadedBundles()
      .then((r) => r.bundleIds)
      .catch(() => [] as string[]),
    plugin
      .getNextBundle()
      .then((r) => r.bundleId)
      .catch(() => null),
  ])

  const prunable = selectPrunableBundles(
    readLedger(),
    currentBuildTag ?? EMBEDDED_BUILD_TAG,
    binaryIdentity,
  ).filter((tag) => tag !== next && downloaded.includes(tag))

  for (const bundleId of prunable) {
    await plugin.deleteBundle({ bundleId }).catch(() => {})
  }
  forget(prunable)
}

/**
 * Check for, and stage, an over-the-air update. → `docs/design/ota.md §5` (L13)
 *
 * ## The shape, and why each part is what it is
 *
 * **Self-hosted.** The manifest lives on the app's own deploy — no Appflow, no
 * third-party backend. Appflow is dead anyway (no new sales since 2025-02-11,
 * sunsets 2027-12-31); more importantly, an update channel is a remote-code-
 * execution channel into every installed app, and that is not a thing to rent.
 *
 * **Staged, never applied mid-session.** Swapping the WebView root under a live
 * app tears its state. The download happens now; the swap happens at the next
 * cold start. The **one** exception is a first launch, where there is no session
 * to tear — see `decideFirstLaunch`.
 *
 * **Checked on launch AND on resume.** Resume is the more valuable of the two —
 * a mobile app is backgrounded far more often than it is cold-started, so a
 * launch-only check can leave a user on a stale bundle for days. This is a
 * direct consumer of the coordination layer's `onResume`, which exists precisely
 * because a native WebView resume is not a browser focus event.
 *
 * **And on a timer, if the app asked for one** — `otaPollMinutes`. That covers
 * the session neither of the above reaches: one held in the foreground all day,
 * on a kiosk or a wall-mounted tablet, where nothing is ever backgrounded and
 * nothing is ever relaunched. It changes only *when the download happens*; the
 * swap is still the next cold start. The timer is restarted by every other check
 * rather than running independently, so resuming an app never costs two checks
 * back to back.
 *
 * **Never applies in place.** The plugin writes a new bundle directory and flips
 * a pointer. Overwriting the running bundle produces torn reads, and destroys
 * the very thing rollback rolls back to. → `§5.4b`
 *
 * Returns a teardown function.
 */
export function startOtaUpdates(options: OtaOptions): () => void {
  //Web has its own update mechanism — the service worker. Running OTA there
  //would be a second, conflicting updater.
  if (!isNativePlatform()) return () => {}

  let disposed = false

  //Counted BEFORE the first check, because the check is what changes it. Zero
  //means this install has never successfully run anything but the embedded
  //bundle — which is true exactly once per install, and is the narrowness that
  //makes a blocking wait safe to have at all.
  //
  //Read from the LAST launch's binary rather than this one's: the identity comes
  //from the plugin and this has to be synchronous. They differ on exactly two
  //launches — the first ever (no identity, nothing proven, and waiting is
  //correct) and the one after a store release (the old identity, whose proven
  //bundles are gone but which still says "this install has run before", also
  //correct).
  const cachedAtStart = proven(lastSeenBinary() ?? "").length
  if (cachedAtStart === 0) {
    holdPromise = new Promise<void>((resolve) => {
      holdRelease = resolve
    })
    //The ceiling, armed before anything can go wrong. Every other release path
    //is an optimisation on top of this one; without it, a hung request would
    //leave the app under its launch screen for good.
    setTimeout(releaseHold, FIRST_LAUNCH_BUDGET_MS)
  }

  async function check(): Promise<void> {
    if (disposed) return
    try {
      const { plugin } = await loadPlugin()
      if (!plugin || disposed) return

      const manifest = await fetchManifest(options.manifestUrl)
      if (!manifest || disposed) return

      const requireSignature = options.requireSignature ?? true
      if (requireSignature) {
        //Before anything else is believed. `decideUpdate` checks that a signature
        //is PRESENT; this is where one is checked for being real, and it covers
        //the fields the plugin's native check cannot see.
        const authentic =
          !!options.publicKey &&
          (await verifyManifestSignature({
            manifest,
            publicKey: options.publicKey,
          }))
        if (!authentic) return
      }

      //The device's own record of what already failed to start here. Without it
      //a rolled-back bundle is re-downloaded on the very next launch, forever:
      //the channel keeps advertising it, because a rollback is a local event no
      //server hears about. → policy.ts, `blockedBuildTags`
      const blocked = await plugin
        .getBlockedBundles()
        .then((r) => r.bundleIds)
        .catch(() => [] as string[])

      //Asked, never passed in. The build tag is a content hash of the bundle's own
      //output, so it cannot be baked into that output — and the plugin is the only
      //thing that knows which bundle the WebView actually booted, which after a
      //rollback is NOT the one the last check installed.
      const currentBuildTag = await plugin
        .getCurrentBundle()
        .then((r) => r.bundleId ?? EMBEDDED_BUILD_TAG)
        .catch(() => EMBEDDED_BUILD_TAG)

      //🔴 The BINARY's fingerprint, not this bundle's. They start out equal and
      //stop being equal the moment a bundle built for a newer native layer
      //installs — which is the default. From then on the running bundle claims
      //the fingerprint of the machine that built it, and comparing the channel
      //against that reports every later build as compatible on an app that has
      //not gained a single native plugin. The ledger keeps the real one, learnt
      //from the embedded bundle. → `docs/design/ota.md §5.6`
      const deviceFingerprint =
        binaryFingerprint() ?? options.nativeFingerprint

      const decision = decideUpdate({
        manifest,
        currentBuildTag,
        nativeFingerprint: deviceFingerprint,
        nativeSkew: options.nativeSkew ?? "install",
        requireSignature,
        blockedBuildTags: blocked,
        //Read from this device's own ledger rather than taken as an argument:
        //nothing else knows when the running bundle was published, and a value
        //the caller had to supply is one that would silently be left undefined.
        currentCreatedAt: createdAtOf(currentBuildTag),
      })

      const plan = decideFirstLaunch({
        decision,
        runnableCachedBundles: cachedAtStart,
        budgetMs: FIRST_LAUNCH_BUDGET_MS,
      })
      //Nothing worth waiting for — reveal the app now rather than burning the
      //rest of the budget on a decision that has already been made.
      if (plan.action === "boot-now") releaseHold()

      //Recorded on the comparison, not on the verdict — the channel has moved
      //past this binary either way, and under the default policy that is exactly
      //the case where the update DOES install. Reading it off the decision would
      //make the state a `"refuse"`-only feature: an app taking every bundle would
      //never learn that its native half stopped keeping up.
      if (manifest.nativeFingerprint !== deviceFingerprint) {
        noteStoreReleaseRequired(manifest.buildTag)
        options.onStoreReleaseRequired?.(manifest.buildTag)
      } else {
        //🔴 Cleared HERE and nowhere else: a manifest was fetched, verified, and
        //asks for the native layer this binary actually has. Everything that
        //fails before this point — no network, a bad signature, a manifest that
        //would not parse — leaves the state alone, because none of them are
        //evidence that the install caught up. Clearing on a failed check would
        //make a stranded device look healthy for as long as it stayed offline.
        clearStoreRelease()
      }

      if (decision.action !== "install" || disposed) return

      //🔴 The plugin THROWS when asked to download a bundle it already has, and
      //without this the throw is caught below as if the check had failed — the
      //app then never reaches `setNextBundle` and never runs that bundle again.
      //
      //It is not a rare corner. A bundle sits on disk and is not current after a
      //`reset()` (every store release), and after any launch killed between the
      //download and the next cold start. In both cases the channel keeps
      //advertising exactly the tag already downloaded, so the app re-asks, throws
      //and stops, on every launch, forever. Measured on device: an app stranded
      //on the embedded bundle, fetching the manifest each launch and doing
      //nothing with it.
      //
      //Skipping the download does NOT skip a verification. A bundle is only on
      //disk because a download verified it, and the tag is a content hash — so
      //"already have this tag" means "already have these exact bytes, checked".
      //A manifest that claimed this tag for different bytes would be refused at
      //download time anyway, and the copy already on disk is the honest one.
      const downloaded = await plugin
        .getDownloadedBundles()
        .then((r) => r.bundleIds)
        .catch(() => [] as string[])
      if (!downloaded.includes(manifest.buildTag)) {
        await plugin.downloadBundle({
          url: manifest.url,
          bundleId: manifest.buildTag,
          checksum: manifest.sha256,
          signature: manifest.signature,
        })
      }
      //Recorded before the pointer moves — see `recordStaged`.
      recordStaged({
        buildTag: manifest.buildTag,
        createdAt: manifest.createdAt,
      })
      await plugin.setNextBundle({ bundleId: manifest.buildTag })
      options.onUpdateReady?.(manifest.buildTag)

      if (plan.action === "wait" && launchScreenStillUp()) {
        //First launch, and the current build just arrived. There is no session to
        //tear and the splash is still up, so apply it now instead of showing a
        //new user a version of the product that no longer exists. The document is
        //replaced by this call; the hold goes with it.
        //
        //🔴 `plan.action` alone is not enough, and this is the trap. `plan` is
        //computed from `cachedAtStart`, read ONCE when the updater starts — so an
        //install with nothing proven yet answers `"wait"` for the whole session,
        //not just for its launch check. Without the second half of this condition
        //a resume, a poll tick, or a launch check that simply outran its budget
        //would each apply the bundle by replacing the document under a mounted
        //app: the user's scroll position, their half-typed input and their open
        //sheet all vanish, and nothing about it looks like an update. The staged
        //path below is what those checks get instead, which is the whole rule of
        //§5.4b — the swap belongs to the next cold start.
        await plugin.reload().catch(() => releaseHold())
      }
    } catch {
      //A failed update check must never surface to the user or block anything.
      //The app is already running correctly on its current bundle; the next
      //resume tries again.
    } finally {
      //Whatever happened above — a thrown request, a refused manifest, a plugin
      //that is not there — the app must not stay behind its launch screen.
      releaseHold()
    }
  }

  //🔴 The three entry points below must never overlap, and before the timer
  //existed they effectively could not: a launch check and a resume check are
  //separated by the user leaving the app. A timer makes overlap ordinary — a
  //resume landing on a slow check, or a second tick before the first download
  //finished — and two concurrent checks both reach `downloadBundle` for the same
  //tag, which the plugin answers by THROWING. That throw is caught, so the
  //symptom is not an error: it is the second check silently abandoning its run,
  //including the `setNextBundle` that would have staged the bundle. The app then
  //has the bytes on disk and no pointer at them.
  let inFlight = false
  let timer: ReturnType<typeof setInterval> | undefined

  /**
   * One check at a time, and the poll clock restarted by every one of them.
   *
   * Restarted rather than free-running so that resuming an app does not cost a
   * check followed by a tick moments later — the interval means "this long since
   * we last looked", which is the thing the app actually asked for.
   */
  async function checkOnce(): Promise<void> {
    if (inFlight || disposed) return
    inFlight = true
    try {
      await check()
    } finally {
      inFlight = false
      armPoll()
    }
  }

  function armPoll(): void {
    if (timer) clearInterval(timer)
    timer = undefined
    const interval = options.pollIntervalMs ?? 0
    if (!interval || disposed) return
    timer = setInterval(() => void checkOnce(), interval)
  }

  void checkOnce()
  const stopResume = onResume(() => void checkOnce())

  return () => {
    disposed = true
    if (timer) clearInterval(timer)
    stopResume()
    releaseHold()
  }
}

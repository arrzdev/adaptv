import { onResume } from "#adaptv/capabilities/app-state"
import type { UpdateManifest } from "#adaptv/ota/policy"
import { decideUpdate } from "#adaptv/ota/policy"
import { isNativePlatform } from "#adaptv/utils/platform"

export type OtaOptions = {
  /** Where the manifest is published — the app's own deploy, no third-party backend. */
  manifestUrl: string
  /** Build tag currently running. */
  currentBuildTag: string
  /** Fingerprint of the installed native binary. */
  nativeFingerprint: string
  /** Default `true`. Only disable if you control the CDN end to end. */
  requireSignature?: boolean
  /** Called when a bundle has been downloaded and will apply at next cold start. */
  onUpdateReady?: (buildTag: string) => void
}

type LiveUpdatePlugin = {
  downloadBundle(options: {
    url: string
    bundleId: string
    checksum?: string
  }): Promise<void>
  setNextBundle(options: { bundleId: string }): Promise<void>
  ready(): Promise<void>
}

const LIVE_UPDATE_MODULE = "@capawesome/capacitor-live-update"

let pluginPromise: Promise<LiveUpdatePlugin | null> | null = null

function loadPlugin(): Promise<LiveUpdatePlugin | null> {
  pluginPromise ??= import(/* @vite-ignore */ LIVE_UPDATE_MODULE)
    .then(
      (mod) =>
        (mod as { LiveUpdate?: LiveUpdatePlugin }).LiveUpdate ?? null,
    )
    .catch(() => null)
  return pluginPromise
}

/**
 * Check for, and stage, an over-the-air update. → `LIFECYCLE.md §5` (L13)
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
 * cold start.
 *
 * **Checked on launch AND on resume.** Resume is the more valuable of the two —
 * a mobile app is backgrounded far more often than it is cold-started, so a
 * launch-only check can leave a user on a stale bundle for days. This is a
 * direct consumer of the coordination layer's `onResume`, which exists precisely
 * because a native WebView resume is not a browser focus event.
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

  async function check(): Promise<void> {
    if (disposed) return
    try {
      const response = await fetch(options.manifestUrl, {
        //an update manifest must never be served from cache: the whole point is
        //to learn that something changed
        cache: "no-store",
      })
      if (!response.ok) return

      const manifest = (await response.json()) as UpdateManifest
      const decision = decideUpdate({
        manifest,
        currentBuildTag: options.currentBuildTag,
        nativeFingerprint: options.nativeFingerprint,
        requireSignature: options.requireSignature ?? true,
      })
      if (decision.action === "skip" || disposed) return

      const plugin = await loadPlugin()
      if (!plugin || disposed) return

      await plugin.downloadBundle({
        url: manifest.url,
        bundleId: manifest.buildTag,
        checksum: manifest.sha256,
      })
      //stage only — the flip happens at the next cold start
      await plugin.setNextBundle({ bundleId: manifest.buildTag })
      options.onUpdateReady?.(manifest.buildTag)
    } catch {
      //A failed update check must never surface to the user or block anything.
      //The app is already running correctly on its current bundle; the next
      //resume tries again.
    }
  }

  void check()
  const stopResume = onResume(() => void check())

  return () => {
    disposed = true
    stopResume()
  }
}

/**
 * Tell the updater this bundle booted successfully.
 *
 * **Call this once, after first paint.** It is the watchdog's "app ready" ping:
 * a freshly-applied bundle that never pings is reverted at the next launch. Not
 * calling it means every OTA update rolls itself back — and forgetting it looks
 * exactly like an update that silently never applies.
 */
export async function markBundleReady(): Promise<void> {
  if (!isNativePlatform()) return
  try {
    const plugin = await loadPlugin()
    await plugin?.ready()
  } catch {
    //nothing to signal if the plugin is not installed
  }
}

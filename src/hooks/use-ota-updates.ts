import { otaConfig } from "virtual:adaptv/ota-config"
import { useEffect } from "react"
import { settleLaunch, startOtaUpdates } from "#adaptv/ota/updater"

/**
 * Run the over-the-air update loop. Wired from the shell — apps do not call this.
 *
 * ## Two halves, and losing either one is silent
 *
 * `startOtaUpdates` only stages: it downloads a bundle and points the next cold
 * start at it. `settleLaunch` is the other half — it tells the watchdog that the
 * bundle it swapped in actually reached the app, records what this launch learned
 * (including a rollback, which no server ever hears about), and deletes bundles
 * this device can no longer boot.
 *
 * Dropping the settle call does not disable the watchdog, it **inverts** it:
 * every update rolls itself back one launch later, and the symptom is
 * indistinguishable from updates that never install. The two live in one effect
 * so they cannot be wired up separately.
 *
 * Both are no-ops off native — on the web the service worker is the update
 * mechanism, and running OTA there would be a second, competing updater.
 */
export function useOtaUpdates(): void {
  useEffect(() => {
    if (!otaConfig) return

    //after the effect runs, the app tree is mounted — this bundle works
    void settleLaunch({ nativeFingerprint: otaConfig.nativeFingerprint })

    return startOtaUpdates({
      manifestUrl: otaConfig.manifestUrl,
      nativeFingerprint: otaConfig.nativeFingerprint,
      nativeSkew: otaConfig.nativeSkew,
      requireSignature: otaConfig.requireSignature,
      publicKey: otaConfig.publicKey,
    })
  }, [])
}

import { useSyncExternalStore } from "react"
import type { StoreReleaseRequired } from "#adaptv/ota/store-release"
import {
  getStoreRelease,
  subscribeStoreRelease,
} from "#adaptv/ota/store-release"

/**
 * Whether the channel has moved past the app this device has installed.
 *
 * `null` is the normal answer, on every target: on web and PWA the service worker
 * is the update mechanism and there is no native layer to fall behind, and on
 * native it means the newest published build was made for the binary this device
 * has.
 *
 * A non-null value says the app is **working, and behind in one direction**:
 * every deploy since `since` has been built against a native layer it does not
 * have. Under the default policy those bundles still install and run, with
 * whatever needs the missing native code reporting unavailable through its
 * capability hook's `supported`; under `otaOnNativeSkew: "refuse"` it sits on its
 * last matching bundle instead. Either way only a store update ends it.
 *
 * ## What to render, which adaptv deliberately does not decide
 *
 * The `since` timestamp is here so the answer can be a gradient rather than a
 * switch. A banner after a few days and a blocking screen after a few weeks is a
 * different product from a blocking screen on day one, and adaptv has no way to
 * know which one is right: an app whose server contract moved with the release
 * may have to block immediately, while for most apps locking a user out of
 * something that is working is a self-inflicted outage.
 *
 * ```tsx
 * const stranded = useStoreRelease()
 * const days = stranded ? (Date.now() - stranded.since) / 86_400_000 : 0
 * if (days > 14) return <UpdateRequired />
 * ```
 *
 * 🔴 It does not answer *"is a newer app in the store yet"*. It says the channel
 * has moved past this binary, which happens when the release is built — usually
 * a little before review lets anyone install it. Treat a fresh value as "an
 * update is coming", and let the age make it "an update is overdue".
 */
export function useStoreRelease(): StoreReleaseRequired | null {
  return useSyncExternalStore(
    subscribeStoreRelease,
    getStoreRelease,
    //server snapshot: a page being rendered on a server is not an install that
    //fell behind, and OTA does not run off native at all.
    () => null,
  )
}

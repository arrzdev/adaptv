import { cacheNames } from "workbox-core"
import type { PrecacheEntry } from "workbox-precaching"
import { precacheAndRoute } from "workbox-precaching"
import { serviceWorkerScope } from "#adaptv/sw/sw.scope"
import type { PrecacheManifestEntry } from "#adaptv/sw/sw.types"

/** Inject {@link precacheAndRoute} + {@link deleteOutdatedPrecaches} for build output. */
export function setupPrecache(manifest: readonly PrecacheManifestEntry[]) {
  precacheAndRoute([...manifest] as PrecacheEntry[])
  serviceWorkerScope().addEventListener("activate", (event) => {
    event.waitUntil(deleteOutdatedPrecaches())
  })
}

/**
 * Delete the precaches an older Workbox left under THIS worker's scope.
 *
 * Not Workbox's `cleanupOutdatedCaches()`: it deletes every `-precache-` cache
 * whose name merely CONTAINS the scope, and a root scope (`https://host/`) is
 * contained in a nested one's name (`workbox-precache-v2-https://host/docs/`).
 * Cache Storage is shared by every worker on the origin, so a root app's
 * activate deleted the offline shell of another app under a sub-path. Workbox
 * names a precache `<prefix>-<precache>-<scope>`, so the scope must END it.
 */
async function deleteOutdatedPrecaches(): Promise<void> {
  const sw = serviceWorkerScope()
  const ownScope = `-${sw.registration.scope}`
  const outdated = (await sw.caches.keys()).filter(
    (name) =>
      name.includes("-precache-") &&
      name.endsWith(ownScope) &&
      name !== cacheNames.precache,
  )
  await Promise.all(outdated.map((name) => sw.caches.delete(name)))
}

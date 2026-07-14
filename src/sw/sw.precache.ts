import type { PrecacheEntry } from "workbox-precaching"
import {
  cleanupOutdatedCaches,
  precacheAndRoute,
} from "workbox-precaching"
import type { PrecacheManifestEntry } from "#nativ/sw/sw.types"

/** Inject {@link precacheAndRoute} + {@link cleanupOutdatedCaches} for build output. */
export function setupPrecache(manifest: readonly PrecacheManifestEntry[]) {
  precacheAndRoute([...manifest] as PrecacheEntry[])
  cleanupOutdatedCaches()
}

import type { WorkboxPlugin } from "workbox-core/types"
import { ExpirationPlugin } from "workbox-expiration"
import type { CacheExpirationOptions } from "#nativ/sw/sw.types"

export function createExpirationPlugins(
  expiration: CacheExpirationOptions | undefined,
): WorkboxPlugin[] {
  if (!expiration) return []

  return [
    new ExpirationPlugin({
      maxEntries: expiration.maxEntries,
      maxAgeSeconds: expiration.maxAgeSeconds,
      purgeOnQuotaError: expiration.purgeOnQuotaError ?? true,
    }),
  ]
}

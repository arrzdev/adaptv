import type { WorkboxPlugin } from "workbox-core/types"

/** Only persist HTTP 200 responses — skips opaque, redirect, and error bodies. */
export function createCacheOkResponsesPlugin(): WorkboxPlugin {
  return {
    cacheWillUpdate: async ({ response }) => {
      if (!response || response.status !== 200) return null
      return response
    },
  }
}

/// <reference lib="webworker" />

import { registerServiceWorkerLifecycle } from "#adaptv/sw/sw.lifecycle"
import { registerNavigationRoute } from "#adaptv/sw/sw.navigation"
import type { NavigationMode } from "#adaptv/sw/sw.navigation-policy"
import { setupPrecache } from "#adaptv/sw/sw.precache"
import { registerStaticAssetsRoute } from "#adaptv/sw/sw.static-assets"

/**
 * adaptv's service worker. **This is a real module in the framework, not codegen.**
 *
 * An earlier version generated a byte-identical copy of this file into every
 * app's `.adaptv/`. That was tape: nothing here is app-specific. The two values
 * that *do* vary — the render mode and the build tag — arrive as build-time
 * constants, which is what constants are for.
 *
 * Consumers author no service worker at all. Writing `src/sw.ts` still overrides
 * this entirely, for genuinely app-specific behaviour like push handling.
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

//Injected by the adaptv Vite plugin via esbuild `define`.
declare const __ADAPTV_BUILD_TAG__: string
declare const __ADAPTV_RENDER_MODE__: NavigationMode

//Every route CHUNK is precached — that is what makes navigation instant offline,
//and it is deliberately not the same act as caching documents: chunks are
//content-hashed and identical for every user, documents carry a session.
setupPrecache(self.__WB_MANIFEST)

//Navigation strategy is a pure function of the render mode, so it cannot drift
//from how the app was actually built.
registerNavigationRoute({
  mode: __ADAPTV_RENDER_MODE__,
  appShellUrl: "/index.html",
})

//Cache-first: a content-hashed filename IS the version, so a cached entry can
//never be stale and revalidating it is guaranteed-useless traffic.
registerStaticAssetsRoute({ buildTag: __ADAPTV_BUILD_TAG__ })

registerServiceWorkerLifecycle({
  claimClients: true,
  skipWaitingOnMessage: true,
  //sweeps previous builds' runtime caches on activate — without this every
  //deploy left a full set behind, forever
  buildTag: __ADAPTV_BUILD_TAG__,
})

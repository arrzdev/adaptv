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
 * Consumers author no service worker at all, and there is **no override**: an app
 * with genuinely app-specific behaviour (push, background sync, its own runtime
 * caches) lists modules in `serviceWorkers: []`, and those are bundled AFTER this
 * file into the same single worker. They can add handlers; they cannot take
 * delivery away, because Workbox answers with the FIRST matching route and this
 * file's routes are registered first. → `sw-build.ts` `resolveWorkerEntry`
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

//Injected by the adaptv Vite plugin via esbuild `define`.
declare const __ADAPTV_BUILD_TAG__: string
declare const __ADAPTV_RENDER_MODE__: NavigationMode
//`<base>index.html` in a SPA build, `<base>adaptv-shell.html` in an SSR one — the emitting
//plugin owns the name, so this is never a literal here. → `sw-helpers.ts`
declare const __ADAPTV_APP_SHELL_URL__: string
//`/` at the origin root, `/app/` for a subpath deploy — always with its slash
declare const __ADAPTV_BASE__: string

//Every route CHUNK is precached — that is what makes navigation instant offline,
//and it is deliberately not the same act as caching documents: chunks are
//content-hashed and identical for every user, documents carry a session.
setupPrecache(self.__WB_MANIFEST)

//Navigation strategy is a pure function of the render mode, so it cannot drift
//from how the app was actually built.
registerNavigationRoute({
  mode: __ADAPTV_RENDER_MODE__,
  appShellUrl: __ADAPTV_APP_SHELL_URL__,
  base: __ADAPTV_BASE__,
})

//Cache-first — see `createHashedAssetStrategy` in sw.strategies.ts.
registerStaticAssetsRoute({
  buildTag: __ADAPTV_BUILD_TAG__,
  base: __ADAPTV_BASE__,
})

registerServiceWorkerLifecycle({
  claimClients: true,
  skipWaitingOnMessage: true,
  //sweeps previous builds' runtime caches on activate — without this every
  //deploy left a full set behind, forever
  buildTag: __ADAPTV_BUILD_TAG__,
  //and only this app's: another app on the origin shares the cache list
  base: __ADAPTV_BASE__,
})

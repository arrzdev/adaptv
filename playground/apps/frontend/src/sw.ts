/// <reference lib="webworker" />

import type { NavigationMode } from "@arrzdev/adaptv/sw"
import {
  registerNavigationRoute,
  registerServiceWorkerLifecycle,
  registerStaticAssetsRoute,
  setupPrecache,
} from "@arrzdev/adaptv/sw"

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

//injected by the adaptv() vite plugin at build time — a content hash of the
//client bundle (so the SW cache namespace tracks the deployed assets) and the
//render mode the app was actually built with.
declare const __ADAPTV_BUILD_TAG__: string
declare const __ADAPTV_RENDER_MODE__: NavigationMode

//Every route CHUNK is precached (static, content-hashed, user-agnostic) — that is
//what makes navigation instant offline, distinct from caching per-user documents.
setupPrecache(self.__WB_MANIFEST)

//Navigation is a pure function of the render mode, so it can't drift from how the
//app was built. The precached shell boots the client router offline.
registerNavigationRoute({
  mode: __ADAPTV_RENDER_MODE__,
  appShellUrl: "/index.html",
})

//Cache-first: a content-hashed filename IS the version, so a cached entry can
//never be stale.
registerStaticAssetsRoute({ buildTag: __ADAPTV_BUILD_TAG__ })

registerServiceWorkerLifecycle({
  claimClients: true,
  skipWaitingOnMessage: true,
  //sweep previous builds' runtime caches on activate.
  buildTag: __ADAPTV_BUILD_TAG__,
})

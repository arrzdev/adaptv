export type ServiceWorkerRegisterMode = "autoUpdate"

/** Vite build — SW source + precache. Runtime `register` lives in `createRootRoute`. */
export type PwaServiceWorkerBuildConfig = {
  /** App-relative path. Default: `"./src/sw.ts"`. */
  entry?: string
  /** Precache output directory. Default: `"dist/client"`. */
  clientDir?: string
  globPatterns?: string[]
  globIgnores?: string[]
  maximumFileSizeToCacheInBytes?: number
  /**
   * **Public, user-agnostic routes only.** Precached as documents, so they cold-load
   * instantly and work offline.
   *
   * Empty by default, and that default is a safety property: Cache Storage is keyed
   * by URL and scoped per-origin, NOT per-user, so precaching a personalized
   * document means one user's server-rendered HTML is served to the next user on
   * the device. Never list a route that renders per-user content.
   *
   * ```ts
   * precacheDocuments: ["/", "/pricing", "/about"]
   * ```
   * → `RENDERING.md §3.2`
   */
  precacheDocuments?: string[]
}

/**
 * The splash component (`splashScreen`) receives no props — it owns its own lifecycle
 * and dismisses by **returning `null`** when the app is ready (self-unmounts). Kept as
 * a named type for the config thunk's return-shape symmetry.
 */
export type SplashScreenProps = Record<string, never>

/**
 * Orientation lock for `createRootRoute({ orientation })`. Values mirror the web
 * app manifest `orientation` vocabulary. `"any"` (default) disables the guard.
 */
export type OrientationLock = "portrait" | "landscape" | "any"

/** Props injected into `orientationGuardComponent` when the device is rotated away from the lock. */
export type OrientationGuardProps = {
  /** The orientation the app requires — the device is currently rotated away from it. */
  orientation: Exclude<OrientationLock, "any">
}

type PwaServiceWorkerRuntimeConfigBase = {
  /**
   * Before registering, remove leftover service worker registrations the browser
   * treats as separate scripts (different URL or inactive with no workers).
   * Does not touch the current app's registration or its active/waiting/installing
   * version chain. Default: `true`.
   */
  unregisterForeign?: boolean
}

/**
 * How a waiting service worker is applied.
 *
 * Default is `"prompt"`, and the default matters: `autoUpdate` used to be the only
 * option, and it called `skipWaiting()` + reload **mid-session**. That drops
 * unsaved form state, and — worse — the new worker's precache no longer lists the
 * old build's chunks, so an open tab's next lazy import 404s at both cache and
 * origin. Auto-applying is what *causes* the stale-chunk failure it appears to
 * fix. → `DECISIONS.md` B3, `RENDERING.md §3.3`
 *
 * | mode | behaviour |
 * |---|---|
 * | `"prompt"` (default) | the new worker installs and **waits**; old chunks stay reachable. Nothing happens without user intent. |
 * | `"autoUpdate"` | applied automatically, but only at a safe moment — on `visibilitychange` back to visible. Never mid-interaction. |
 * | `"manual"` | nativ registers; the app owns everything after that. |
 */
export type ServiceWorkerUpdateMode = "prompt" | "autoUpdate" | "manual"

/** `createRootRoute({ serviceWorker })` — registration config. */
export type PwaServiceWorkerRuntimeConfig =
  PwaServiceWorkerRuntimeConfigBase & {
    register: ServiceWorkerUpdateMode | boolean
  }

/** App-owned `src/sw.config.ts` / `src/sw.config.tsx`. */
export type SwConfig = PwaServiceWorkerBuildConfig &
  PwaServiceWorkerRuntimeConfig

export type ResolvedSwBuildConfig = Required<
  Pick<PwaServiceWorkerBuildConfig, "entry">
> &
  Omit<PwaServiceWorkerBuildConfig, "entry"> & {
    appRoot: string
    swEntryAbs: string
    srcDir: string
    filename: string
    clientDir: string
    globPatterns: string[]
    globIgnores: string[]
    maximumFileSizeToCacheInBytes: number
  }

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

/** `createRootRoute({ serviceWorker })` — registration config. */
export type PwaServiceWorkerRuntimeConfig =
  PwaServiceWorkerRuntimeConfigBase & {
    register: "autoUpdate"
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

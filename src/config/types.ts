//Shared config types. Everything service-worker-shaped that used to live here
//is gone: adaptv's worker is not configurable, so there is no entry, no
//register mode and no app-owned `sw.config.ts` to type. → `RENDERING.md §3`

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

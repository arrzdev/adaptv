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

/**
 * Props injected into `updateRequiredComponent` once an install has been unable
 * to update for longer than `updateRequiredAfterDays`. → `LIFECYCLE.md §5.6`
 */
export type UpdateRequiredProps = {
  /**
   * Whole days this install has been unable to take what the channel publishes.
   * Already floored, because "1.7 days behind" is not a sentence anyone writes.
   */
  days: number
  /** When it first fell behind, in ms since the epoch — for a date, or a log line. */
  since: number
  /** The build this install refused. Opaque to a user; the thing to put in a report. */
  buildTag: string
}

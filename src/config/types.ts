//Shared config types. Everything service-worker-shaped that used to live here
//is gone: adaptv's worker is not configurable, so there is no entry, no
//register mode and no app-owned `sw.config.ts` to type. → `RENDERING.md §3`

/**
 * Props for the splash component (`splashScreen`). It still owns its own lifecycle and
 * dismisses by **returning `null`** when the app is ready (self-unmounts) — adaptv only
 * tells it the one thing it cannot know about itself: when it went on screen.
 */
export type SplashScreenProps = {
  /**
   * `Date.now()` at the moment the OS launch splash came off — i.e. the first moment
   * this component is something a person can actually see — and `null` until then.
   *
   * The splash is **mounted and painted underneath the OS launch splash**, on purpose:
   * that overlap is what makes the handoff seamless. So mount time is not view time,
   * and anything timed from mount (a minimum visible duration, an intro animation)
   * burns down while the OS splash is still covering it — the bug this prop exists to
   * remove. On a first launch that waits for an update, the two can be seconds apart.
   *
   * Time from **this**, not from mount:
   *
   * ```tsx
   * const delay = Math.max(MIN_MS - (Date.now() - revealedAt), 0)
   * ```
   *
   * `revealedAt !== null` is also the "am I on screen yet?" test. CSS animations inside
   * adaptv's own `PwaSplashOverlay` are held at their first frame until this flips, so
   * they play for the viewer rather than for nobody.
   */
  revealedAt: number | null
}

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

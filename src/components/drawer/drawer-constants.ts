/**
 * Drag/animation constants and the internal transition shape for the drawer engine.
 *
 * Tuning mirrors [vaul `src/constants.ts`](https://github.com/emilkowalski/vaul/blob/3e97aac6a38e4481bade71d7233ed6002e80f9b0/src/constants.ts)
 * + its [`helpers.ts`](https://github.com/emilkowalski/vaul/blob/3e97aac6a38e4481bade71d7233ed6002e80f9b0/src/helpers.ts)
 * — the feel we settled on while drafting.
 *
 * Why: adaptv's Drawer began as a wrap of vaul and diverged into an independent
 * implementation; what survived the migration is the *tuning*, so the lineage is
 * recorded here rather than in a dependency. MIT © 2023 Emil Kowalski — see
 * `THIRD_PARTY_LICENSES`.
 *
 * The SHA is pinned deliberately (`docs/decisions/prior-art.md §0`): vaul is unmaintained, so
 * `main` is frozen *today*, but a force-push, rename or archive would break every
 * link — and, worse, destroy the ability to diff what we changed.
 */

export const DRAWER_TRANSITIONS = {
  // Panel slide duration. The compositor runs this `cubic-bezier` transition on the GPU at native
  // fps — a multi-point `linear()` spring easing looked right but iOS Safari can't composite it and
  // dropped the transform to the main thread (~20fps "stalling"). Snappiness knob; lower = faster.
  // Curve is the vaul/iOS sheet easing (firm shove → long decelerate, kisses flat into place),
  // restored here for the OPEN + keyboard-GROW motions. Shrink and close have their own configs.
  //
  // DO NOT "fix" the flat landing. Sampled at 60fps over a 585px sheet, this curve spends its
  // last four frames moving under a pixel and finishes on a 0.11px step — 67ms in which the sheet
  // is formally animating and visibly is not. That reads like a defect on a profile and is not
  // one: it is the kiss, and it is why the sheet feels like an iOS sheet.
  //
  // It was changed once, to `(0.25, 0.94)` — ending below y=1 for residual velocity, the same
  // trick DRAWER_CLOSE_TRANSITION uses. It did remove the sub-pixel tail, and the owner's verdict
  // was that the whole drawer went "robotic ... too slow": half the travel moved from 16% of the
  // duration to 22%, so the shove goes and the motion reads as mechanical. The close can end
  // below 1 because nobody tracks a sheet leaving. An entrance is tracked, and the deceleration
  // IS the feel.
  //
  // The stall that prompted that change was never this curve. It was `useCaretRepaint`'s restore
  // landing in the tail, repainting a sheet that had already stopped.
  DURATION: 0.38,
  EASE: [0.32, 0.72, 0, 1] as [number, number, number, number],
} as const

/** px/ms — release closes when `abs(distMoved) / timeTaken` exceeds this */
const DRAWER_VELOCITY_THRESHOLD = 0.4

/** Fraction of drawer height — release closes when dragged at or past this */
const DRAWER_CLOSE_THRESHOLD = 0.25

/**
 * How much of the finger the sheet keeps on the FIRST pixel of an upward pull. Below 1 the sheet
 * resists from the very start, which is what reads as friction rather than as a sheet that has to
 * be dragged some distance before it admits anything is happening.
 */
const DRAWER_PULL_RESISTANCE = 0.55
/** px — how far past its rest an upward pull can ever take the sheet, however hard it is pulled. */
const DRAWER_PULL_LIMIT_PX = 40

/**
 * Upward-pull resistance for bottom drawers: the sheet gives a little, gives progressively less,
 * and stops giving at {@link DRAWER_PULL_LIMIT_PX}. Returns the UPWARD travel in px for `v` px of
 * upward finger movement, always in `[0, DRAWER_PULL_LIMIT_PX)`.
 *
 * This used to be vaul's `dampenValue`, `8 * (log(v + 1) - 2)`, and that function is NEGATIVE for
 * its first 6.4px — `dampenValue(0)` is `-16`. The caller negates it to move the sheet up, so an
 * upward pull began by throwing the sheet 16px DOWN and then walking it back through +10, +7, +5,
 * +3, +1.7 before it crossed zero and finally started rising.
 *
 * That was not a near-zero edge case: the drag rebases its origin at the takeover
 * (`pointerStartRef.current = clientY`), so every upward drag started at exactly `v = 0` and every
 * upward drag opened with that 16px kick. It reads as a shake rather than a jump because a quick
 * pull covers 6.4px inside one frame and only a slow, exploratory one — the kind you make when you
 * are feeling for the friction — shows the whole excursion. It was also the reported
 * over-sensitivity, and the same arithmetic: 4px of finger, the slop the drag commits at, came out
 * as 16px of sheet.
 *
 * The shape now is the standard rubber band (UIScrollView's, and every imitation of it since):
 * `f(0) = 0` so there is nothing to jump, `f'(0) = DRAWER_PULL_RESISTANCE` so resistance is there
 * from the first pixel, `f'` strictly decreasing so it builds, and a horizontal asymptote so the
 * sheet cannot be pulled off the top of the screen. The constants are chosen to keep the old
 * function's FAR field, which was never the problem — at 50/100/160px of pull this gives
 * 16.3/23.2/27.5px against the old 15.5/20.9/24.7.
 */
export function dampenDrawerPull(v: number) {
  if (v <= 0) return 0
  return (
    (1 - 1 / ((v * DRAWER_PULL_RESISTANCE) / DRAWER_PULL_LIMIT_PX + 1)) *
    DRAWER_PULL_LIMIT_PX
  )
}

/**
 * Decide whether a downward drag release should close the drawer or snap it back open. Shared by
 * the mouse handle path and the whole-sheet touch path so the velocity/distance thresholds can't
 * drift between the two inputs. `draggedDown` is the downward travel in px (>= 0); `dragStartTime`
 * is the drag-start timestamp (or null).
 */
export function drawerReleaseCloses(
  draggedDown: number,
  dragStartTime: number | null,
  closedY: number,
): boolean {
  const timeTaken = dragStartTime ? Date.now() - dragStartTime : 0
  const velocityPxPerMs =
    timeTaken > 0 ? Math.abs(draggedDown) / timeTaken : 0
  return (
    velocityPxPerMs > DRAWER_VELOCITY_THRESHOLD ||
    draggedDown >= closedY * DRAWER_CLOSE_THRESHOLD
  )
}

/**
 * A panel motion: a `cubic-bezier` over `duration` seconds, run by the `@keyframes` rule in
 * `styles/drawer.css`. There is no other kind. A JS-driven spring branch (motion's `animate()` on
 * the panel's motion value) sat here unreachable, since every config below is this shape, and was
 * deleted → docs/decisions/animation.md §3.1.
 */
export type DrawerTransition = {
  duration: number
  bezier: [number, number, number, number]
}

/**
 * Open + grow motion — a GPU-composited `cubic-bezier` tween (built from `bezier` in
 * drawer-motion.ts) running {@link DRAWER_TRANSITIONS}, which owns the duration and the curve and
 * the reasons for both. Drives the OPEN slide, the keyboard GROW (lift increasing), and the
 * backdrop fade-in, so the dim reaches full as the panel lands. A close→reopen interrupt resumes
 * on this curve from the panel's live rendered position.
 */
export const DEFAULT_DRAWER_TRANSITION: DrawerTransition = {
  duration: DRAWER_TRANSITIONS.DURATION,
  bezier: [...DRAWER_TRANSITIONS.EASE],
}

/**
 * Keyboard-shrink motion — the lift returning toward rest as the keyboard dismisses (content
 * settling back down). Same decelerate curve as open/grow so the panel reads as mechanically
 * attached to the keyboard rather than independently animated, just a hair quicker since there's
 * no keyboard left to chase. Its own knob so the settle tunes without touching the entrance.
 */
export const DRAWER_SHRINK_TRANSITION: DrawerTransition = {
  ...DEFAULT_DRAWER_TRANSITION,
  duration: 0.32,
}

/**
 * Close (out) motion — faster than the open, with a curve that does NOT end at y=1. A final
 * control-point y of 1 drives the end velocity to 0, so the panel "stops too slowly" (crawls the
 * last pixels into place). Ending below 1 keeps residual velocity at the finish: it still
 * decelerates toward the end (looks right) but actually arrives instead of creeping. Fast start →
 * decelerate → land. The close backdrop fade uses this too, so the dim keeps pace with the panel.
 */
export const DRAWER_CLOSE_TRANSITION: DrawerTransition = {
  ...DEFAULT_DRAWER_TRANSITION,
  duration: 0.22,
  bezier: [0.6, 0.3, 0.15, 0.5],
}

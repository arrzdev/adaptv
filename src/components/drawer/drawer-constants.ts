/**
 * Drag/animation constants and the internal transition shape for the drawer engine.
 * Tuning mirrors [vaul](https://github.com/emilkowalski/vaul/blob/main/src/constants.ts)
 * + its `helpers.ts`, the feel we settled on while drafting.
 */

export const DRAWER_TRANSITIONS = {
  // Panel slide duration. The compositor runs this `cubic-bezier` transition on the GPU at native
  // fps — a multi-point `linear()` spring easing looked right but iOS Safari can't composite it and
  // dropped the transform to the main thread (~20fps "stalling"). Snappiness knob; lower = faster.
  // Curve is the vaul/iOS sheet easing (firm shove → long decelerate, kisses flat into place),
  // restored here for the OPEN + keyboard-GROW motions. Shrink and close have their own configs.
  DURATION: 0.38,
  EASE: [0.32, 0.72, 0, 1] as [number, number, number, number],
} as const

/** px/ms — release closes when `abs(distMoved) / timeTaken` exceeds this */
export const DRAWER_VELOCITY_THRESHOLD = 0.4

/** Fraction of drawer height — release closes when dragged at or past this */
export const DRAWER_CLOSE_THRESHOLD = 0.25

export const DRAWER_BORDER_RADIUS = 8

/**
 * Upward-pull resistance for bottom drawers.
 * @see vaul `dampenValue` in helpers.ts
 */
export function dampenDrawerPull(v: number) {
  return 8 * (Math.log(v + 1) - 2)
}

/**
 * Decide whether a downward drag release should close the drawer or snap it back open, and the
 * release velocity to hand the close animation. Shared by the mouse handle path and the whole-sheet
 * touch path so the velocity/distance thresholds can't drift between the two inputs. `draggedDown`
 * is the downward travel in px (>= 0); `dragStartTime` is the drag-start timestamp (or null).
 */
export function resolveDrawerDragRelease(
  draggedDown: number,
  dragStartTime: number | null,
  closedY: number,
): { shouldClose: boolean; velocityY: number } {
  const timeTaken = dragStartTime ? Date.now() - dragStartTime : 0
  const velocityY = timeTaken > 0 ? (draggedDown / timeTaken) * 1000 : 0
  const velocityPxPerMs = Math.abs(velocityY) / 1000
  const shouldClose =
    velocityPxPerMs > DRAWER_VELOCITY_THRESHOLD ||
    draggedDown >= closedY * DRAWER_CLOSE_THRESHOLD
  return { shouldClose, velocityY }
}

//---- Internal transition ----------------

export type DrawerTransitionMode = "spring" | "tween"

export type DrawerTransition = {
  mode: DrawerTransitionMode
  velocity: number
  bounce: number
  duration: number
  bezier: [number, number, number, number]
}

/**
 * Open + grow motion — a GPU-composited `cubic-bezier` tween (built from `bezier` in
 * drawer-motion.ts). This is the path that runs at native fps on iOS; the duration is the speed
 * knob. The curve is firm-shove → decelerate (the vaul/iOS sheet feel), ending flat at y=1 so the
 * panel kisses into place — right for an entrance the eye tracks. Drives the OPEN slide, the
 * keyboard GROW (lift increasing), and the backdrop fade-in, so the dim reaches full as the panel
 * lands. A close→reopen interrupt resumes on this curve from the panel's live rendered position.
 */
export const DEFAULT_DRAWER_TRANSITION: DrawerTransition = {
  mode: "tween",
  velocity: 0,
  bounce: 0,
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

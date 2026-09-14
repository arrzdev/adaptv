import type { MotionValue, Transition } from "motion/react"
import { animate } from "motion/react"
import { transitionDrawerChromeTint } from "#adaptv/components/drawer/drawer-chrome-tint"
import type { DrawerTransition } from "#adaptv/components/drawer/drawer-constants"
import { DEFAULT_DRAWER_TRANSITION } from "#adaptv/components/drawer/drawer-constants"
import { splitEasingAt } from "#adaptv/components/drawer/drawer-easing"
import { beginCaretHold } from "#adaptv/hooks/use-caret-repaint"
import { clamp } from "#adaptv/utils/clamp"
import type { EasingBezier } from "#adaptv/utils/easing"

const TRANSITION_END_FALLBACK_MS = 32

/**
 * The `@keyframes` rule in `styles/drawer.css` that moves the panel, and the two properties that
 * aim it. Kept in lockstep with that file by name — a rename on either side is a silent no-op.
 */
const PANEL_KEYFRAME = "pwa-drawer-slide"
const PANEL_FROM_VAR = "--pwa-drawer-from"
const PANEL_TO_VAR = "--pwa-drawer-to"

function findPanelKeyframe(panel: HTMLElement | null): Animation | null {
  if (!panel || typeof panel.getAnimations !== "function") return null
  return (
    panel
      .getAnimations()
      .find(
        (animation) =>
          (animation as { animationName?: string }).animationName ===
          PANEL_KEYFRAME,
      ) ?? null
  )
}

/**
 * Stop whatever is moving the panel and leave it where it visibly IS.
 *
 * `transition: none` alone cannot do this any more: an animation outranks the inline transform, so
 * dropping one without committing its current value first snaps the panel back to whatever the
 * inline style last said — which during a tween is the target, i.e. the far end of the motion.
 */
export function clearDrawerPanelTransition(panel: HTMLElement | null) {
  if (!panel) return
  if (findPanelKeyframe(panel)) {
    const live = readPanelTranslateY(panel)
    panel.style.animation = ""
    panel.style.transform = `translate3d(0, ${live}px, 0)`
  }
  panel.style.transition = "none"
}

function settleDrawerPanelKeyframe(panel: HTMLElement | null) {
  if (!panel) return
  //safe to drop without committing anything: the inline transform was written to the target before
  //the animation was armed, so the value the animation has been holding is already underneath it
  panel.style.animation = ""
  panel.style.removeProperty(PANEL_FROM_VAR)
  panel.style.removeProperty(PANEL_TO_VAR)
}

function waitForDrawerPanelKeyframe(
  panel: HTMLElement | null,
  duration: number,
  running: Animation | null,
): Promise<void> {
  /*
   * The animation's own promise, not a timer over its duration. A duration timer backing an event
   * is a race whenever the animated thing can start later than the timer is armed, and that race
   * has already produced one bug here: on a throttled device the open's end-snap was a fallback
   * firing before the keyframe had finished and tearing it off mid-curve.
   *
   * The timer survives only for environments with no `getAnimations` (jsdom), where there is no
   * animation object to await and nothing that can outrun it.
   */
  if (running) return running.finished.then(NOOP, NOOP)
  if (!panel || duration <= 0) return Promise.resolve()
  return new Promise((resolve) => {
    window.setTimeout(
      resolve,
      duration * 1000 + TRANSITION_END_FALLBACK_MS,
    )
  })
}

function NOOP() {}

/**
 * Move the panel to wherever `commit` puts it, over `config`'s curve.
 *
 * The engine keeps owning the destination: `commit` writes the composed transform the same way a
 * drag frame would (`y` plus the keyboard's flip), and this reads back what landed. So a caller
 * never has to know how the pieces compose — it changes the value it is responsible for, and the
 * panel eases from wherever it was to whatever that produced.
 *
 * The motion itself is the `@keyframes` rule; see `styles/drawer.css` for the device bisect that
 * says why it cannot be an inline transition.
 */
export function tweenDrawerPanelTransform(
  panel: HTMLElement | null,
  config: DrawerTransition,
  commit: () => void,
): Promise<void> {
  if (!panel) {
    commit()
    return Promise.resolve()
  }

  //where it is RIGHT NOW, mid-animation included — computed style reports the animated value
  const from = readPanelTranslateY(panel)
  //drop the running keyframe without committing it: `from` already holds where it really was, and
  //the inline transform is about to be overwritten anyway
  panel.style.animation = ""
  panel.style.transition = "none"

  commit()

  const to = readPanelTranslateY(panel)
  //a sub-pixel move is not worth an animation, and a zero-length one would never fire `finished`
  if (config.duration <= 0 || Math.abs(to - from) < 0.5) {
    settleDrawerPanelKeyframe(panel)
    return Promise.resolve()
  }

  const [a, b, c, d] = config.bezier
  panel.style.setProperty(PANEL_FROM_VAR, `${from}px`)
  panel.style.setProperty(PANEL_TO_VAR, `${to}px`)
  panel.style.animation = `${PANEL_KEYFRAME} ${config.duration}s cubic-bezier(${a}, ${b}, ${c}, ${d}) both`

  const armed = findPanelKeyframe(panel)

  return waitForDrawerPanelKeyframe(panel, config.duration, armed).finally(
    () => {
      /*
       * Only tidy up after the animation THIS call armed.
       *
       * The panel's motion is routinely superseded mid-flight — a close re-aims when the viewport
       * shifts, the keyboard re-aims when its height lands in two steps, a drag release interrupts
       * an open. Each of those arms a fresh keyframe, and the interrupted call's promise settles
       * moments later (a cancelled animation's `finished` rejects). Clearing unconditionally there
       * would strip the animation that just replaced it, dropping the panel onto the inline
       * transform — the target — so the sheet would jump the rest of the way instead of easing.
       */
      if (findPanelKeyframe(panel) === armed)
        settleDrawerPanelKeyframe(panel)
    },
  )
}

function resolveTransition(config: DrawerTransition): Transition {
  if (config.mode === "spring") {
    //duration + bounce (not stiffness/damping): Motion derives a spring whose visual settle is
    //`duration` with `bounce` overshoot — bounce 0 is critically damped, matching an iOS sheet.
    return {
      type: "spring",
      duration: config.duration,
      bounce: config.bounce,
      velocity: config.velocity,
    }
  }

  return {
    type: "tween",
    duration: config.duration,
    ease: config.bezier,
  }
}

export function applyDrawerPanelTransition(
  panel: HTMLElement | null,
  config: DrawerTransition,
  enabled: boolean,
) {
  if (!panel) return

  if (!enabled || config.mode === "spring") {
    panel.style.transition = "none"
    return
  }

  const [a, b, c, d] = config.bezier
  panel.style.transition = `transform ${config.duration}s cubic-bezier(${a}, ${b}, ${c}, ${d})`
}

type AnimateDrawerYOptions = {
  dragVelocity?: number
  useTransition?: boolean
}

export function animateDrawerY(
  y: MotionValue<number>,
  panel: HTMLElement | null,
  target: number,
  config: DrawerTransition,
  options: AnimateDrawerYOptions = {},
) {
  const useTransition = options.useTransition !== false
  //the panel carries any focused field with it — mute the caret before the first moved frame
  //(the reactive tracker alone leaks ghost frames at motion start); released on settle
  const releaseCaretHold = beginCaretHold()

  // Spring path is JS-driven (main thread) and only kept for opt-in velocity-aware motion.
  if (config.mode === "spring") {
    const resolved = resolveTransition(config)
    const springTransition =
      options.dragVelocity !== undefined && resolved.type === "spring"
        ? { ...resolved, velocity: options.dragVelocity }
        : resolved

    applyDrawerPanelTransition(panel, config, false)
    const controls = animate(y, target, springTransition)
    controls.finished.then(releaseCaretHold, releaseCaretHold)
    return controls
  }

  // Tween path — commit the target, then let a `@keyframes` rule carry the panel to it. Any drag
  // velocity is dropped on the floor exactly as before: a CSS tween cannot carry one, and the
  // visual still starts from the panel's current rendered position.
  //
  // `useTransition: false` no longer means "no interpolation" — it means "land on the value now",
  // which is what a zero duration produces.
  return tweenDrawerPanelTransform(
    panel,
    useTransition ? config : { ...config, duration: 0 },
    () => {
      y.set(target)
    },
  ).finally(releaseCaretHold)
}

/**
 * Read the panel's current rendered translateY off its computed transform matrix. During a CSS
 * transition this returns the *live interpolated* value, so a close→reopen can continue the
 * animation from where the panel actually is — read this BEFORE clearing the transition, because
 * setting `transition: none` snaps the element to its committed (target) value.
 */
export function readPanelTranslateY(panel: HTMLElement | null): number {
  if (!panel) return 0
  const transform = getComputedStyle(panel).transform
  if (!transform || transform === "none") return 0
  try {
    return new DOMMatrixReadOnly(transform).m42
  } catch {
    return 0
  }
}

/**
 * A composited panel transition caught mid-flight. Read it BEFORE
 * {@link clearDrawerPanelTransition} — `transition: none` cancels the transition, taking its
 * timing with it.
 */
export type PanelFlight = {
  /** fraction of the easing's duration already consumed, in `[0,1]` */
  elapsed: number
  /** seconds of the easing still ahead */
  left: number
  bezier: EasingBezier
}

const CUBIC_BEZIER = /^cubic-bezier\(([^)]+)\)$/

function readPanelEasing(
  panel: HTMLElement,
  fromKeyframe: boolean,
): EasingBezier | null {
  const style = getComputedStyle(panel)
  //an animation's curve is on `animation-timing-function`; a transition's is on its own property.
  //Reading the wrong one returns the initial `ease`, which resumes a motion onto a curve it was
  //never on — a seam that decelerates instead of continuing.
  const declared = (
    fromKeyframe
      ? style.animationTimingFunction
      : style.transitionTimingFunction
  )?.trim()
  const match = declared ? CUBIC_BEZIER.exec(declared) : null
  if (!match) return null
  const points = match[1].split(",").map((n) => Number.parseFloat(n))
  if (points.length !== 4 || points.some((n) => !Number.isFinite(n)))
    return null
  return points as EasingBezier
}

/**
 * Where the panel's transform transition is in its own timeline, or `null` if none is running.
 *
 * The elapsed fraction comes from the transition object rather than from wall-clock deltas: the
 * transition starts on the next style recalc, which on a cold first paint can be several frames
 * after the code that armed it. Timing it from the outside overstated the elapsed time by ~40%
 * on a physical device, which is the difference between resuming a curve and guessing at one.
 */
export function samplePanelFlight(
  panel: HTMLElement | null,
): PanelFlight | null {
  if (!panel || typeof panel.getAnimations !== "function") return null
  //the open, close and snaps run on the keyframe, but the keyboard FLIP still arms an inline
  //`transform` transition on the panel itself (`applyDrawerPanelTransition`), so both are worth
  //finding
  const running = panel
    .getAnimations()
    .find(
      (animation) =>
        (animation as { animationName?: string }).animationName ===
          PANEL_KEYFRAME ||
        (animation as { transitionProperty?: string })
          .transitionProperty === "transform",
    )
  if (!running) return null
  const timing = running.effect?.getTiming()
  const duration =
    typeof timing?.duration === "number" ? timing.duration : 0
  const at = Number(running.currentTime)
  if (duration <= 0 || !Number.isFinite(at)) return null
  const bezier = readPanelEasing(
    panel,
    (running as { animationName?: string }).animationName ===
      PANEL_KEYFRAME,
  )
  if (!bezier) return null
  const elapsed = clamp(at / duration, 0, 1)
  return { elapsed, left: ((1 - elapsed) * duration) / 1000, bezier }
}

/**
 * The transition that CONTINUES `flight` when the panel's target moves mid-motion: the remainder
 * of the curve it was already on, over a duration that leaves the seam's speed intact.
 *
 * `remaining` is the travel the interrupted motion still had; `travel` is what it has now (its own
 * remainder plus whatever the new geometry added). Restarting the full curve instead makes the
 * panel *decelerate* at the seam — the open curve enters slower than the speed a motion near its
 * end has already built — and then spend a whole fresh duration on the little that is left. That
 * is the "first open feels laggy" of the two-step iOS keyboard raise.
 *
 * The duration is `time left + (added travel / seam speed)`: it reduces to the untouched curve
 * when nothing had started, and never exceeds a fresh motion's duration, which is also the answer
 * when the interrupt lands so late that the seam speed has decayed to nothing.
 */
export function resumeDrawerTransition(
  flight: PanelFlight | null,
  remaining: number,
  travel: number,
): DrawerTransition {
  const fresh = DEFAULT_DRAWER_TRANSITION
  if (!flight || flight.left <= 0) return fresh
  const split = splitEasingAt(flight.bezier, flight.elapsed)
  if (!split || !Number.isFinite(split.entrySlope)) return fresh
  //px/s at the seam, from the curve's own entry slope over the travel/time it had left
  const speed = (split.entrySlope * Math.abs(remaining)) / flight.left
  if (!(speed > 0)) return fresh
  const added = Math.abs(travel) - Math.abs(remaining)
  return {
    ...fresh,
    duration: clamp(
      flight.left + added / speed,
      flight.left,
      Math.max(flight.left, fresh.duration),
    ),
    bezier: split.bezier,
  }
}

function readDrawerBackdropOpacity(backdrop: HTMLElement): number {
  const value = Number.parseFloat(getComputedStyle(backdrop).opacity)
  if (!Number.isFinite(value)) return 0
  return clamp(value, 0, 1)
}

export function stopDrawerBackdropAnimation(backdrop: HTMLElement | null) {
  if (!backdrop) return
  backdrop.style.animation = "none"
}

type TransitionDrawerBackdropOpacityOptions = {
  /** Skip the stop/reset/forced-reflow dance. Only valid when the backdrop's start state was
   *  already PAINTED (e.g. a fresh open that waited a frame) — the reflow exists to commit an
   *  un-painted or mid-flight start value, and it costs a synchronous full-document layout. */
  skipReflow?: boolean
}

export function transitionDrawerBackdropOpacity(
  backdrop: HTMLElement | null,
  target: number,
  config: DrawerTransition,
  duration: number,
  options: TransitionDrawerBackdropOpacityOptions = {},
): Promise<void> {
  if (!backdrop) return Promise.resolve()

  const element = backdrop
  const clampedTarget = clamp(target, 0, 1)
  const current = readDrawerBackdropOpacity(element)

  //The browser chrome above the page is the one part of the screen the scrim cannot reach, so it
  //is dimmed from here — the single seam every open, close, snap and backdrop tap already passes
  //through. Arming it beside the opacity rather than at those four call sites is what keeps the
  //toolbar from lagging, overshooting or forgetting one path entirely. No-op outside a browser
  //tab; the early returns below are deliberately AFTER it, since a dim that lands instantly still
  //has to take the chrome with it.
  transitionDrawerChromeTint(element, clampedTarget, config, duration)

  if (!options.skipReflow) {
    stopDrawerBackdropAnimation(element)
    element.style.transition = "none"
    element.style.opacity = String(current)
    void element.offsetWidth
  }

  if (Math.abs(current - clampedTarget) < 0.001) {
    element.style.opacity = String(clampedTarget)
    return Promise.resolve()
  }

  if (config.mode === "spring" || duration <= 0) {
    element.style.opacity = String(clampedTarget)
    return Promise.resolve()
  }

  const [a, b, c, d] = config.bezier
  element.style.transition = `opacity ${duration}s cubic-bezier(${a}, ${b}, ${c}, ${d})`
  element.style.opacity = String(clampedTarget)

  return new Promise((resolve) => {
    let settled = false

    function finish() {
      if (settled) return
      settled = true
      element.removeEventListener("transitionend", onTransitionEnd)
      resolve()
    }

    function onTransitionEnd(event: TransitionEvent) {
      if (event.target === element && event.propertyName === "opacity") {
        finish()
      }
    }

    element.addEventListener("transitionend", onTransitionEnd)
    window.setTimeout(finish, duration * 1000 + TRANSITION_END_FALLBACK_MS)
  })
}

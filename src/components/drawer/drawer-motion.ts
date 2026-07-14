import type { MotionValue, Transition } from "motion/react"
import { animate } from "motion/react"
import type { DrawerTransition } from "#nativ/components/drawer/drawer-constants"
import { beginCaretHold } from "#nativ/hooks/use-caret-repaint"
import { clamp } from "#nativ/utils/clamp"

const TRANSITION_END_FALLBACK_MS = 32

export function clearDrawerPanelTransition(panel: HTMLElement | null) {
  if (!panel) return
  panel.style.transition = "none"
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

export function waitForDrawerPanelTransition(
  panel: HTMLElement | null,
  duration: number,
) {
  if (!panel || duration <= 0) return Promise.resolve()

  const element = panel

  return new Promise<void>((resolve) => {
    let settled = false

    function finish() {
      if (settled) return
      settled = true
      element.removeEventListener("transitionend", onTransitionEnd)
      resolve()
    }

    function onTransitionEnd(event: TransitionEvent) {
      if (event.target === element && event.propertyName === "transform") {
        finish()
      }
    }

    element.addEventListener("transitionend", onTransitionEnd)
    window.setTimeout(finish, duration * 1000 + TRANSITION_END_FALLBACK_MS)
  })
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

  // Tween path — set the CSS transition, then set the value once. The browser interpolates
  // transform on the compositor (native fps), regardless of any drag velocity (a CSS tween
  // can't carry it; the visual still starts from the panel's current rendered position).
  applyDrawerPanelTransition(panel, config, useTransition)
  y.set(target)
  return waitForDrawerPanelTransition(panel, config.duration).finally(
    releaseCaretHold,
  )
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

type DrawerMotionAnimation = ReturnType<typeof animate>

export type { DrawerMotionAnimation }

type AnimateDrawerKeyboardOffsetOptions = {
  activeAnimation?: { current: DrawerMotionAnimation | null }
}

/** `true` when the lift would actually move (vs the epsilon no-op below). Exposed so the
 *  engine can skip animation-window bookkeeping for the no-op re-runs. */
export function willAnimateDrawerKeyboardOffset(
  offset: MotionValue<number>,
  target: number,
): boolean {
  return Math.abs(offset.get() - target) >= 0.5
}

export function animateDrawerKeyboardOffset(
  offset: MotionValue<number>,
  panel: HTMLElement | null,
  target: number,
  config: DrawerTransition,
  options: AnimateDrawerKeyboardOffsetOptions = {},
) {
  // A two-step iOS keyboard report re-runs the lift with the SAME max-height target; skipping
  // here (instead of restarting the animation) keeps the raise one continuous motion.
  if (!willAnimateDrawerKeyboardOffset(offset, target)) {
    return Promise.resolve()
  }

  options.activeAnimation?.current?.stop()
  if (options.activeAnimation) {
    options.activeAnimation.current = null
  }

  //the keyboard lift translates the panel under the focused field — mute the caret before the
  //first moved frame; released on settle
  const releaseCaretHold = beginCaretHold()
  const resolved = resolveTransition(config)

  if (config.mode === "spring") {
    clearDrawerPanelTransition(panel)
    const controls = animate(offset, target, resolved)
    if (options.activeAnimation) {
      options.activeAnimation.current = controls
    }

    return controls.finished.finally(() => {
      releaseCaretHold()
      if (options.activeAnimation?.current === controls) {
        options.activeAnimation.current = null
      }
    })
  }

  applyDrawerPanelTransition(panel, config, true)
  offset.set(target)
  return waitForDrawerPanelTransition(panel, config.duration).finally(
    releaseCaretHold,
  )
}

export function stopDrawerKeyboardOffsetAnimation(activeAnimation: {
  current: DrawerMotionAnimation | null
}) {
  activeAnimation.current?.stop()
  activeAnimation.current = null
}

export function readDrawerBackdropOpacity(backdrop: HTMLElement): number {
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

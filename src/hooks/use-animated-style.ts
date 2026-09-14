import type { ValueAnimationTransition } from "motion/react"
import {
  cancelFrame,
  createGeneratorEasing,
  frame,
  JSAnimation,
  spring,
  time,
} from "motion/react"
import type { RefObject } from "react"
import { useEffect, useLayoutEffect, useRef } from "react"

/*
 * The imperative twin of `<motion.div initial={false} animate={targets}
 * transition={transitions}>`, for a component that wraps someone else's
 * content.
 *
 * A motion component is two things: an element that animates, and a React
 * context it reads and (through `LazyMotion`) provides. Around app content the
 * second half leaks. `LazyMotion` hands its subtree a fresh context object on
 * every render, so every app `motion` or `m` element inside re-renders with the
 * wrapper, and a pull re-renders the wrapper on every pointer frame. It also
 * overrides the app's own `LazyMotion` for the whole subtree (its async
 * features, its `strict`). This hook keeps the first half and drops the second:
 * it drives the element's inline style from an effect with motion's own
 * animation engine (`JSAnimation`, the same generators and frameloop a
 * `motion.div` ends up running), and renders nothing.
 *
 * It copies the declarative component's rules, because the components it
 * replaced depended on them:
 * - a key that appears, or an element that (re)mounts, JUMPS to its target,
 *   which is `initial={false}`
 * - only a key whose TARGET changed starts an animation, with the transition of
 *   the render that changed it. A new transition for an unchanged target does
 *   not restart anything
 * - a zero duration lands on the next frame, not synchronously
 * - `onComplete` runs when every animation one render started has landed, and
 *   never for a batch that a newer target interrupted (`onAnimationComplete`)
 * - an interrupted animation is sampled at the moment it is stopped, so the next
 *   one starts from where the element visibly is
 *
 * - opacity gets the compositor path's spring (see below), on every engine
 *
 * What it does not copy: a spring with no explicit `velocity` starts at rest
 * rather than inheriting the interrupted value's velocity; nothing runs on the
 * compositor; a positional value (`top`, `width`) starts on the frame it is set
 * rather than one or two frames later, after motion measures it; and an app's
 * `<MotionConfig>` does not reach it (the components follow the OS reduced
 * motion preference themselves). → docs/decisions/animation.md §3.1
 */

/** The style channels adaptv animates. Transforms compose in motion's order. */
export type AnimatedStyleKey =
  | "y"
  | "scale"
  | "rotate"
  | "top"
  | "width"
  | "opacity"

export type AnimatedStyleTargets = Partial<
  Record<AnimatedStyleKey, number>
>

/** Seconds, like motion's `transition` prop; springs and tweens only. */
export type AnimatedStyleTransition = Pick<
  ValueAnimationTransition<number>,
  | "type"
  | "duration"
  | "ease"
  | "stiffness"
  | "damping"
  | "mass"
  | "bounce"
  | "restDelta"
  | "restSpeed"
  | "velocity"
>

export type AnimatedStyleTransitions = Partial<
  Record<AnimatedStyleKey, AnimatedStyleTransition>
>

type Channel = {
  value: number
  target: number
  updatedAt: number
  animation: JSAnimation<number> | null
  instant: ReturnType<typeof frame.update> | null
  batch: Set<AnimatedStyleKey> | null
}

const TRANSFORM_ORDER = ["y", "scale", "rotate"] as const

function buildTransform(channels: Map<AnimatedStyleKey, Channel>): string {
  let transform = ""
  for (const key of TRANSFORM_ORDER) {
    const channel = channels.get(key)
    if (!channel) continue
    const { value } = channel
    if (value === (key === "scale" ? 1 : 0)) continue
    if (key === "y") transform += `translateY(${value}px) `
    else if (key === "scale") transform += `scale(${value}) `
    else transform += `rotate(${value}deg) `
  }
  return transform.trim() || "none"
}

function writeStyle(
  el: HTMLElement,
  key: AnimatedStyleKey,
  channels: Map<AnimatedStyleKey, Channel>,
) {
  const value = channels.get(key)?.value ?? 0
  if (key === "top") el.style.top = `${value}px`
  else if (key === "width") el.style.width = `${value}px`
  else if (key === "opacity")
    el.style.opacity = String(Math.min(1, Math.max(0, value)))
  else el.style.transform = buildTransform(channels)
}

function clearStyle(el: HTMLElement, key: AnimatedStyleKey) {
  el.style.removeProperty(
    key === "y" || key === "scale" || key === "rotate" ? "transform" : key,
  )
}

function stopChannel(channel: Channel) {
  if (channel.instant) {
    cancelFrame(channel.instant)
    channel.instant = null
  }
  const { animation } = channel
  if (!animation) return
  //what a motion value does when a new animation replaces a running one: land
  //the old one on THIS moment first, so the new origin is the visible value
  if (channel.updatedAt !== time.now()) animation.tick(time.now())
  channel.animation = null
  animation.stop()
}

/**
 * Animate `targets` on the element behind `ref`. `targets: null` stops every
 * animation and removes the styles this hook wrote.
 */
export function useAnimatedStyle(
  ref: RefObject<HTMLElement | null>,
  targets: AnimatedStyleTargets | null,
  transitions: AnimatedStyleTransitions,
  onComplete?: () => void,
) {
  const state = useRef<{
    el: HTMLElement | null
    channels: Map<AnimatedStyleKey, Channel>
  }>({ el: null, channels: new Map() })
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  //mounts and removals: before paint, the way a motion component's first style
  //is already in its markup
  useLayoutEffect(() => {
    const s = state.current
    const el = targets ? ref.current : null
    if (el !== s.el) {
      for (const [key, channel] of s.channels) {
        stopChannel(channel)
        if (s.el?.isConnected) clearStyle(s.el, key)
      }
      s.channels.clear()
      s.el = el
    }
    if (!el || !targets) return
    for (const [key, channel] of s.channels) {
      if (targets[key] !== undefined) continue
      stopChannel(channel)
      s.channels.delete(key)
      clearStyle(el, key)
    }
    for (const key of Object.keys(targets) as AnimatedStyleKey[]) {
      const target = targets[key]
      if (target === undefined || s.channels.has(key)) continue
      s.channels.set(key, {
        value: target,
        target,
        updatedAt: time.now(),
        animation: null,
        instant: null,
        batch: null,
      })
      writeStyle(el, key, s.channels)
    }
  })

  //target changes: after the commit, where motion's animation state runs them
  useEffect(() => {
    const s = state.current
    const { el } = s
    if (!el || !targets) return
    const started = new Set<AnimatedStyleKey>()
    for (const [key, channel] of s.channels) {
      const target = targets[key]
      if (target === undefined || target === channel.target) continue
      stopChannel(channel)
      //an interrupted batch never completes, as a motion value's promise never
      //resolves once its animation is replaced
      channel.batch?.clear()
      channel.batch = started
      channel.target = target
      started.add(key)

      const set = (value: number) => {
        channel.value = value
        channel.updatedAt = time.now()
        writeStyle(el, key, s.channels)
      }
      const done = () => {
        if (channel.batch !== started || !started.delete(key)) return
        channel.batch = null
        if (started.size === 0) onCompleteRef.current?.()
      }

      const transition = transitions[key] ?? {}
      const options: AnimatedStyleTransition & { keyframes: number[] } = {
        keyframes: [channel.value, target],
        ease: "easeOut",
        ...transition,
      }
      //A motion component runs opacity on the compositor, and a spring there is
      //baked into an easing over a 0–100 range first, so its `velocity` is
      //relative to that range. Fed raw to the 0–1 value, the pull's px/s release
      //velocity flings the fading spinner back up before it fades. Bake it the
      //same way (in seconds, like every other transition here).
      if (key === "opacity" && options.type === "spring") {
        Object.assign(options, createGeneratorEasing(options, 100, spring))
      }
      //motion's `transition` is in seconds; its engine counts milliseconds
      if (options.duration) options.duration *= 1000
      if (options.type === false || options.duration === 0) {
        channel.instant = frame.update(() => {
          channel.instant = null
          set(target)
          done()
        })
        continue
      }
      channel.animation = new JSAnimation<number>({
        ...options,
        onUpdate: set,
        onComplete: () => {
          channel.animation = null
          done()
        },
      })
    }
  })

  useEffect(() => {
    const s = state.current
    return () => {
      for (const channel of s.channels.values()) stopChannel(channel)
    }
  }, [])
}

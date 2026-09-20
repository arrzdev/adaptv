//Motion — the accelerometer and the gyroscope, on every target, through the one
//API every WebView and browser here shares: `devicemotion`. The Capacitor motion
//plugin carries no native code (it is this event behind a plugin shape), so there
//is no plugin to install and no native branch to keep honest; what differs per
//platform is permission and silence, and both are named here.
//
//Verified 2026-09-02:
//  • `DeviceMotionEvent` exists only in a secure context. Both engines on
//    `about:blank` and desktop WebKit have no constructor at all; on `localhost`
//    and `https` Chromium has it, and Playwright's WebKit under an iPhone
//    descriptor has it without `requestPermission` and never fires. A dev
//    session on a LAN address over plain http is therefore `unsupported` in the
//    browser, and that is the browser's rule, not a bug to work around.
//  • Chromium with no sensor (a desktop) fires ONE `devicemotion` event with every
//    field null. That is not a sample; it is the engine saying there is nothing to
//    read, and it is why `silent` is decided on usable samples and not on events.
//  • iOS WebKit (13+) gates the event behind `DeviceMotionEvent.requestPermission`,
//    which must be called from a user gesture and answers "granted" or "denied".
//    Chromium and Android WebView have no such gate and are granted from the start.
//  • Outside a gesture WebKit REJECTS the request instead of answering, and no
//    dialog was shown. That is not the user saying no, so it is not remembered:
//    the status stays `prompt` and the next request from a tap asks for real.
/**
 * `prompt` means the engine will ask when {@link requestMotionPermission} runs
 * from a gesture; `granted` means events may arrive (they may still never, see
 * `silent` on the hook); `unsupported` means no `devicemotion` here at all.
 */
export type MotionStatus = "unsupported" | "prompt" | "granted" | "denied"

export type MotionVector = { x: number; y: number; z: number }
export type MotionRotation = { alpha: number; beta: number; gamma: number }

export type MotionSample = {
  /** Linear acceleration in m/s², gravity removed; null when the engine cannot separate it. */
  acceleration: MotionVector | null
  /** Acceleration including gravity in m/s²; the raw accelerometer. */
  gravity: MotionVector | null
  /** Rotation rate in deg/s; null without a gyroscope. */
  rotation: MotionRotation | null
  /** The engine's sampling interval in ms. */
  interval: number
  /** `performance.now()` when the sample arrived. */
  at: number
}

export type MotionSubscribeOptions = {
  /** Deliver at most one sample per this many ms; 0 delivers every event. */
  throttleMs?: number
}

type RequestingMotionEvent = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">
}

let answered: MotionStatus | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const cb of listeners) cb()
}

function motionApi(): RequestingMotionEvent | null {
  if (typeof window === "undefined") return null
  const ctor = (window as { DeviceMotionEvent?: RequestingMotionEvent })
    .DeviceMotionEvent
  return typeof ctor === "function" ? ctor : null
}

function vector(
  v: DeviceMotionEventAcceleration | null,
): MotionVector | null {
  if (!v || v.x === null || v.y === null || v.z === null) return null
  return { x: v.x, y: v.y, z: v.z }
}

function rotation(
  r: DeviceMotionEventRotationRate | null,
): MotionRotation | null {
  if (!r || r.alpha === null || r.beta === null || r.gamma === null)
    return null
  return { alpha: r.alpha, beta: r.beta, gamma: r.gamma }
}

/** An event is a sample only when it carries at least one number to read. */
export function toMotionSample(
  event: DeviceMotionEvent,
): MotionSample | null {
  const gravity = vector(event.accelerationIncludingGravity)
  const acceleration = vector(event.acceleration)
  const rot = rotation(event.rotationRate)
  if (!gravity && !acceleration && !rot) return null
  return {
    acceleration,
    gravity,
    rotation: rot,
    interval: event.interval ?? 0,
    at:
      typeof performance === "undefined" ? Date.now() : performance.now(),
  }
}

/**
 * Where motion stands right now, without asking. Synchronous: `unsupported`
 * without the constructor, `prompt` on an engine that gates it and has not
 * answered in this document, otherwise the answer given or `granted`.
 */
export function getMotionStatus(): MotionStatus {
  const api = motionApi()
  if (!api) return "unsupported"
  if (answered) return answered
  return typeof api.requestPermission === "function" ? "prompt" : "granted"
}

/**
 * Subscribe to permission answers; returns an unsubscribe. Every hook shares
 * the one answer, so a grant asked from one screen reaches all of them.
 */
export function subscribeMotionStatus(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/**
 * Ask, where the engine asks. Call it from a user gesture: WebKit rejects the
 * request outside one without showing anything, and that resolves `prompt`
 * (nothing was answered, a tap can still ask). Only a resolved `denied` is a
 * denial. On engines that never ask this resolves at once with the current
 * status.
 */
export async function requestMotionPermission(): Promise<MotionStatus> {
  const api = motionApi()
  if (!api) return "unsupported"
  if (typeof api.requestPermission !== "function") return "granted"
  if (answered) return answered
  try {
    const result = await api.requestPermission()
    answered = result === "granted" ? "granted" : "denied"
  } catch {
    return getMotionStatus()
  }
  emit()
  return answered
}

/**
 * Subscribe to samples; returns an unsubscribe. SSR-safe (no-op on the server)
 * and a no-op where the status is not `granted`, because an engine that has not
 * been asked never fires. Events with nothing to read are dropped, so the first
 * call is the first real sample.
 */
export function subscribeMotion(
  listener: (sample: MotionSample) => void,
  options: MotionSubscribeOptions = {},
): () => void {
  if (typeof window === "undefined") return () => {}
  if (getMotionStatus() !== "granted") return () => {}
  const throttleMs = options.throttleMs ?? 0
  let last = Number.NEGATIVE_INFINITY
  const onMotion = (event: Event) => {
    const sample = toMotionSample(event as DeviceMotionEvent)
    if (!sample) return
    if (throttleMs > 0 && sample.at - last < throttleMs) return
    last = sample.at
    listener(sample)
  }
  window.addEventListener("devicemotion", onMotion)
  return () => window.removeEventListener("devicemotion", onMotion)
}

/** Test seam: forget the permission answer, as a fresh document would. */
export function resetMotion(): void {
  answered = null
}

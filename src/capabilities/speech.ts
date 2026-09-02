//Speech accessor — text to speech. ONE implementation for the targets that
//have an engine: the Web Speech API's `speechSynthesis`, which browsers and
//WKWebView carry (WKWebView over AVSpeechSynthesizer). There is no native
//branch, deliberately — the Android WebView does not implement the API at
//all, and reaching its system TTS engine means a plugin
//(`@capacitor-community/text-to-speech`), which is a dependency the owner
//decides, not a default. Until then Android native reads `unsupported`.
//
//## What was verified (2026-09-02)
//
//  • Playwright Chromium and WebKit, headless on macOS: both have
//    `speechSynthesis` on about:blank and on localhost; it is not gated on a
//    secure context the way motion is.
//  • Chromium's `getVoices()` is `[]` synchronously and 191 voices after
//    `voiceschanged`; WebKit has 223 synchronously and never fires the event.
//    So the list is a promise with a bounded wait, and the status has a
//    `loading` beat that only Chromium ever shows.
//  • On both, an utterance fires `start` then `end` even with no audio device,
//    so a spec can assert the outcome without hearing anything.
//  • The Android WebView (Pixel 10 emulator, API 36): `typeof speechSynthesis`
//    is `"undefined"`. Chrome has the API; the WebView does not.
//
//## The four ways it fails, all named
//
//An engine that exists can still say nothing: a device with no voices
//installed, a WebView whose audio session is silenced, or a page that spoke
//before any user gesture on an engine that requires one. None of those
//reject. `speak` therefore resolves `silent` when no `start` event arrives
//within `silentAfterMs`, cancels the utterance so the queue does not hold it,
//and the app renders the gap instead of a button that does nothing.

export type SpeechStatus =
  | "unsupported"
  | "loading"
  | "ready"
  | "no-voices"

/** One voice the engine offers. `id` is stable for the session, not across engines. */
export interface SpeechVoice {
  id: string
  name: string
  lang: string
  isDefault: boolean
  /** Synthesised on the device rather than by a network service. */
  isLocal: boolean
}

/**
 * `"spoke"` — the engine reported `end` after `start`.
 * `"cancelled"` — {@link stopSpeech}, the handle's `cancel`, or the engine
 * interrupting it for a newer utterance.
 * `"silent"` — no `start` within the window; the API exists and did nothing.
 * `"failed"` — the engine's `error` event; `reason` carries its code.
 */
export type SpeechOutcome = "spoke" | "cancelled" | "silent" | "failed"

export interface SpeakOptions {
  /** A {@link SpeechVoice} id; the engine's default when omitted or unknown. */
  voiceId?: string
  /** BCP 47 tag, when no voice is named. */
  lang?: string
  /** 0.1–10, engine-clamped. */
  rate?: number
  /** 0–2. */
  pitch?: number
  /** 0–1. */
  volume?: number
  /** How long to wait for `start` before resolving `silent`. */
  silentAfterMs?: number
}

export interface SpeechHandle {
  /** Resolves once; never rejects. */
  done: Promise<SpeechOutcome>
  /** The engine's error code when `done` resolved `"failed"`, else `null`. */
  reason: () => string | null
  cancel: () => void
}

/** Chromium fires `start` within a few hundred ms; two seconds is the gap. */
export const SPEECH_SILENT_AFTER_MS = 2_000
/** How long {@link listVoices} waits for Chromium's `voiceschanged`. */
export const SPEECH_VOICES_WAIT_MS = 1_500

//Engine error codes that mean "someone cancelled it", not "it broke".
const CANCEL_CODES = new Set(["canceled", "interrupted"])

type Engine = {
  getVoices: () => SpeechSynthesisVoice[]
  speak: (u: SpeechSynthesisUtterance) => void
  cancel: () => void
  speaking: boolean
  addEventListener?: (type: string, cb: () => void) => void
  removeEventListener?: (type: string, cb: () => void) => void
}

function engine(): Engine | null {
  if (typeof window === "undefined") return null
  const ss = (window as { speechSynthesis?: Engine }).speechSynthesis
  return ss && typeof ss.speak === "function" ? ss : null
}

let voices: readonly SpeechVoice[] = []
let voicesSettled = false
let voicesPromise: Promise<readonly SpeechVoice[]> | null = null
let speaking = false
let listening = false
const listeners = new Set<() => void>()
//Every unsettled utterance's "you were cancelled" — {@link stopSpeech} settles
//them itself, because the engines disagree on which event a cancel produces
//(Chromium an `error` of `canceled`/`interrupted`, WebKit an `end`, or nothing).
const open = new Set<() => void>()

function notify() {
  for (const cb of listeners) cb()
}

function setSpeaking(next: boolean) {
  if (speaking === next) return
  speaking = next
  notify()
}

function toVoice(v: SpeechSynthesisVoice): SpeechVoice {
  return {
    id: v.voiceURI,
    name: v.name,
    lang: v.lang,
    isDefault: v.default,
    isLocal: v.localService,
  }
}

function readVoices(ss: Engine): readonly SpeechVoice[] {
  return ss.getVoices().map(toVoice)
}

function adopt(next: readonly SpeechVoice[], settled: boolean) {
  const changed =
    settled !== voicesSettled ||
    next.length !== voices.length ||
    next.some((v, i) => v.id !== voices[i]?.id)
  voices = next
  voicesSettled = settled
  if (changed) notify()
}

//Chromium can add voices after the first `voiceschanged` too (a network voice
//list arriving late), so the listener stays for the life of the page.
function listen(ss: Engine) {
  if (listening || !ss.addEventListener) return
  listening = true
  ss.addEventListener("voiceschanged", () => adopt(readVoices(ss), true))
}

/**
 * Synchronous. `"loading"` is Chromium before its first `voiceschanged`; call
 * {@link listVoices} (or render {@link subscribeSpeech}) to move past it.
 */
export function getSpeechStatus(): SpeechStatus {
  const ss = engine()
  if (!ss) return "unsupported"
  if (voices.length > 0) return "ready"
  const now = readVoices(ss)
  if (now.length > 0) {
    adopt(now, true)
    return "ready"
  }
  return voicesSettled ? "no-voices" : "loading"
}

/** The voices known right now, without waiting. */
export function getVoices(): readonly SpeechVoice[] {
  if (voices.length === 0) getSpeechStatus()
  return voices
}

/**
 * The voice list once the engine has offered it, bounded by
 * {@link SPEECH_VOICES_WAIT_MS}. Resolves `[]` on an engine with none, or with
 * no API at all.
 */
export function listVoices(): Promise<readonly SpeechVoice[]> {
  const ss = engine()
  if (!ss) return Promise.resolve([])
  const now = readVoices(ss)
  if (now.length > 0) {
    adopt(now, true)
    return Promise.resolve(voices)
  }
  if (voicesSettled) return Promise.resolve(voices)
  if (voicesPromise) return voicesPromise
  listen(ss)
  voicesPromise = new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      ss.removeEventListener?.("voiceschanged", finish)
      adopt(readVoices(ss), true)
      voicesPromise = null
      resolve(voices)
    }
    const timer = setTimeout(finish, SPEECH_VOICES_WAIT_MS)
    ss.addEventListener?.("voiceschanged", finish)
  })
  return voicesPromise
}

export function isSpeaking(): boolean {
  return speaking
}

/**
 * Speak `text`. The handle's `done` names the outcome; `cancel` stops this
 * utterance and everything queued behind it (the engine has one queue).
 */
export function speak(
  text: string,
  options: SpeakOptions = {},
): SpeechHandle {
  const ss = engine()
  let reason: string | null = null
  if (!ss) {
    reason = "unsupported"
    return {
      done: Promise.resolve("failed"),
      reason: () => reason,
      cancel: () => {},
    }
  }
  listen(ss)
  const u = new SpeechSynthesisUtterance(text)
  if (options.voiceId) {
    const v = ss.getVoices().find((x) => x.voiceURI === options.voiceId)
    if (v) u.voice = v
  }
  if (options.lang) u.lang = options.lang
  if (options.rate !== undefined) u.rate = options.rate
  if (options.pitch !== undefined) u.pitch = options.pitch
  if (options.volume !== undefined) u.volume = options.volume

  let settled = false
  let started = false
  let resolveDone: (o: SpeechOutcome) => void = () => {}
  const done = new Promise<SpeechOutcome>((resolve) => {
    resolveDone = resolve
  })
  const settle = (outcome: SpeechOutcome) => {
    if (settled) return
    settled = true
    clearTimeout(silence)
    open.delete(cancelled)
    setSpeaking(false)
    resolveDone(outcome)
  }
  const cancelled = () => settle("cancelled")
  open.add(cancelled)
  const silence = setTimeout(() => {
    if (started || settled) return
    //Drop it from the queue too, or the next `speak` waits behind a ghost.
    ss.cancel()
    settle("silent")
  }, options.silentAfterMs ?? SPEECH_SILENT_AFTER_MS)

  u.onstart = () => {
    if (settled) return
    started = true
    clearTimeout(silence)
    setSpeaking(true)
  }
  u.onend = () => settle(started ? "spoke" : "cancelled")
  u.onerror = (e) => {
    const code = e.error ?? "unknown"
    if (CANCEL_CODES.has(code)) {
      settle("cancelled")
      return
    }
    reason = code
    settle("failed")
  }
  ss.speak(u)
  return {
    done,
    reason: () => reason,
    cancel: () => {
      if (settled) return
      //Settle first: the outcome must not wait on an event the engine may
      //never send for an utterance that had not started.
      settle("cancelled")
      ss.cancel()
    },
  }
}

/** Stop everything, spoken and queued. Every open handle resolves `"cancelled"`. */
export function stopSpeech(): void {
  const ss = engine()
  if (!ss) return
  for (const cancel of [...open]) cancel()
  ss.cancel()
  setSpeaking(false)
}

/** Re-render on a voice-list, status or speaking change. */
export function subscribeSpeech(cb: () => void): () => void {
  listeners.add(cb)
  const ss = engine()
  if (ss) {
    listen(ss)
    if (voices.length === 0 && !voicesSettled) void listVoices()
  }
  return () => {
    listeners.delete(cb)
  }
}

/** Test seam: forget the voice list and the speaking flag. */
export function resetSpeech(): void {
  voices = []
  voicesSettled = false
  voicesPromise = null
  speaking = false
  listening = false
  listeners.clear()
  open.clear()
}

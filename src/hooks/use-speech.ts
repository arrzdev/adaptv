import { useCallback, useRef, useState, useSyncExternalStore } from "react"
import type {
  SpeakOptions,
  SpeechOutcome,
  SpeechStatus,
  SpeechVoice,
} from "#adaptv/capabilities/speech"
import {
  getSpeechStatus,
  getVoices,
  isSpeaking,
  speak as speakNow,
  stopSpeech,
  subscribeSpeech,
} from "#adaptv/capabilities/speech"

export type UseSpeechResult = {
  status: SpeechStatus
  voices: readonly SpeechVoice[]
  /** An utterance has started and not yet ended. */
  speaking: boolean
  /** Outcome of the most recent `speak`, or `null` before the first. */
  last: SpeechOutcome | null
  /** The engine's error code when `last` is `"failed"`, else `null`. */
  reason: string | null
  /** Speak, and resolve to the outcome; never rejects. */
  speak: (text: string, options?: SpeakOptions) => Promise<SpeechOutcome>
  /** Stop everything spoken and queued. */
  stop: () => void
}

type Snapshot = {
  status: SpeechStatus
  voices: readonly SpeechVoice[]
  speaking: boolean
}

const SERVER: Snapshot = {
  status: "unsupported",
  voices: [],
  speaking: false,
}
const serverSnapshot = () => SERVER

/**
 * Text to speech, as a hook. `status` moves `loading` → `ready` on Chromium
 * once the voice list arrives, so a page that renders voices re-renders on
 * its own; `last` and `reason` are the outcome the button should show, because
 * a speak that resolved `"silent"` looks exactly like one that worked unless
 * something says so.
 */
export function useSpeech(): UseSpeechResult {
  const cache = useRef<Snapshot>(SERVER)
  const read = useCallback((): Snapshot => {
    const status = getSpeechStatus()
    const voices = getVoices()
    const speaking = isSpeaking()
    const prev = cache.current
    if (
      prev.status === status &&
      prev.voices === voices &&
      prev.speaking === speaking
    ) {
      return prev
    }
    cache.current = { status, voices, speaking }
    return cache.current
  }, [])
  const snap = useSyncExternalStore(subscribeSpeech, read, serverSnapshot)
  const [last, setLast] = useState<SpeechOutcome | null>(null)
  const [reason, setReason] = useState<string | null>(null)

  const speak = useCallback(
    async (text: string, options?: SpeakOptions) => {
      const handle = speakNow(text, options)
      const outcome = await handle.done
      setLast(outcome)
      setReason(handle.reason())
      return outcome
    },
    [],
  )
  const stop = useCallback(() => stopSpeech(), [])

  return {
    status: snap.status,
    voices: snap.voices,
    speaking: snap.speaking,
    last,
    reason,
    speak,
    stop,
  }
}

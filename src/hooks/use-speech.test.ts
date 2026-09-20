import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { SpeechOutcome } from "#adaptv/capabilities/speech"
import {
  getSpeechStatus,
  getVoices,
  isSpeaking,
  speak,
  stopSpeech,
  subscribeSpeech,
} from "#adaptv/capabilities/speech"
import { useSpeech } from "#adaptv/hooks/use-speech"

let notify: (() => void) | null = null
let resolveDone: ((o: SpeechOutcome) => void) | null = null
let reason: string | null = null

vi.mock("#adaptv/capabilities/speech", () => ({
  getSpeechStatus: vi.fn(() => "ready"),
  getVoices: vi.fn(() => []),
  isSpeaking: vi.fn(() => false),
  speak: vi.fn(() => ({
    done: new Promise<SpeechOutcome>((r) => {
      resolveDone = r
    }),
    reason: () => reason,
    cancel: () => {},
  })),
  stopSpeech: vi.fn(),
  subscribeSpeech: vi.fn((cb: () => void) => {
    notify = cb
    return () => {
      notify = null
    }
  }),
}))

const VOICES = [
  {
    id: "uri:Samantha",
    name: "Samantha",
    lang: "en-US",
    isDefault: true,
    isLocal: true,
  },
]

beforeEach(() => {
  vi.mocked(getSpeechStatus).mockReturnValue("ready")
  vi.mocked(getVoices).mockReturnValue([])
  vi.mocked(isSpeaking).mockReturnValue(false)
  reason = null
})

afterEach(() => {
  notify = null
  resolveDone = null
  vi.clearAllMocks()
})

describe("useSpeech", () => {
  it("re-renders when the voice list arrives", () => {
    vi.mocked(getSpeechStatus).mockReturnValue("loading")
    const { result } = renderHook(() => useSpeech())
    expect(result.current.status).toBe("loading")
    expect(result.current.voices).toEqual([])
    vi.mocked(getSpeechStatus).mockReturnValue("ready")
    vi.mocked(getVoices).mockReturnValue(VOICES)
    act(() => notify?.())
    expect(result.current.status).toBe("ready")
    expect(result.current.voices).toBe(VOICES)
  })

  it("carries the outcome and the reason of the last speak", async () => {
    const { result } = renderHook(() => useSpeech())
    expect(result.current.last).toBeNull()
    let outcome: Promise<SpeechOutcome> | undefined
    act(() => {
      outcome = result.current.speak("hello", { rate: 2 })
    })
    expect(speak).toHaveBeenCalledWith("hello", { rate: 2 })
    reason = "synthesis-failed"
    await act(async () => {
      resolveDone?.("failed")
      await outcome
    })
    await waitFor(() => expect(result.current.last).toBe("failed"))
    expect(result.current.reason).toBe("synthesis-failed")
  })

  it("follows the speaking flag and stops through the capability", () => {
    const { result } = renderHook(() => useSpeech())
    vi.mocked(isSpeaking).mockReturnValue(true)
    act(() => notify?.())
    expect(result.current.speaking).toBe(true)
    act(() => result.current.stop())
    expect(stopSpeech).toHaveBeenCalledTimes(1)
    expect(subscribeSpeech).toHaveBeenCalled()
  })
})

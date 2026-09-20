import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  getSpeechStatus,
  getVoices,
  isSpeaking,
  listVoices,
  resetSpeech,
  SPEECH_SILENT_AFTER_MS,
  SPEECH_VOICES_WAIT_MS,
  speak,
  stopSpeech,
  subscribeSpeech,
} from "#adaptv/capabilities/speech"

type Handlers = {
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}

class FakeUtterance implements Handlers {
  text: string
  voice: unknown = null
  lang = ""
  rate = 1
  pitch = 1
  volume = 1
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

function voice(name: string, lang = "en-US", isDefault = false) {
  return {
    voiceURI: `uri:${name}`,
    name,
    lang,
    default: isDefault,
    localService: true,
  }
}

//A fake `speechSynthesis`: a voice list the test can change, a `voiceschanged`
//it can fire, and the utterances it was handed so the test can play the engine.
function installEngine(initial: ReturnType<typeof voice>[] = []) {
  let list = initial
  const spoken: FakeUtterance[] = []
  const handlers = new Set<() => void>()
  const engine = {
    getVoices: () => list,
    speak: (u: FakeUtterance) => {
      spoken.push(u)
    },
    cancel: vi.fn(),
    speaking: false,
    addEventListener: (_t: string, cb: () => void) => {
      handlers.add(cb)
    },
    removeEventListener: (_t: string, cb: () => void) => {
      handlers.delete(cb)
    },
  }
  vi.stubGlobal("speechSynthesis", engine)
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance)
  return {
    engine,
    spoken,
    setVoices(next: ReturnType<typeof voice>[]) {
      list = next
      for (const cb of [...handlers]) cb()
    },
    last: () => spoken[spoken.length - 1] as FakeUtterance,
  }
}

beforeEach(() => {
  resetSpeech()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("speech — the status", () => {
  it("is unsupported without the API, and speak fails by name", async () => {
    vi.stubGlobal("speechSynthesis", undefined)
    expect(getSpeechStatus()).toBe("unsupported")
    expect(await listVoices()).toEqual([])
    const h = speak("hi")
    expect(await h.done).toBe("failed")
    expect(h.reason()).toBe("unsupported")
  })

  it("is loading before Chromium's voiceschanged, then ready", async () => {
    const fake = installEngine([])
    expect(getSpeechStatus()).toBe("loading")
    const p = listVoices()
    fake.setVoices([
      voice("Samantha", "en-US", true),
      voice("Amélie", "fr-CA"),
    ])
    expect(await p).toEqual([
      {
        id: "uri:Samantha",
        name: "Samantha",
        lang: "en-US",
        isDefault: true,
        isLocal: true,
      },
      {
        id: "uri:Amélie",
        name: "Amélie",
        lang: "fr-CA",
        isDefault: false,
        isLocal: true,
      },
    ])
    expect(getSpeechStatus()).toBe("ready")
  })

  it("is ready at once on an engine that lists voices synchronously", () => {
    installEngine([voice("Majed", "ar-001", true)])
    expect(getSpeechStatus()).toBe("ready")
    expect(getVoices().map((v) => v.name)).toEqual(["Majed"])
  })

  it("is no-voices once the bounded wait ends with none", async () => {
    installEngine([])
    const p = listVoices()
    vi.advanceTimersByTime(SPEECH_VOICES_WAIT_MS)
    expect(await p).toEqual([])
    expect(getSpeechStatus()).toBe("no-voices")
  })

  it("notifies a subscriber when the list arrives", async () => {
    const fake = installEngine([])
    const cb = vi.fn()
    subscribeSpeech(cb)
    fake.setVoices([voice("Samantha")])
    await Promise.resolve()
    expect(cb).toHaveBeenCalled()
    expect(getSpeechStatus()).toBe("ready")
  })
})

describe("speech — an utterance", () => {
  it("resolves spoke after start and end, and tracks speaking", async () => {
    const fake = installEngine([voice("Samantha", "en-US", true)])
    expect(getSpeechStatus()).toBe("ready")
    const cb = vi.fn()
    subscribeSpeech(cb)
    const h = speak("hello", { rate: 1.2, pitch: 0.8, volume: 0.5 })
    const u = fake.last()
    expect(u.text).toBe("hello")
    expect([u.rate, u.pitch, u.volume]).toEqual([1.2, 0.8, 0.5])
    u.onstart?.()
    expect(isSpeaking()).toBe(true)
    u.onend?.()
    expect(await h.done).toBe("spoke")
    expect(isSpeaking()).toBe(false)
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it("picks the named voice, and ignores an unknown id", () => {
    const fake = installEngine([
      voice("Samantha"),
      voice("Amélie", "fr-CA"),
    ])
    speak("bonjour", { voiceId: "uri:Amélie" })
    expect((fake.last().voice as { name: string }).name).toBe("Amélie")
    speak("hello", { voiceId: "uri:nobody", lang: "en-GB" })
    expect(fake.last().voice).toBeNull()
    expect(fake.last().lang).toBe("en-GB")
  })

  it("resolves failed with the engine's code", async () => {
    const fake = installEngine([voice("Samantha")])
    const h = speak("hello")
    fake.last().onerror?.({ error: "synthesis-failed" })
    expect(await h.done).toBe("failed")
    expect(h.reason()).toBe("synthesis-failed")
  })

  it("reads the engine's cancel codes as cancelled, not failed", async () => {
    const fake = installEngine([voice("Samantha")])
    const h = speak("hello")
    fake.last().onstart?.()
    fake.last().onerror?.({ error: "interrupted" })
    expect(await h.done).toBe("cancelled")
    expect(h.reason()).toBeNull()
  })

  it("resolves silent when start never comes, and clears the queue", async () => {
    const fake = installEngine([voice("Samantha")])
    const h = speak("hello")
    vi.advanceTimersByTime(SPEECH_SILENT_AFTER_MS)
    expect(await h.done).toBe("silent")
    expect(fake.engine.cancel).toHaveBeenCalledTimes(1)
    //A late start must not flip a settled outcome or the flag.
    fake.last().onstart?.()
    expect(isSpeaking()).toBe(false)
  })

  it("honours a shorter silence window", async () => {
    installEngine([voice("Samantha")])
    const h = speak("hello", { silentAfterMs: 100 })
    vi.advanceTimersByTime(100)
    expect(await h.done).toBe("silent")
  })

  it("cancel settles before the engine answers", async () => {
    const fake = installEngine([voice("Samantha")])
    const h = speak("hello")
    h.cancel()
    expect(await h.done).toBe("cancelled")
    expect(fake.engine.cancel).toHaveBeenCalledTimes(1)
    //WebKit sends `end` for a cancelled utterance; it must not become spoke.
    fake.last().onend?.()
    expect(await h.done).toBe("cancelled")
  })

  it("stopSpeech cancels every open utterance", async () => {
    const fake = installEngine([voice("Samantha")])
    const a = speak("one")
    const b = speak("two")
    fake.spoken[0]?.onstart?.()
    expect(isSpeaking()).toBe(true)
    stopSpeech()
    expect(await a.done).toBe("cancelled")
    expect(await b.done).toBe("cancelled")
    expect(isSpeaking()).toBe(false)
    expect(fake.engine.cancel).toHaveBeenCalledTimes(1)
  })
})

describe("speech — the engine's one queue", () => {
  it("a queued utterance is not silent while the one ahead of it is still speaking", async () => {
    //the engine plays one utterance at a time, so a second `speak` cannot start
    //until the first ends; its silence window must not run until its turn, or
    //the window's `cancel` would cut the first sentence off mid-word
    const fake = installEngine([voice("Samantha")])
    const a = speak("a long first sentence")
    const b = speak("next")
    const [ua, ub] = fake.spoken
    ua?.onstart?.()
    vi.advanceTimersByTime(SPEECH_SILENT_AFTER_MS * 3)
    expect(fake.engine.cancel).not.toHaveBeenCalled()
    expect(isSpeaking()).toBe(true)

    ua?.onend?.()
    expect(await a.done).toBe("spoke")
    ub?.onstart?.()
    ub?.onend?.()
    expect(await b.done).toBe("spoke")
    expect(fake.engine.cancel).not.toHaveBeenCalled()
  })

  it("the silence window starts when the utterance reaches the head of the queue", async () => {
    const fake = installEngine([voice("Samantha")])
    const a = speak("one")
    const b = speak("two")
    fake.spoken[0]?.onstart?.()
    vi.advanceTimersByTime(SPEECH_SILENT_AFTER_MS * 2)
    fake.spoken[0]?.onend?.()
    expect(await a.done).toBe("spoke")
    vi.advanceTimersByTime(SPEECH_SILENT_AFTER_MS - 1)
    let settled = false
    void b.done.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    vi.advanceTimersByTime(1)
    expect(await b.done).toBe("silent")
  })

  it("one handle's cancel settles every open handle, because the engine's cancel is global", async () => {
    //Chromium answers the others with an `interrupted` error, WebKit with `end`
    //or nothing — so the handles cannot wait on the engine to hear about it
    const fake = installEngine([voice("Samantha")])
    const a = speak("one")
    const b = speak("two")
    fake.spoken[0]?.onstart?.()
    b.cancel()
    expect(await a.done).toBe("cancelled")
    expect(await b.done).toBe("cancelled")
    //WebKit's `end` for the interrupted one must not turn it into spoke
    fake.spoken[0]?.onend?.()
    expect(await a.done).toBe("cancelled")
    expect(isSpeaking()).toBe(false)
    expect(fake.engine.cancel).toHaveBeenCalledTimes(1)
  })
})

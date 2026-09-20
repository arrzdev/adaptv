import { useSpeech } from "@arrzdev/adaptv/hooks"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import type { LabLogEntry } from "@/components/lab/lab-kit"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabLog,
  LabRow,
  LabSection,
  labLogEntry,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/speech")({
  component: LabSpeechPage,
})

type SpeechStatus = ReturnType<typeof useSpeech>["status"]

const STATUS_TONE: Record<SpeechStatus, "ok" | "warn" | "bad" | "muted"> =
  {
    ready: "ok",
    loading: "muted",
    "no-voices": "warn",
    unsupported: "bad",
  }

/** What the page shows for "nothing to report" — one glyph, so the spec can pin it. */
const NONE = "—"

function LabSpeechPage() {
  const { status, voices, speaking, last, reason, speak, stop } =
    useSpeech()
  const [text, setText] = useState("hello from the lab")
  const [log, setLog] = useState<LabLogEntry[]>([])

  const append = (entry: string) =>
    setLog((entries) => [labLogEntry(entry), ...entries].slice(0, 40))

  const defaultVoice = voices.find((voice) => voice.isDefault) ?? voices[0]

  const onSpeak = () => {
    append(`speak("${text}")`)
    void speak(text).then((outcome) => append(`→ ${outcome}`))
  }

  const onStop = () => {
    append("stop()")
    stop()
  }

  return (
    <LabPage
      title="Speech"
      subtitle="Text to speech over the web speechSynthesis API — one implementation for all targets, and a status that says when the API is there but nothing comes out."
    >
      <LabBrief
        what="Whether this target can list its voices and actually speak, and whether the four outcomes — spoke, cancelled, silent, failed — are told apart rather than all reading as “done”."
        steps={[
          "Read the status row first. `loading` is a beat on Chromium (the voice list arrives on voiceschanged); it must settle to `ready` with a voice count above zero and a default voice by name.",
          "Press Speak. `speaking` must go true, you must hear the phrase, and the last outcome must read `spoke` once the engine reaches the end.",
          "Type a long sentence, press Speak, then press Stop while it is still talking. The outcome must read `cancelled`, not `spoke` and not an error.",
          "Mute the device and press Speak again. The outcome must still read `spoke` — mute is not a failure, the engine ran.",
          "If the status reads `no-voices`, that is the finding: the API is present and the engine has nothing to say with.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "speechSynthesis is in every current browser. Chromium reports an empty voice list synchronously and fills it on voiceschanged — the status passes through `loading` for a beat. Firefox and Safari have the voices at once.",
          },
          pwa: {
            verdict: "works",
            note: "Same API, same engine as the browser it was installed from. iOS Safari needs a user gesture before the first utterance is audible; the Speak button is one.",
          },
          ios: {
            verdict: "works",
            note: "Same web API inside WKWebView, no native branch. On the simulator the list is the system's 68 voices with Samantha as the default, and Speak reaches `spoke`; whether a muted device or a silenced audio session changes that is a physical-device question.",
          },
          android: {
            verdict: "absent",
            note: "The Android WebView does not implement the Web Speech API — `typeof speechSynthesis` is undefined there (measured on the Pixel 10 emulator, API 36), while Chrome on the same device has it. The status reads `unsupported`, Speak resolves `failed` with the reason `unsupported`, and nothing is silently pretended. Reaching the system TTS engine needs a plugin, which is a dependency decision.",
          },
        }}
        wrong="The status reads `ready` and Speak resolves `spoke` while nothing was ever heard (the engine fired start and end for an utterance it did not voice — `silent` exists for the case where it fires neither, and this is the one it cannot catch). Or Stop leaves the outcome at `spoke`, which means an interrupted announcement is indistinguishable from a finished one."
      />

      <LabSection title="Engine">
        <LabRow
          label="status"
          value={
            <span data-testid="speech-status">
              <LabBadge tone={STATUS_TONE[status]}>{status}</LabBadge>
            </span>
          }
          hint="`unsupported`: no speechSynthesis. `loading`: the list is empty and voiceschanged has not fired. `no-voices`: the bounded wait ended with none."
        />
        <LabRow
          label="voices"
          value={<span data-testid="speech-voices">{voices.length}</span>}
        />
        <LabRow
          label="default voice"
          value={
            <span data-testid="speech-default">
              {defaultVoice ? defaultVoice.name : NONE}
            </span>
          }
          hint="The engine's own default, or the first voice when it marks none."
        />
      </LabSection>

      <LabSection
        title="Speak"
        description="speak() resolves with the outcome once the engine has said so — after end, after cancel, after error, or after the silent wait."
      >
        <input
          type="text"
          data-testid="speech-text"
          aria-label="Text to speak"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="w-full rounded-md bg-secondary px-3 py-2 text-sm text-foreground ring-1 ring-inset ring-border-subtle"
        />
        <LabActions>
          <LabButton data-testid="speech-speak" onClick={onSpeak}>
            Speak
          </LabButton>
          <LabButton
            data-testid="speech-stop"
            tone="danger"
            onClick={onStop}
          >
            Stop
          </LabButton>
        </LabActions>
        <LabRow
          label="speaking"
          value={
            <span data-testid="speech-speaking">
              <LabBadge tone={speaking ? "ok" : "muted"}>
                {String(speaking)}
              </LabBadge>
            </span>
          }
        />
        <LabRow
          label="last outcome"
          value={
            <span data-testid="speech-last">
              {last === null ? (
                NONE
              ) : (
                <LabBadge tone={last === "spoke" ? "ok" : "warn"}>
                  {last}
                </LabBadge>
              )}
            </span>
          }
          hint="`cancelled` is a normal outcome — Stop was pressed. `silent` means no start event within the wait: the API exists but nothing happens."
        />
        <LabRow
          label="reason"
          value={<span data-testid="speech-reason">{reason ?? NONE}</span>}
          hint="The engine's error string when the outcome is `failed`; otherwise nothing."
        />
      </LabSection>

      <LabSection
        title="Events"
        description="One line per speak call and one per outcome, as they arrive."
      >
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}

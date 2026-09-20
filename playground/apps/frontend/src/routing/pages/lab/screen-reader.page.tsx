import type {
  AnnounceOutcome,
  ScreenReaderStatus,
} from "@arrzdev/adaptv/capabilities"
import { useScreenReader } from "@arrzdev/adaptv/hooks"
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

export const Route = createFileRoute("/_providers/lab/screen-reader")({
  component: LabScreenReaderPage,
})

const FIELD_CLASSNAME =
  "w-full rounded-md bg-secondary px-3 py-2 text-base text-foreground ring-1 ring-inset ring-border-subtle focus:outline-none focus:ring-primary"

function StatusBadge({ status }: { status: ScreenReaderStatus }) {
  const tone = status === "on" ? "ok" : status === "off" ? "warn" : "muted"
  return (
    <LabBadge tone={tone}>
      <span data-testid="reader-status">{status}</span>
    </LabBadge>
  )
}

function OutcomeBadge({ outcome }: { outcome: AnnounceOutcome | null }) {
  const tone =
    outcome === null ? "muted" : outcome === "announced" ? "ok" : "warn"
  return (
    <LabBadge tone={tone}>
      <span data-testid="reader-last">{outcome ?? "—"}</span>
    </LabBadge>
  )
}

function LabScreenReaderPage() {
  const { status, announce } = useScreenReader()
  const [text, setText] = useState("Two items saved")
  const [last, setLast] = useState<AnnounceOutcome | null>(null)
  const [log, setLog] = useState<LabLogEntry[]>([])
  const append = (entry: string) =>
    setLog((entries) => [...entries, labLogEntry(entry)])

  async function say() {
    append(`announce → ${text}`)
    const outcome = await announce(text)
    setLast(outcome)
    append(`announce: ${outcome}`)
  }

  return (
    <LabPage
      title="Screen reader"
      subtitle="Whether VoiceOver or TalkBack is driving the app, and one way to say something to it on every target."
    >
      <LabBrief
        what="That the status row is the OS's own answer and moves when the reader is switched, that the web reads unknown rather than guessing, and that an announcement reaches the reader where one runs and costs nothing where none does."
        steps={[
          "Read the status. On the web it reads `unknown` — no browser exposes whether a reader is running, and a guess would be worse than the word.",
          "On iOS, turn VoiceOver on in Settings and come back: the row must read `on` without a relaunch. Turn it off: `off`.",
          "Press “Announce”. With a reader on it must speak the text and the outcome must read `announced`; with none it reads `silent` on native.",
          "On the web the outcome reads `announced` every time: the text lands in a polite live region, which a running reader speaks and an absent one ignores.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Status reads unknown, on purpose. Announce writes a polite ARIA live region and reads announced; whether anything speaks depends on a reader the page cannot see.",
          },
          pwa: {
            verdict: "partial",
            note: "Same as the tab it was installed from.",
          },
          ios: {
            verdict: "works",
            note: "Status follows VoiceOver live, including a switch made in Settings while the app was in the background. Announce posts a VoiceOver announcement while it runs, and reads silent otherwise.",
          },
          android: {
            verdict: "partial",
            note: "Status follows TalkBack's touch exploration. The Pixel emulator image ships no TalkBack, so it reads off there and announce reads silent; a device with TalkBack reads on and speaks.",
          },
        }}
        wrong="Status reads on or off in a browser. Or it stays stale after VoiceOver is switched in Settings and the app comes back. Or announce reads announced on native with no reader running — the OS would have spoken to nobody."
      />

      <LabSection
        title="Status"
        description="The plugin's stateChange keeps it live on native; re-read on resume."
      >
        <LabRow label="reader" value={<StatusBadge status={status} />} />
      </LabSection>

      <LabSection
        title="Announce"
        description="A polite live region on the web; the OS announcement on native, only while a reader is on."
      >
        <label className="flex flex-col gap-y-1 text-xs text-subtle">
          text
          <input
            type="text"
            data-testid="reader-text"
            className={FIELD_CLASSNAME}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <LabActions>
          <LabButton
            data-testid="reader-announce"
            onClick={() => void say()}
          >
            Announce
          </LabButton>
        </LabActions>
        <LabRow
          label="last outcome"
          value={<OutcomeBadge outcome={last} />}
          hint="`silent` is an ordinary outcome — nothing here rejects."
        />
      </LabSection>

      <LabSection title="Log">
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}

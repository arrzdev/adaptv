import type { ComposeSupport } from "@arrzdev/adaptv/capabilities"
import { useCompose } from "@arrzdev/adaptv/hooks"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { cn } from "@arrzdev/adaptv/utils"
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

export const Route = createFileRoute("/_providers/lab/compose")({
  component: LabComposePage,
})

const FIELD_CLASSNAME =
  "w-full rounded-md bg-secondary px-3 py-2 text-base text-foreground ring-1 ring-inset ring-border-subtle focus:outline-none focus:ring-primary"

/**
 * The support word for one kind, or `probing` while the hook has not answered.
 * `unknown` is the web's honest answer — a browser cannot say whether a mail
 * client is configured — so it is painted neutral, not red.
 */
function SupportBadge({
  testId,
  support,
}: {
  testId: string
  support: ComposeSupport | null
}) {
  const tone =
    support === "available"
      ? "ok"
      : support === "no-handler"
        ? "bad"
        : "muted"
  return (
    <LabBadge tone={tone}>
      <span data-testid={testId}>{support ?? "probing"}</span>
    </LabBadge>
  )
}

function LabComposePage() {
  const { mail, sms, composeMail, composeSms, last, lastUrl } =
    useCompose()
  const [to, setTo] = useState("support@example.com")
  const [smsTo, setSmsTo] = useState("+15550001")
  const [subject, setSubject] = useState("Hello from the lab")
  const [body, setBody] = useState("first line\nsecond line")
  const [log, setLog] = useState<LabLogEntry[]>([])

  const append = (text: string) =>
    setLog((entries) => [...entries, labLogEntry(text)])

  async function runMail() {
    append(`composeMail → ${to}`)
    const outcome = await composeMail({ to: [to], subject, body })
    append(`mail: ${outcome}`)
  }

  async function runSms() {
    append(`composeSms → ${smsTo}`)
    const outcome = await composeSms({ to: [smsTo], body })
    append(`sms: ${outcome}`)
  }

  return (
    <LabPage
      title="Compose"
      subtitle="A mail or SMS draft handed to whatever composer the OS has — through a mailto: or sms: URL, never a bridge of our own."
    >
      <LabBrief
        what="Whether this target can open a pre-filled mail or SMS composer, what it says about a handler BEFORE the button is pressed, and that the URL the module builds carries the whole draft."
        steps={[
          "Read the two support badges. On the web both read `unknown` — that is the correct answer, not a gap.",
          "Press “Compose mail”. A mail composer must open with the recipient, the subject and both body lines filled in.",
          "Come back. The last outcome must read `opened` and the URL row must show the mailto: that was handed over.",
          "Press “Compose SMS”. Messages must open with the number and the body; the outcome must read `opened` again.",
          "On a target with no handler for one of the kinds, the badge must say `no-handler` and pressing the button must yield `no-handler` — not a blank tab and not a throw.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "The browser hands mailto: and sms: to whatever the OS has registered; a desktop with no mail client shows the browser's own “choose an app” prompt. Support reads unknown on both rows, because no browser can tell whether a handler exists.",
          },
          pwa: {
            verdict: "works",
            note: "Same as the tab it was installed from: the URL leaves the app and the OS resolves it. Support still reads unknown.",
          },
          ios: {
            verdict: "partial",
            note: "The simulator ships no Mail app, so mail reads `no-handler` there and pressing the button yields the same word — while sms opens Messages. A real device with Mail configured reads `available` for both.",
          },
          android: {
            verdict: "works",
            note: "Messages and Gmail are both on the emulator's Play image, so both rows read `available` and both composers open pre-filled.",
          },
        }}
        wrong="A support badge says `available` and pressing the button opens nothing (the OS lied, or the URL never left the webview). Or a body with a line break arrives as one line — the `%0A` was lost somewhere between the draft and the composer. Or `no-handler` surfaces as an error rather than as an outcome: it is an ordinary answer, and an app that toasts on it is wrong on every simulator."
      />

      <LabSection
        title="Support"
        description="Asked of the OS on native; the web has no way to ask, so it reads unknown on purpose."
      >
        <LabRow
          label="mail"
          value={
            <SupportBadge testId="compose-mail-support" support={mail} />
          }
        />
        <LabRow
          label="sms"
          value={
            <SupportBadge testId="compose-sms-support" support={sms} />
          }
        />
      </LabSection>

      <LabSection
        title="Draft"
        description="Every field is encoded into the URL; the body keeps its line break."
      >
        <label className="flex flex-col gap-y-1 text-xs text-subtle">
          mail to
          <input
            type="email"
            data-testid="compose-to"
            className={FIELD_CLASSNAME}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-y-1 text-xs text-subtle">
          sms to
          <input
            type="tel"
            data-testid="compose-sms-to"
            className={FIELD_CLASSNAME}
            value={smsTo}
            onChange={(e) => setSmsTo(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-y-1 text-xs text-subtle">
          subject (mail only)
          <input
            type="text"
            data-testid="compose-subject"
            className={FIELD_CLASSNAME}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-y-1 text-xs text-subtle">
          body
          <textarea
            data-testid="compose-body"
            className={cn(FIELD_CLASSNAME, "min-h-20 resize-y")}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
      </LabSection>

      <LabSection
        title="Open the composer"
        description="On the web the URL is handed to the browser with window.open(url, “_self”); on native the OS opens it straight away and reports no-handler when nothing took it."
      >
        <LabActions>
          <LabButton
            data-testid="compose-mail"
            onClick={() => void runMail()}
          >
            Compose mail
          </LabButton>
          <LabButton
            data-testid="compose-sms"
            onClick={() => void runSms()}
          >
            Compose SMS
          </LabButton>
        </LabActions>
        <LabRow
          label="last outcome"
          value={
            <LabBadge
              tone={
                last === null ? "muted" : last === "opened" ? "ok" : "warn"
              }
            >
              <span data-testid="compose-last">{last ?? "—"}</span>
            </LabBadge>
          }
          hint="`no-handler` is an ordinary outcome — the composer never rejects for it."
        />
        <div className="flex flex-col gap-y-0.5">
          <span className="text-sm text-subtle">last url</span>
          {/*
           * Not a LabRow: its string branch truncates, and the whole point of this
           * row is to read the URL end to end. break-all, because a URL has no
           * spaces to wrap at.
           */}
          <code
            data-testid="compose-url"
            className="rounded-md bg-secondary px-2 py-1 font-mono text-xs break-all text-foreground"
          >
            {lastUrl ?? "—"}
          </code>
        </div>
      </LabSection>

      <LabSection title="Log">
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}

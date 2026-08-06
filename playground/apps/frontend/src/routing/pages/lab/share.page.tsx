import type { ShareTarget } from "@arrzdev/adaptv/capabilities"
import { useShare } from "@arrzdev/adaptv/hooks"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabOutcome,
  LabRow,
  LabSection,
  LabSupport,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/share")({
  component: LabSharePage,
})

const TEXT_ONLY: ShareTarget = {
  title: "adaptv",
  text: "One codebase, six targets.",
}
const WITH_URL: ShareTarget = {
  title: "adaptv",
  text: "One codebase, six targets.",
  url: "https://example.com/adaptv",
  dialogTitle: "Send adaptv to…",
}

/** A real File, built in the page so the file-payload gate is exercised honestly. */
function textFile(): File {
  return new File(["hello from the lab"], "lab.txt", {
    type: "text/plain",
  })
}

function LabSharePage() {
  const { supported, canShare, share, outcome, sharing, error } =
    useShare()
  const [files] = useState(() =>
    typeof File === "undefined" ? [] : [textFile()],
  )

  const payloads: Array<{ label: string; target: ShareTarget }> = [
    { label: "text only", target: TEXT_ONLY },
    { label: "title + text + url", target: WITH_URL },
    { label: "a text file", target: { ...TEXT_ONLY, files } },
  ]

  return (
    <LabPage
      title="Share"
      subtitle="Two probes, because the Web Share API gates twice: on the platform, and again on the payload."
    >
      <LabBrief
        what="Whether this target can open the OS share sheet at all, whether it accepts each payload shape, and that a dismissed sheet is an ordinary outcome rather than an error."
        steps={[
          "Read the support badge, then the three per-payload rows. They answer different questions and can disagree.",
          "Press “Share text only”. The OS sheet must appear.",
          "Dismiss the sheet WITHOUT choosing anything. The last outcome must read `dismissed`, and no error must appear.",
          "Share it again and actually pick a target. The outcome must read `shared`.",
          "Press “Share a text file”. If the row above said `refused`, nothing must open and the outcome must say so rather than throwing.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Desktop Chrome and every Firefox have no navigator.share at all, so the whole page reads unsupported — correct. Mobile Safari and Chrome on Android do have it; the file payload is the one most often refused.",
          },
          pwa: {
            verdict: "works",
            note: "Same as the mobile browser it was installed from — an installed PWA gains nothing here, and loses nothing.",
          },
          ios: {
            verdict: "works",
            note: "Always supported: the native branch does not pay a bridge round-trip to find out. The sheet is the real UIActivityViewController.",
          },
          android: {
            verdict: "works",
            note: "Always supported, the real Android chooser. dialogTitle is honoured here and ignored on iOS.",
          },
        }}
        wrong="A dismissed sheet surfaces as an error (it is a normal user choice, and an app that treats it as a failure will show a toast every time someone changes their mind). Or the support badge says supported and pressing the button does nothing — that means the call lost its user-activation, usually to an await before it."
      />

      <LabSection title="Support">
        <LabSupport
          supported={supported}
          supportedLabel="Share sheet available"
          unsupportedLabel="No share sheet on this target"
          detail="Desktop Chrome and every Firefox have no navigator.share. Native is always true — no bridge round-trip is paid to learn it."
        />
      </LabSection>

      <LabSection
        title="Per-payload gate"
        description="canShare() answers a different question from supported. A browser with a sheet still refuses payloads it cannot handle — a file share is the usual one."
      >
        {payloads.map(({ label, target }) => (
          <LabRow
            key={label}
            label={label}
            value={
              <LabBadge tone={canShare(target) ? "ok" : "bad"}>
                {canShare(target) ? "shareable" : "refused"}
              </LabBadge>
            }
          />
        ))}
        {files.length === 0 && (
          <p className="text-xs text-muted">
            This runtime has no `File` constructor, so the file payload is
            empty rather than absent.
          </p>
        )}
      </LabSection>

      <LabSection
        title="Open the sheet"
        description="Must be called from a real user gesture; an awaited call loses the activation and the accessor rethrows rather than hiding it."
      >
        <LabActions>
          {payloads.map(({ label, target }) => (
            <LabButton
              key={label}
              disabled={sharing}
              onClick={() => void share(target)}
            >
              Share {label}
            </LabButton>
          ))}
        </LabActions>
        <LabRow
          label="last outcome"
          value={<LabOutcome outcome={outcome} okValues={["shared"]} />}
          hint="`dismissed` and `unsupported` are ordinary values — the accessor never rejects for either."
        />
        <LabRow label="sharing" value={String(sharing)} />
        <LabRow label="error" value={error?.message ?? null} />
      </LabSection>
    </LabPage>
  )
}

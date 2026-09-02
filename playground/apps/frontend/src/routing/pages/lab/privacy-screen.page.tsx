import type {
  PrivacyScreenOutcome,
  PrivacyScreenSupport,
} from "@arrzdev/adaptv/capabilities"
import { usePrivacyScreen } from "@arrzdev/adaptv/hooks"
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

export const Route = createFileRoute("/_providers/lab/privacy-screen")({
  component: LabPrivacyScreenPage,
})

function SupportBadge({
  support,
}: {
  support: PrivacyScreenSupport | null
}) {
  return (
    <LabBadge tone={support === "available" ? "ok" : "muted"}>
      <span data-testid="privacy-support">{support ?? "probing"}</span>
    </LabBadge>
  )
}

function EnabledBadge({ enabled }: { enabled: boolean | null }) {
  return (
    <LabBadge tone={enabled === null ? "muted" : enabled ? "ok" : "warn"}>
      <span data-testid="privacy-enabled">
        {enabled === null ? "—" : enabled ? "on" : "off"}
      </span>
    </LabBadge>
  )
}

function OutcomeBadge({
  outcome,
}: {
  outcome: PrivacyScreenOutcome | null
}) {
  const tone =
    outcome === null ? "muted" : outcome === "applied" ? "ok" : "warn"
  return (
    <LabBadge tone={tone}>
      <span data-testid="privacy-last">{outcome ?? "—"}</span>
    </LabBadge>
  )
}

function LabPrivacyScreenPage() {
  const { support, enabled, caveat, enable, disable, last } =
    usePrivacyScreen()
  const [log, setLog] = useState<LabLogEntry[]>([])
  const append = (text: string) =>
    setLog((entries) => [...entries, labLogEntry(text)])

  async function run(
    label: string,
    action: () => Promise<PrivacyScreenOutcome>,
  ) {
    append(label)
    const outcome = await action()
    append(`${label}: ${outcome}`)
  }

  return (
    <LabPage
      title="Privacy screen"
      subtitle="The app's content kept out of the switcher, and out of screenshots where the OS lets an app refuse them."
    >
      <LabBrief
        what="Whether this target can hide the app's content from the app switcher and from captures, what enabling it actually guarantees here, and that the OS's own state is what the row reads."
        steps={[
          "Read the support badge and the caveat. On the web both say plainly that nothing here can refuse a capture.",
          "Press “Enable (splash)”. The state row must read on — the OS's answer, not the button's.",
          "Leave the app (HOME or the switcher). The switcher card must show the launch screen, not the page.",
          "On Android, take a screenshot while the app is in front. It must come back black.",
          "Press “Disable”. The state row must read off, the switcher must show the page again, and a screenshot must show it too.",
          "Press “Enable (obscure)”: the switcher card is blurred (iOS) or dimmed (Android) instead of the launch screen.",
        ]}
        expected={{
          web: {
            verdict: "unsupported",
            note: "No browser exposes a way to keep a page out of a screenshot or a recording. Support reads unsupported, the state reads —, and every button yields unsupported.",
          },
          pwa: {
            verdict: "unsupported",
            note: "Same as the tab it was installed from: the installed shell adds no capture control.",
          },
          ios: {
            verdict: "partial",
            note: "The switcher card is covered the moment the app resigns active. iOS has no API to block a screenshot of the foreground app, and the caveat says so.",
          },
          android: {
            verdict: "works",
            note: "FLAG_SECURE: a screenshot or a recording of the app comes back black, and the recents card is blank.",
          },
        }}
        wrong="Support says available on a browser. Or the state row reads on after a call that resolved failed — the row must be the OS's answer, re-read, not the button's intent. Or an Android screenshot with the screen enabled shows the page: the flag was never set on the window that is actually in front."
      />

      <LabSection
        title="Support"
        description="Read off the binary's plugin header on native; the web has nothing to read."
      >
        <LabRow
          label="support"
          value={<SupportBadge support={support} />}
        />
        <LabRow label="state" value={<EnabledBadge enabled={enabled} />} />
        <LabRow
          label="caveat"
          value={<span data-testid="privacy-caveat">{caveat || "—"}</span>}
        />
      </LabSection>

      <LabSection
        title="Switch it"
        description="Each call resolves an outcome word; the state row is re-read from the OS whenever the outcome was not applied."
      >
        <LabActions>
          <LabButton
            data-testid="privacy-enable"
            onClick={() => void run("enable splash", () => enable())}
          >
            Enable (splash)
          </LabButton>
          <LabButton
            data-testid="privacy-enable-obscure"
            onClick={() =>
              void run("enable obscure", () =>
                enable({ cover: "obscure" }),
              )
            }
          >
            Enable (obscure)
          </LabButton>
          <LabButton
            data-testid="privacy-disable"
            onClick={() => void run("disable", () => disable())}
          >
            Disable
          </LabButton>
        </LabActions>
        <LabRow
          label="last outcome"
          value={<OutcomeBadge outcome={last} />}
          hint="`unsupported` and `failed` are ordinary outcomes — nothing here rejects."
        />
      </LabSection>

      <LabSection title="Log">
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}

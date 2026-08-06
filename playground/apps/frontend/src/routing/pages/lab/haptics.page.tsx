import type {
  ImpactWeight,
  NotifyType,
} from "@arrzdev/adaptv/capabilities"
import { useHaptics } from "@arrzdev/adaptv/hooks"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { useEffect, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabButton,
  LabCaveat,
  LabSection,
  LabSupport,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/haptics")({
  component: LabHapticsPage,
})

const WEIGHTS: ImpactWeight[] = ["light", "medium", "heavy"]
const NOTIFY: NotifyType[] = ["success", "warning", "error"]

function LabHapticsPage() {
  const haptic = useHaptics()
  const [supported, setSupported] = useState(false)
  useEffect(() => setSupported(haptic.isSupported()), [haptic])

  return (
    <LabPage
      title="Haptics"
      subtitle="Imperative, fire-and-forget feedback for things not tied to a tap — a finished upload, a countdown."
    >
      <LabBrief
        what="Imperative feedback that is not tied to a tap — a finished upload, a countdown — and an honest answer about where there is no engine to fire at all."
        steps={[
          "Read the support badge. On iOS BEFORE 26.5 it reads supported and the buttons fire the system tick through a hidden native switch. On iOS 26.5+ it still reads supported but produces nothing — Apple patched the programmatic trick and there is no runtime way to detect it. Native and Android are unaffected.",
          "Press light, medium and heavy in turn on a real device. They must feel different from each other where the platform has a real engine.",
          "Press success, warning and error. These are patterns, not intensities — they should be distinguishable as rhythms.",
          "Press selection several times quickly.",
          "Now press any button twice in rapid succession on WEB: the second pulse must be dropped (the web path is throttled to one per 200ms). On native it should not be.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Android Chrome approximates the taxonomy with navigator.vibrate patterns — coarse but present. Desktop has no hardware. iOS Safari before 26.5 fires a single system tick via a hidden native <input switch>; iOS 26.5+ produces nothing (Apple patched programmatic triggering). One flavour of tick either way — never the impact weights.",
          },
          pwa: {
            verdict: "partial",
            note: "Same as the browser it was installed from. On an installed iOS PWA use the haptic-tick transducer for tap feedback instead.",
          },
          ios: {
            verdict: "works",
            note: "The real Taptic Engine through the native plugin. This is the only target where the three impact weights genuinely differ. A simulator has no engine — real hardware only.",
          },
          android: {
            verdict: "works",
            note: "The real OS haptic constants. The weights differ, less dramatically than on iOS.",
          },
        }}
        wrong="Every weight feels identical on native, which means the taxonomy is collapsing to one call and the vocabulary is decorative. Or a pulse on iOS web throws instead of quietly toggling the switch — on 26.5+ it must no-op, not error."
      />

      <LabSection title="Support">
        <LabSupport
          supported={supported}
          supportedLabel="A haptic engine is reachable"
          unsupportedLabel="Nothing to fire here"
          detail="Native uses the real engine; Android/Chrome web approximates the taxonomy with navigator.vibrate patterns."
        />
        <LabCaveat>
          iOS web has no Vibration API, so <code>useHaptics</code> reaches
          the Taptic Engine by toggling a hidden native{" "}
          <code>&lt;input switch&gt;</code>. This works on every iOS{" "}
          <strong>before 26.5</strong>; on 26.5+ Apple patched programmatic
          triggering, so it reports success and produces nothing — an
          accepted limitation with no runtime way to detect it. The only
          mechanism that survives 26.5 is a real finger on the switch (a
          primitive&apos;s <code>haptic</code> prop).
        </LabCaveat>
      </LabSection>

      <LabSection title="impact(weight)">
        <LabActions>
          {WEIGHTS.map((weight) => (
            <LabButton key={weight} onClick={() => haptic.impact(weight)}>
              {weight}
            </LabButton>
          ))}
        </LabActions>
      </LabSection>

      <LabSection title="notify(type)">
        <LabActions>
          {NOTIFY.map((type) => (
            <LabButton key={type} onClick={() => haptic.notify(type)}>
              {type}
            </LabButton>
          ))}
        </LabActions>
      </LabSection>

      <LabSection
        title="selection()"
        description="The light tick for list and segmented-control changes."
      >
        <LabActions>
          <LabButton onClick={() => haptic.selection()}>
            selection
          </LabButton>
        </LabActions>
      </LabSection>

      <LabSection title="Throttling">
        <p className="text-sm text-muted">
          The web path is throttled to one pulse per 200ms — rapid repeats
          feel like noise there, while native handles its own cadence. Tap
          a button twice quickly: on web the second pulse is dropped.
        </p>
      </LabSection>
    </LabPage>
  )
}

import type {
  ImpactWeight,
  NotifyType,
} from "@arrzdev/adaptv/capabilities"
import { haptics } from "@arrzdev/adaptv/capabilities"
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

export const Route = createFileRoute({
  component: LabHapticsPage,
})

const WEIGHTS: ImpactWeight[] = ["light", "medium", "heavy"]
const NOTIFY: NotifyType[] = ["success", "warning", "error"]

function LabHapticsPage() {
  const [supported, setSupported] = useState(false)
  useEffect(() => setSupported(haptics.isSupported()), [])

  return (
    <LabPage
      title="Haptics"
      subtitle="Imperative, fire-and-forget feedback for things not tied to a tap — a finished upload, a countdown."
    >
      <LabBrief
        what="Imperative feedback that is not tied to a tap — a finished upload, a countdown — and an honest answer about where there is no engine to fire at all."
        steps={[
          "Read the support badge. On iOS Safari it must read unsupported, and that is correct and permanent.",
          "Press light, medium and heavy in turn on a real device. They must feel different from each other where the platform has a real engine.",
          "Press success, warning and error. These are patterns, not intensities — they should be distinguishable as rhythms.",
          "Press selection several times quickly.",
          "Now press any button twice in rapid succession on WEB: the second pulse must be dropped (the web path is throttled to one per 200ms). On native it should not be.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Android Chrome approximates the taxonomy with navigator.vibrate patterns — coarse but present. Desktop has no hardware. iOS Safari has nothing and never will: WebKit's standards position on the Vibration API is formally oppose.",
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
        wrong="The support badge says supported on iOS Safari — it cannot be, and something is lying about a capability. Or every weight feels identical on native, which means the taxonomy is collapsing to one call and the vocabulary is decorative."
      />

      <LabSection title="Support">
        <LabSupport
          supported={supported}
          supportedLabel="A haptic engine is reachable"
          unsupportedLabel="Nothing to fire here"
          detail="Native uses the real engine; Android/Chrome web approximates the taxonomy with navigator.vibrate patterns."
        />
        {!supported && (
          <LabCaveat>
            If this reads unsupported on iOS Safari, that is correct and
            not fixable: WebKit&apos;s standards position on the Vibration
            API is formally <em>oppose</em>. Tap-triggered feedback has to
            go through the declarative haptic-tick transducer instead.
          </LabCaveat>
        )}
      </LabSection>

      <LabSection title="impact(weight)">
        <LabActions>
          {WEIGHTS.map((weight) => (
            <LabButton key={weight} onClick={() => haptics.impact(weight)}>
              {weight}
            </LabButton>
          ))}
        </LabActions>
      </LabSection>

      <LabSection title="notify(type)">
        <LabActions>
          {NOTIFY.map((type) => (
            <LabButton key={type} onClick={() => haptics.notify(type)}>
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
          <LabButton onClick={() => haptics.selection()}>
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

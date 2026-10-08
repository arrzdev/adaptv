import {
  attachHapticTick,
  HAPTIC_TICK_ATTR,
  supportsHapticTick,
} from "adaptv/capabilities"
import { Button } from "adaptv/components"
import { useHapticTick } from "adaptv/hooks"
import { createFileRoute } from "adaptv/router"
import { useEffect, useRef, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabCaveat,
  LabRow,
  LabSection,
  LabSupport,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/haptic-tick")({
  component: LabHapticTickPage,
})

function LabHapticTickPage() {
  const [supported, setSupported] = useState(false)
  const [overlayPresent, setOverlayPresent] = useState(false)
  const [hookEnabled, setHookEnabled] = useState(true)
  const hostRef = useRef<HTMLButtonElement>(null)
  //the hook form: a ref callback, so the overlay exists at commit — before the
  //first frame a finger could land on. Toggling `enabled` detaches it.
  const attachHook = useHapticTick(hookEnabled)

  useEffect(() => {
    setSupported(supportsHapticTick())
    const host = hostRef.current
    if (!host) return
    const detach = attachHapticTick(host)
    setOverlayPresent(!!host.querySelector(`[${HAPTIC_TICK_ATTR}]`))
    return () => {
      detach()
      setOverlayPresent(false)
    }
  }, [])

  return (
    <LabPage
      title="Haptic tick"
      subtitle="The declarative haptic. On iOS web this is the only route to the Taptic Engine that exists — and it needs a real finger, so a simulator will show the wiring but never the feel."
    >
      <LabBrief
        what="The one route to the Taptic Engine WebKit allows: an invisible switch input whose real toggle the OS answers with a tick. There is no API to call — it needs a genuine finger."
        steps={[
          "Read the support row. It tells you whether this transducer is the mechanism on this target, or whether the ordinary haptics path is.",
          "Tap the demo control with a REAL FINGER on a real device. A simulator and a mouse will both show the wiring and produce no feel.",
          "Tap it several times in a row and judge the timing: the tick must land on contact, not on release.",
          "Toggle useHapticTick(enabled) off and tap again — no tick.",
          "Check the attribute row: the element must carry the tick attribute while enabled and lose it when disabled.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "On iOS Safari this is the ONLY haptic that exists — navigator.vibrate is formally opposed by WebKit and will never ship. On desktop and on Android Chrome the transducer is unnecessary and the row should say so.",
          },
          pwa: {
            verdict: "works",
            note: "An installed iOS PWA is the headline case: no native bridge, no Vibration API, and this transducer is the whole story.",
          },
          ios: {
            verdict: "absent",
            note: "Native has a real haptics engine, so the transducer is not the mechanism here — the support row saying it is not needed is the correct answer.",
          },
          android: {
            verdict: "absent",
            note: "Same: the native engine is available, so this is not the path. Nothing to feel from this page specifically.",
          },
        }}
        wrong="Nothing is felt on a real iPhone in Safari with the transducer reported as active — that is the one target where this is the only option, so a silent tap means tap feedback is simply gone. Also wrong: the tick firing on release instead of contact, which feels like lag rather than touch."
      />

      <LabSection title="Is this the right mechanism here?">
        <LabSupport
          supported={supported}
          supportedLabel="Transducer in use (iOS web)"
          unsupportedLabel="Not used here — a real engine exists"
          detail="Deliberately narrow: off on native (@capacitor/haptics has the full taxonomy), off wherever navigator.vibrate exists (patterns, no DOM cost), off anywhere that isn't iOS."
        />
        <LabRow
          label="overlay node attached"
          value={String(overlayPresent)}
          hint="One extra DOM node per tap target, absent everywhere the trick isn't needed."
        />
      </LabSection>

      <LabSection
        title="Tap it with a finger"
        description="The overlay is a child of the host, so the tap bubbles and the host's own onClick still runs."
      >
        <button
          ref={hostRef}
          type="button"
          className="clickable relative rounded-md bg-secondary px-4 py-3 text-sm font-medium text-foreground"
        >
          Manually attached target
        </button>
        <LabCaveat>
          Apple patched programmatic <code>.click()</code> in iOS 26.5, so
          a synthetic tap produces nothing. Only a genuine, hit-testable
          touch fires the tick — and only with System Haptics enabled,
          which is not detectable from JS. Simulators never produce haptics
          at all.
        </LabCaveat>
      </LabSection>

      <LabSection
        title="useHapticTick(enabled)"
        description="The React form — a ref callback rather than an effect, because it runs during commit and a useEffect would leave the first frame of a freshly-mounted button silent."
      >
        <button
          ref={attachHook}
          type="button"
          className="clickable relative rounded-md bg-secondary px-4 py-3 text-sm font-medium text-foreground"
        >
          Hook-attached target
        </button>
        <LabActions>
          <LabButton onClick={() => setHookEnabled((on) => !on)}>
            {hookEnabled ? "enabled → detach" : "detached → enable"}
          </LabButton>
        </LabActions>
        <LabRow
          label="enabled"
          value={
            <LabBadge tone={hookEnabled ? "ok" : "muted"}>
              {String(hookEnabled)}
            </LabBadge>
          }
          hint="Detaching tears the overlay down first, so the old one is never orphaned on the element."
        />
      </LabSection>

      <LabSection
        title="What every primitive already does"
        description="Button haptic='…' routes through this transparently, so the same prop works on all six targets while haptics.impact() is a no-op on one of them."
      >
        <Button
          haptic="light"
          className="clickable rounded-md bg-secondary px-4 py-3 text-sm font-medium text-foreground"
        >
          <Button.Text>Button haptic=&quot;light&quot;</Button.Text>
        </Button>
      </LabSection>
    </LabPage>
  )
}

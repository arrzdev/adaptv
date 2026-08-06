import { EdgeSwipeGestures } from "@arrzdev/adaptv/components"
import { useMediaQuery } from "@arrzdev/adaptv/hooks"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { isNativePlatform } from "@arrzdev/adaptv/utils"
import { useEffect, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import type { LabLogEntry } from "@/components/lab/lab-kit"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabCaveat,
  LabLog,
  LabRow,
  LabSection,
  labLogEntry,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/edge-swipe")({
  component: LabEdgeSwipePage,
})

function LabEdgeSwipePage() {
  const isStandalone = useMediaQuery("(display-mode: standalone)")
  const [native, setNative] = useState(false)
  //off until asked: the lab shell already mounts its own instance (gated on
  //standalone) that navigates back, and two armed left-edge handlers on one
  //screen is the exact double-navigation this page warns about
  const [enabled, setEnabled] = useState(false)
  const [log, setLog] = useState<LabLogEntry[]>([])

  useEffect(() => setNative(isNativePlatform()), [])

  const note = (text: string) =>
    setLog((entries) => [labLogEntry(text), ...entries].slice(0, 40))

  return (
    <LabPage
      title="EdgeSwipeGestures"
      subtitle="A back gesture for the shells that took the OS one away. In a browser tab the browser already owns the edge; in an installed PWA nobody does, and without this the app is a dead end."
    >
      <LabBrief
        what="That a swipe from the left screen edge fires the left handler and a swipe from the right edge fires the right one — and that it does nothing where the OS already provides the gesture."
        steps={[
          "Press “arm the probe” first — it ships disarmed so it cannot double up with the shell's own back swipe.",
          "Swipe from the very left edge of the screen (the outermost ~20px) toward the middle. The log must record a left swipe.",
          "Do the same from the right edge.",
          "Start a swipe from the MIDDLE of the screen and drag sideways. Nothing must fire — only the edge zone arms it.",
          "Start at the edge and move only a few pixels before releasing. Nothing must fire; the threshold has to be crossed.",
          "Turn it off with the toggle and repeat step 1. Nothing must fire.",
          "Now check it in anger: leave this page with the top-left back arrow, come back, and use the edge swipe to go back. It must return to the testing index, and the log on this page must be gone (it was a real navigation, not a fake one).",
        ]}
        expected={{
          web: {
            verdict: "absent",
            note: "The lab pages mount this with enabled={isStandalone}, so in a browser tab it is off — correctly. The browser's own edge swipe is the back gesture here, and a second one on top of it would double-navigate.",
          },
          pwa: {
            verdict: "works",
            note: "The whole reason it exists. An installed PWA has no browser chrome and no OS back gesture, so this is the only way back. Both edges should fire.",
          },
          ios: {
            verdict: "partial",
            note: "The WKWebView provides its own interactive back-forward swipe, so this is deliberately not the primary path — but display-mode reads `browser` inside a Capacitor WebView, so the lab's enabled={isStandalone} gate turns it OFF here. Nothing firing on native iOS is the expected result on this page.",
          },
          android: {
            verdict: "partial",
            note: "Same gate, same result: off, because the OS gesture-nav back already works. Test the OS gesture instead — it must pop this page rather than exit the app.",
          },
        }}
        wrong="A swipe from the middle of the screen navigates. In an installed PWA the edge swipe does nothing at all, which leaves the user with no way back. Or the gesture fires TWICE — once from this component and once from the platform — which pops two entries and skips a page."
      />

      <LabSection title="Where this is armed">
        <LabRow
          label="(display-mode: standalone)"
          value={
            <LabBadge tone={isStandalone ? "ok" : "muted"}>
              {String(isStandalone)}
            </LabBadge>
          }
          hint="Reads false inside a Capacitor WebView — which is exactly why isInstalledApp() exists and why nothing in adaptv keys off the media query directly."
        />
        <LabRow
          label="isNativePlatform()"
          value={
            <LabBadge tone={native ? "ok" : "muted"}>
              {String(native)}
            </LabBadge>
          }
        />
        <LabRow
          label="this page's probe"
          value={
            <LabBadge tone={enabled ? "ok" : "muted"}>
              {enabled ? "armed" : "off"}
            </LabBadge>
          }
          hint="Ships disarmed. Once armed it listens on EVERY target so the gesture itself can be exercised — but in an installed PWA the shell's own back swipe is live too, so expect a log entry AND a navigation."
        />
        <LabActions>
          <LabButton onClick={() => setEnabled((on) => !on)}>
            {enabled ? "disarm the probe" : "arm the probe"}
          </LabButton>
        </LabActions>
      </LabSection>

      <LabSection
        title="The probe"
        description="It logs instead of navigating, so you can swipe repeatedly without leaving the page. The real one, on every lab page, calls router.navigate."
      >
        <EdgeSwipeGestures
          enabled={enabled}
          left={() => note("left edge swipe")}
          right={() => note("right edge swipe")}
        />
        <LabRow
          label="edgeZone"
          value="20px (default)"
          hint="How far in from the screen edge a swipe may start. Wider is easier to trigger and easier to trigger by accident."
        />
        <LabRow
          label="threshold"
          value="the default travel before it counts"
          hint="A tap at the edge must never navigate; the distance is what separates the two."
        />
        <LabLog entries={log} />
      </LabSection>

      <LabSection title="Two gestures, one edge">
        <LabCaveat>
          The danger is not that this fails — it is that it succeeds
          alongside the platform&apos;s own gesture. If both fire you pop
          two history entries and appear to skip a page. That is why the
          lab shell gates its instance on{" "}
          <code>display-mode: standalone</code> rather than arming it
          everywhere, and why the probe above is deliberately the
          exception.
        </LabCaveat>
      </LabSection>
    </LabPage>
  )
}

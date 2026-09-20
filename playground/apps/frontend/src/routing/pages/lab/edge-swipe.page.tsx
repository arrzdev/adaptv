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
import { useIsInstalledApp } from "@/hooks/use-installed-app"

export const Route = createFileRoute("/_providers/lab/edge-swipe")({
  component: LabEdgeSwipePage,
})

function LabEdgeSwipePage() {
  const isStandalone = useMediaQuery("(display-mode: standalone)")
  const installed = useIsInstalledApp()
  const [native, setNative] = useState(false)
  //off until asked: on every installed target the lab shell already mounts its own
  //instance that navigates back, and two armed left-edge handlers on one screen is
  //the exact double-navigation this page warns about
  const [enabled, setEnabled] = useState(false)
  const [log, setLog] = useState<LabLogEntry[]>([])

  useEffect(() => setNative(isNativePlatform()), [])

  const note = (text: string) =>
    setLog((entries) => [labLogEntry(text), ...entries].slice(0, 40))

  return (
    <LabPage
      title="EdgeSwipeGestures"
      subtitle="A back gesture for the shells that took the OS one away. In a browser tab the browser already owns the edge; in an installed app — PWA or native — nobody does, because the app boots on memory history and there is nothing behind it to swipe back to. Without this it is a dead end."
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
          "Now check it in anger, on an installed target (the shell's own instance is off in a browser tab, by design — the isInstalledApp() row below says whether it is armed here): disarm the probe, then use the edge swipe to go back. It must return to the testing index ONE page, and the log on this page must be gone (it was a real navigation, not a fake one).",
        ]}
        expected={{
          web: {
            verdict: "absent",
            note: "The lab shell mounts this with enabled={isInstalledApp()}, which is false in a tab — so it is off here, correctly. The browser's own edge swipe is the back gesture on this target, and a second one on top of it would double-navigate.",
          },
          pwa: {
            verdict: "works",
            note: "The whole reason it exists. An installed PWA has no browser chrome and no OS back gesture, so this is the only way back. Both edges should fire.",
          },
          ios: {
            verdict: "works",
            note: "Armed here too, and it has to be: Capacitor never sets allowsBackForwardNavigationGestures, so WebKit never builds the swipe recogniser at all (`docs/decisions/register.md` B15) — the edge is a clean field, not a contested one. Without this the header chevron is the only way out. A left-edge swipe must return to the testing index.",
          },
          android: {
            verdict: "partial",
            note: "The right edge fires cleanly. The LEFT edge is contested — under gesture navigation the system claims it for its own back, which cancels the touch before this recogniser decides, so the OS gesture is what you are testing there: it must pop this page (not exit the app) and pop it ONCE. Under 3-button navigation nothing claims the edge and this recogniser is the back swipe.",
          },
        }}
        wrong="A swipe from the middle of the screen navigates. In an installed build the edge swipe does nothing at all, which leaves the user with no way back but the chevron. Or the gesture fires TWICE — once from this component and once from the platform — which pops two entries and skips a page."
      />

      <LabSection title="Where this is armed">
        <LabRow
          label="isInstalledApp()"
          value={
            <LabBadge tone={installed ? "ok" : "muted"}>
              {String(installed)}
            </LabBadge>
          }
          hint="THE GATE. The lab shell and the settings page both arm their edge-swipe-back on this — native OR standalone PWA. The two rows below are why it is this and not the media query."
        />
        <LabRow
          label="(display-mode: standalone)"
          value={
            <LabBadge tone={isStandalone ? "ok" : "muted"}>
              {String(isStandalone)}
            </LabBadge>
          }
          hint="Reads false inside a Capacitor WebView — which is exactly why isInstalledApp() exists and why nothing in adaptv keys off the media query directly. Gating on this row is what left the native builds with no back gesture."
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
          hint="Ships disarmed. Once armed it listens on EVERY target so the gesture itself can be exercised — but on any installed target the shell's own back swipe is live too, so expect a log entry AND a navigation."
        />
        <LabActions>
          <LabButton onClick={() => setEnabled((on) => !on)}>
            {enabled ? "disarm the probe" : "arm the probe"}
          </LabButton>
        </LabActions>
      </LabSection>

      <LabSection
        title="The probe"
        description="It logs instead of navigating, so you can swipe repeatedly without leaving the page. The real one, on every lab page, is a back press (useSwipeBack): an open drawer or menu takes it before the page leaves."
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
          lab shell gates its instance on <code>isInstalledApp()</code>{" "}
          rather than arming it everywhere: a browser tab keeps its own
          edge swipe and gets nothing from us. Installed, nothing else is
          holding that edge — except Android&apos;s gesture navigation,
          which claims the left edge and cancels the touch before this
          recogniser decides. That cancel is what keeps the two from
          stacking, so it is the one worth watching: back should move one
          page, never two. The probe above is deliberately the other
          exception — it arms everywhere, which is why it logs instead of
          navigating.
        </LabCaveat>
      </LabSection>
    </LabPage>
  )
}

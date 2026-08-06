import { useKeepAwake } from "@arrzdev/adaptv/hooks"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabCaveat,
  LabOutcome,
  LabRow,
  LabSection,
  LabSupport,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/keep-awake")({
  component: LabKeepAwakePage,
})

function LabKeepAwakePage() {
  const { supported, active, caveat, request, release, lastOutcome } =
    useKeepAwake()
  const [mountedHold, setMountedHold] = useState(false)

  return (
    <LabPage
      title="Keep awake"
      subtitle="One implementation for all six targets — the Screen Wake Lock API. No native branch, because there is no official Capacitor plugin."
    >
      <LabBrief
        what="Whether the screen can actually be held awake here — including the case where the API reports success and the display dims anyway."
        steps={[
          "Read the support badge first. If it says there is no wake-lock API, nothing else on this page can pass and that is the answer for this target.",
          "Press Request. `active` must go true and the outcome must read `held`.",
          "Set the device's auto-lock to its shortest setting, put the app in the foreground, and leave it alone for longer than that. The screen must stay on.",
          "Background the app and come back. The platform drops the lock on hide; `active` must come back true by itself when you return.",
          "Press Release, then repeat step 3. The screen must now dim on schedule.",
          "Mount the holder, wait, then unmount it. Unmounting must release the lock — a holder that leaks keeps the screen on for the rest of the session.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "navigator.wakeLock is Chrome 84+, Firefox 126+, Safari 16.4+. On an older browser the badge reads unsupported, which is the correct result rather than a failure.",
          },
          pwa: {
            verdict: "works",
            note: "Same API, same result — installing changes nothing here. Worth doing the full auto-lock wait on a real phone; this is one of the few capabilities you cannot verify in under a minute.",
          },
          ios: {
            verdict: "partial",
            note: "There is no official Capacitor plugin, so the native build uses the SAME Screen Wake Lock API through WKWebView. Whether an embedded webview honours it is exactly the open question this page exists to answer — if the badge reads unsupported inside the native build, that IS the finding.",
          },
          android: {
            verdict: "partial",
            note: "Same web API inside the Android WebView, so the same open question. Android also drops the lock under power-save or a low battery, which comes back as `rejected` — temporary, not a capability gap.",
          },
        }}
        wrong="`active` reads true while the screen dims anyway (a lock the platform accepted and ignored — the caveat box is there for exactly this and should be saying so). Or the lock does not come back after backgrounding, which means every long-running screen silently stops working after the first phone call."
      />

      <LabSection title="Support">
        <LabSupport
          supported={supported}
          supportedLabel="navigator.wakeLock present"
          unsupportedLabel="No wake-lock API on this target"
          detail="Chrome 84+, Firefox 126+, Safari 16.4+. Embedded webviews are the open question — if this reads unsupported inside the native build, that is the answer."
        />
        {caveat && <LabCaveat>{caveat}</LabCaveat>}
        {supported && !caveat && (
          <p className="text-xs text-muted">
            No known silent-failure case on this target.
          </p>
        )}
      </LabSection>

      <LabSection
        title="Hold it manually"
        description="Take the lock, then background the app and come back — the platform drops the lock on hide and the accessor re-acquires on the way back."
      >
        <LabActions>
          <LabButton onClick={() => void request()}>Request</LabButton>
          <LabButton tone="danger" onClick={() => void release()}>
            Release
          </LabButton>
        </LabActions>
        <LabRow
          label="active"
          value={
            <LabBadge tone={active ? "ok" : "muted"}>
              {active ? "screen held" : "not held"}
            </LabBadge>
          }
        />
        <LabRow
          label="last outcome"
          value={<LabOutcome outcome={lastOutcome} okValues={["held"]} />}
          hint="`rejected` is temporary — power-save mode, a low battery, or a hidden document. `unsupported` is not."
        />
      </LabSection>

      <LabSection
        title="Hold for a component's lifetime"
        description="The `enabled` option, for a screen that should keep the display on for as long as it is open."
      >
        <LabActions>
          <LabButton onClick={() => setMountedHold((held) => !held)}>
            {mountedHold ? "Unmount the holder" : "Mount a holder"}
          </LabButton>
        </LabActions>
        {mountedHold && <MountedHolder />}
      </LabSection>
    </LabPage>
  )
}

/** A component whose mere existence holds the lock; unmounting releases it. */
function MountedHolder() {
  const { active, lastOutcome } = useKeepAwake({ enabled: true })
  return (
    <>
      <LabRow
        label="holder active"
        value={
          <LabBadge tone={active ? "ok" : "warn"}>
            {String(active)}
          </LabBadge>
        }
      />
      <LabRow
        label="holder outcome"
        value={<LabOutcome outcome={lastOutcome} okValues={["held"]} />}
      />
    </>
  )
}

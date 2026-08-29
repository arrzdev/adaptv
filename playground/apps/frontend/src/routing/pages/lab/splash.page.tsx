import { hideNativeSplash } from "@arrzdev/adaptv/capabilities"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { isInstalledApp, isNativePlatform } from "@arrzdev/adaptv/utils"
import { useEffect, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabButton,
  LabRow,
  LabSection,
  LabSupport,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/splash")({
  component: LabSplashPage,
})

function LabSplashPage() {
  const [native, setNative] = useState(false)
  const [installed, setInstalled] = useState(false)
  const [called, setCalled] = useState(false)

  useEffect(() => {
    setNative(isNativePlatform())
    setInstalled(isInstalledApp())
  }, [])

  return (
    <LabPage
      title="Splash"
      subtitle="The launch handoff. The OS splash covers launch → first JS frame; adaptv hides it once the app has painted so it hands off to the custom React splash with no gap and no double-splash."
    >
      <LabBrief
        what="The handoff from the OS launch image to the app's own splash — the one moment where a gap or a double-splash is impossible to hide."
        steps={[
          "Fully quit the app (not just background it) and relaunch.",
          "Watch the launch closely: the OS splash must give way to the app's own splash with no white flash and no visible seam between them.",
          "Confirm you do not see TWO splashes in sequence with a jump between them — same background colour, same position.",
          "Time the app's own splash: it must stay up for its full minimum (1s here) AFTER the OS splash lifts, and its wordmark animation must start there rather than arrive part-way through. It is mounted behind the OS splash, so a clock started at mount would already have run down.",
          "Once the app paints, confirm the splash is gone and the app is interactive immediately.",
          "Press hideNativeSplash() on this page. Nothing must happen and nothing must break — it is callable on every target without a platform branch, which is the point.",
        ]}
        expected={{
          web: {
            verdict: "absent",
            note: "No native splash exists, so hideNativeSplash() is a no-op. A browser tab shows nothing at launch; the app's own overlay is opt-in here.",
          },
          pwa: {
            verdict: "partial",
            note: "On Android an OS-generated splash is drawn from the manifest — colours and icon only, nothing the app can control past that. On iOS the standalone launch image plays the same role.",
          },
          ios: {
            verdict: "works",
            note: "Two splashes in sequence, and the seam between them is the thing to judge. The native one is hidden once the app has painted.",
          },
          android: {
            verdict: "works",
            note: "Same handoff. Also check the status-bar colour across it — a bar that changes colour mid-handoff reads as a flash.",
          },
        }}
        wrong="A white frame between the two splashes, or the native splash hanging around after the app has painted. Both make a fast app feel slow, and the second one also swallows the user's first tap. The third failure is a splash that appears for a blink: its minimum was counted from mount and spent under the OS splash — adaptv hands it `revealedAt` so it counts from the handoff instead."
      />

      <LabSection title="What this target shows at launch">
        <LabSupport
          supported={native}
          supportedLabel="Native OS splash — hidden by this bridge"
          unsupportedLabel="No native splash to hide"
          detail="A browser tab gets nothing; an Android PWA gets the OS-generated splash from the manifest, which the app cannot control past its colours and icon."
        />
        <LabRow
          label="custom overlay policy"
          value={
            installed ? "shown (installed app)" : "opt-in (browser tab)"
          }
          hint="Driven by the pre-paint data-adaptv-platform stamp and attribute-scoped critical CSS, not by JS."
        />
      </LabSection>

      <LabSection
        title="hideNativeSplash()"
        description="Safe to call anytime; a no-op off native. Calling it here after launch does nothing visible — the point is that it is callable on every target without a platform branch at the call site."
      >
        <LabActions>
          <LabButton
            onClick={() => {
              void hideNativeSplash()
              setCalled(true)
            }}
          >
            hideNativeSplash()
          </LabButton>
        </LabActions>
        <LabRow
          label="called"
          value={called ? "yes — returned without throwing" : null}
        />
      </LabSection>
    </LabPage>
  )
}

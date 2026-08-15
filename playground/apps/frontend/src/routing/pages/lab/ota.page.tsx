import { useStoreRelease } from "@arrzdev/adaptv/hooks"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { LabBrief } from "@/components/lab/lab-brief"
import { LabBadge, LabRow, LabSection } from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/ota")({
  component: LabOtaPage,
})

const DAY = 86_400_000

/**
 * What an install knows about the gap between its JavaScript and its binary.
 *
 * The page exists because that gap is invisible by construction: an app taking
 * over-the-air updates runs newer and newer JS on a binary that only moves
 * through the store, and nothing about the running app looks different until
 * something reaches for native code that is not there.
 */
function LabOtaPage() {
  const behind = useStoreRelease()

  return (
    <LabPage
      title="OTA & the store gap"
      subtitle="Whether this install's JavaScript has moved ahead of the binary it is running on."
    >
      <LabBrief
        what="The question an app taking over-the-air updates has to be able to ask: has the channel moved past this binary? Under the default policy those bundles still install, so nothing about the running app looks different — this is the only place the gap is visible."
        steps={[
          "On an install that has never fallen behind, the top section reads up to date, on every target.",
          "Run the OTA lab's `skew` step: it publishes a bundle built against a native layer this app does not have. The bundle installs anyway — that is the default, because withholding it would withhold every other fix in that release too.",
          "Relaunch until the new bundle is the running one (it downloads on one launch and boots on the next), then confirm this section reads behind, with today's date.",
          "Cold-start twice more and confirm it stays behind. Only a store release ends it.",
          "Check the plugin list at the bottom against the app's native project. It comes from the binary, not from anything this bundle carries — which is why it does not move when a bundle does.",
        ]}
        expected={{
          web: {
            verdict: "absent",
            note: "No native layer and no OTA — the service worker is the update mechanism. The install is never behind and there are no plugin headers to report.",
          },
          pwa: {
            verdict: "absent",
            note: "Identical to the browser. An installed PWA updates through its service worker, not through this channel.",
          },
          ios: {
            verdict: "works",
            note: "Capacitor.PluginHeaders is injected by the native layer, so the plugin list describes the binary rather than anything the bundle carries.",
          },
          android: {
            verdict: "works",
            note: "Same mechanism, same answers.",
          },
        }}
        wrong="The install reads up to date straight after a skewed bundle landed. That means the comparison ran against the running bundle's fingerprint rather than the binary's — and once it does, it reports up to date for ever."
      />

      <LabSection title="This install versus the channel">
        <LabRow
          label="useStoreRelease()"
          value={
            <LabBadge tone={behind ? "warn" : "ok"}>
              {behind ? "behind" : "up to date"}
            </LabBadge>
          }
          hint="Behind means the channel is publishing builds made for a native layer this app does not have. The app still works; only a store update closes the gap."
        />
        <LabRow
          label="since"
          value={
            behind
              ? `${Math.floor((Date.now() - behind.since) / DAY)}d — ${new Date(behind.since).toISOString().slice(0, 10)}`
              : "—"
          }
          hint="Persisted, and NOT restarted by the next incompatible deploy: the install fell behind once, and the age is what a blocking screen would be built on."
        />
        <LabRow
          label="buildTag"
          value={behind?.buildTag ?? "—"}
          hint="The published build that moved past this binary."
        />
      </LabSection>

      <LabSection title="What the binary reports">
        <LabRow
          label="Capacitor.PluginHeaders"
          value={`${pluginNames().length} plugins`}
          hint="Injected by the native layer at startup, with the methods each one implements. This is the only thing on the device that describes the BINARY rather than the bundle."
        />
        <LabRow
          label="names"
          value={
            <span className="text-end break-words">
              {pluginNames().join(", ") || "—"}
            </span>
          }
        />
      </LabSection>
    </LabPage>
  )
}

function pluginNames(): string[] {
  const headers = (
    globalThis as {
      Capacitor?: { PluginHeaders?: Array<{ name: string }> }
    }
  ).Capacitor?.PluginHeaders
  return Array.isArray(headers) ? headers.map((h) => h.name) : []
}

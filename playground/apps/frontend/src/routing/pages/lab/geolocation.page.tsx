import { useGeolocation } from "@arrzdev/adaptv/hooks"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { useEffect } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabRow,
  LabSection,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/geolocation")({
  component: LabGeolocationPage,
})

const PERMISSION_TONE = {
  granted: "ok",
  prompt: "warn",
  denied: "bad",
  unavailable: "bad",
} as const

function LabGeolocationPage() {
  const { coords, permission, error, loading, locate, refreshPermission } =
    useGeolocation()

  useEffect(() => {
    void refreshPermission()
  }, [refreshPermission])

  return (
    <LabPage
      title="Geolocation"
      subtitle="The exemplar every other permission-gated capability copies: one four-state enum instead of a permission plus a separate availability probe."
    >
      <LabBrief
        what="The four-state permission model every other gated capability copies — and that a denied or unavailable state is reported rather than hidden behind an empty result."
        steps={[
          "Read the permission badge before pressing anything. `prompt` means the OS will ask; `denied` means it will not; `unavailable` means asking is pointless.",
          "Press the read button. If the state was `prompt`, the OS dialog must appear.",
          "Allow it. A latitude, longitude and accuracy must appear, and the badge must go `granted`.",
          "Now deny it in the OS settings, come back, and re-read the permission. The badge must go `denied` and the read must fail with a message rather than hanging.",
          "Turn location services off entirely at the OS level and re-read: the state must become `unavailable`, which is a different claim from denied.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Full four-state behaviour. HTTPS or localhost only — on a plain-http LAN URL the API is absent entirely and the state must read `unavailable`.",
          },
          pwa: {
            verdict: "works",
            note: "Same as the browser it was installed from, and the grant is remembered per origin.",
          },
          ios: {
            verdict: "works",
            note: "The native plugin and the real iOS permission sheet. Denying here means going to Settings to undo it — the OS will not ask twice.",
          },
          android: {
            verdict: "works",
            note: "The native runtime permission dialog. “Deny” twice becomes a permanent denial, and the state must reflect that rather than re-prompting forever.",
          },
        }}
        wrong="A denied permission returns an empty position instead of an error, so the app silently shows the wrong place. Or `unavailable` and `denied` are conflated, which makes the app offer a “grant access” button that can never work."
      />

      <LabSection title="Permission">
        <LabRow
          label="state"
          value={
            <LabBadge tone={PERMISSION_TONE[permission]}>
              {permission}
            </LabBadge>
          }
        />
        <p className="text-xs text-muted">
          <strong>denied</strong> sends the user to <em>app</em> settings.{" "}
          <strong>unavailable</strong> means prompting is pointless —
          system location services are off, or this platform has no
          geolocation at all. The two need different UI, which is why they
          are not one state.
        </p>
        <LabActions>
          <LabButton onClick={() => void refreshPermission()}>
            Check (no prompt)
          </LabButton>
        </LabActions>
      </LabSection>

      <LabSection
        title="Read a position"
        description="Requests permission if needed, then reads once. Call it from a user gesture — the browser prompt needs the activation."
      >
        <LabActions>
          <LabButton disabled={loading} onClick={() => void locate()}>
            Locate
          </LabButton>
          <LabButton
            disabled={loading}
            onClick={() => void locate({ highAccuracy: true })}
          >
            Locate (high accuracy)
          </LabButton>
          <LabButton
            disabled={loading}
            onClick={() => void locate({ timeoutMs: 1 })}
          >
            Locate (1ms timeout)
          </LabButton>
        </LabActions>
        <LabRow label="loading" value={String(loading)} />
        <LabRow
          label="latitude"
          value={coords ? coords.latitude.toFixed(5) : null}
        />
        <LabRow
          label="longitude"
          value={coords ? coords.longitude.toFixed(5) : null}
        />
        <LabRow
          label="accuracy"
          value={coords ? `${Math.round(coords.accuracy)} m` : null}
        />
        <LabRow label="error" value={error?.message ?? null} />
      </LabSection>
    </LabPage>
  )
}

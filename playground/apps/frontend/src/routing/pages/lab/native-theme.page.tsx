import {
  NATIVE_THEME_PREF_KEY,
  persistNativeThemePreference,
} from "adaptv/capabilities"
import type { UiThemePreference } from "adaptv/hooks"
import { useTheme } from "adaptv/hooks"
import { createFileRoute } from "adaptv/router"
import { isNativePlatform } from "adaptv/utils"
import { useEffect, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabRow,
  LabSection,
  LabSupport,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/native-theme")({
  component: LabNativeThemePage,
})

const PREFERENCES: UiThemePreference[] = ["light", "dark", "system"]

function LabNativeThemePage() {
  const theme = useTheme()
  const [native, setNative] = useState(false)
  const [lastWrite, setLastWrite] = useState<string | null>(null)

  useEffect(() => {
    setNative(isNativePlatform())
  }, [])

  async function persist(preference: UiThemePreference) {
    await persistNativeThemePreference(preference)
    setLastWrite(`${preference} → ${NATIVE_THEME_PREF_KEY}`)
  }

  return (
    <LabPage
      title="Native theme"
      subtitle="Mirrors the theme preference into native storage so the OS splash — drawn before any JS exists — can follow the app's theme instead of the system setting."
    >
      <LabBrief
        what="That the theme preference is mirrored into native storage, so the OS splash — drawn before any JavaScript exists — can match the app instead of the system setting."
        steps={[
          "Read the support row: on web this is a documented no-op and nothing below will change anything.",
          "Set the preference to dark and confirm the last-write row updates.",
          "On native, FULLY QUIT the app and relaunch it. The OS splash must be dark.",
          "Set it to light, quit, and relaunch. The OS splash must be light.",
          "Set it to system, change the device's own appearance, quit and relaunch: the splash must follow the device.",
        ]}
        expected={{
          web: {
            verdict: "absent",
            note: "Nothing to do, and the page says so. The browser's splash comes from the manifest and the critical CSS; there is no native preference for this to write.",
          },
          pwa: {
            verdict: "absent",
            note: "Same no-op. An Android PWA's OS-generated splash comes from the manifest's colours and cannot be changed at runtime at all.",
          },
          ios: {
            verdict: "works",
            note: "The write lands in native storage and the launch storyboard reads it. Requires a full quit — a warm resume shows no splash to judge.",
          },
          android: {
            verdict: "works",
            note: "Same, through the native splash theme. Also requires a cold start.",
          },
        }}
        wrong="The app is in dark mode and the launch splash flashes white every single cold start. That flash is the entire reason this capability exists, so seeing it means the write never landed or is being read too late."
      />

      <LabSection title="Where this does anything">
        <LabSupport
          supported={native}
          supportedLabel="Native — the write lands"
          unsupportedLabel="Web/PWA — a documented no-op"
          detail="On web the OS/browser splash comes from the manifest and critical CSS; there is nothing for a native preference to change."
        />
        <LabRow label="storage key" value={NATIVE_THEME_PREF_KEY} />
      </LabSection>

      <LabSection title="Current theme">
        <LabRow
          label="resolved appearance"
          value={<LabBadge tone="muted">{theme.resolved}</LabBadge>}
        />
        <LabRow
          label="preference"
          value={<LabBadge tone="muted">{theme.preference}</LabBadge>}
        />
        <LabActions>
          <LabButton
            onClick={() =>
              theme.setPreference(
                theme.resolved === "dark" ? "light" : "dark",
              )
            }
          >
            Toggle theme
          </LabButton>
        </LabActions>
      </LabSection>

      <LabSection
        title="Write the preference"
        description="Fire-and-forget. On native the value is read by MainActivity / AppDelegate on the NEXT launch, so the effect is only visible after a cold start."
      >
        <LabActions>
          {PREFERENCES.map((preference) => (
            <LabButton
              key={preference}
              onClick={() => void persist(preference)}
            >
              persist &quot;{preference}&quot;
            </LabButton>
          ))}
        </LabActions>
        <LabRow label="last write" value={lastWrite} />
      </LabSection>
    </LabPage>
  )
}

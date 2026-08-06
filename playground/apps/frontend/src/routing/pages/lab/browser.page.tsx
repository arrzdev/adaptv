import { isExternalUrl, openExternal } from "@arrzdev/adaptv/capabilities"
import { ExternalLink } from "@arrzdev/adaptv/components"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { isNativePlatform } from "@arrzdev/adaptv/utils"
import { useEffect, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabRow,
  LabSection,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/browser")({
  component: LabBrowserPage,
})

//the classification is the load-bearing bit: an internal path must go through
//the router, and an external one must leave the app entirely
const CANDIDATES = [
  "https://example.com",
  "//example.com",
  "mailto:hello@example.com",
  "tel:+351000000000",
  "/settings",
  "settings",
]

function LabBrowserPage() {
  const [native, setNative] = useState(false)
  useEffect(() => setNative(isNativePlatform()), [])

  return (
    <LabPage
      title="Browser"
      subtitle="External navigation. Native opens the in-app system browser (SFSafariViewController / Custom Tabs); web opens a new tab."
    >
      <LabBrief
        what="That a URL classified as external actually leaves the app the way each platform expects, and that a relative path is never mistaken for one."
        steps={[
          "Read the classification rows. `/settings` and `settings` must be internal; everything with a scheme, and the protocol-relative `//example.com`, must be external.",
          "Check the target row — it says what pressing the buttons below will do on THIS target.",
          "Press https://example.com. On native it must open the in-app system browser; on web, a new tab.",
          "Press back / dismiss it. You must land back in this app with the page exactly as you left it.",
          "Press mailto:. The mail app (or the browser's handler) must take over.",
          "On native, confirm the WebView itself never navigates — if this page is replaced by example.com there is no way back into the app.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Opens a new tab. A popup blocker can eat it if the click lost its user activation, which is worth knowing about but is the browser's rule, not adaptv's.",
          },
          pwa: {
            verdict: "partial",
            note: "Hands the URL to the default browser, so you leave the installed window entirely. That is the platform; it is precisely why native does not do this.",
          },
          ios: {
            verdict: "works",
            note: "SFSafariViewController inside the app — dismissible, with the app still running behind it.",
          },
          android: {
            verdict: "works",
            note: "A Chrome Custom Tab. Back from the tab must return here rather than exiting the app.",
          },
        }}
        wrong="A relative path is classified external and gets opened in a browser instead of routed. Or, on native, the URL replaces the WebView — the app is then gone with no way back, which is the worst outcome on this page."
      />

      <LabSection
        title="isExternalUrl()"
        description="A URI scheme or a protocol-relative //host is external. A relative path is not — route it through Link instead."
      >
        {CANDIDATES.map((href) => (
          <LabRow
            key={href}
            label={href}
            value={
              <LabBadge tone={isExternalUrl(href) ? "warn" : "ok"}>
                {isExternalUrl(href) ? "external" : "internal"}
              </LabBadge>
            }
          />
        ))}
      </LabSection>

      <LabSection title="openExternal()">
        <LabRow
          label="target"
          value={
            <LabBadge tone="muted">
              {native ? "in-app system browser" : "new tab"}
            </LabBadge>
          }
          hint="A tab opened from a browser tab can be blocked by a popup blocker; the native branch cannot."
        />
        <LabActions>
          <LabButton
            onClick={() => void openExternal("https://example.com")}
          >
            https://example.com
          </LabButton>
          <LabButton
            onClick={() => void openExternal("mailto:hello@example.com")}
          >
            mailto:
          </LabButton>
        </LabActions>
      </LabSection>

      <LabSection
        title="The <ExternalLink /> component"
        description="The declarative form — it routes through the same accessor, so it behaves identically on all six targets."
      >
        <ExternalLink
          href="https://example.com"
          className="text-sm font-medium text-primary underline"
        >
          Open example.com
        </ExternalLink>
      </LabSection>
    </LabPage>
  )
}

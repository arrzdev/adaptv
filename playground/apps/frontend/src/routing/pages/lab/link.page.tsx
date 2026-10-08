import { isExternalUrl } from "adaptv/capabilities"
import { ExternalLink, Link } from "adaptv/components"
import { createFileRoute } from "adaptv/router"
import { useEffect, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabButton,
  LabCaveat,
  LabRow,
  LabSection,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/link")({
  component: LabLinkPage,
})

const LINK_CLASS =
  "block rounded-md bg-secondary px-3 py-2 text-sm font-medium text-foreground ring-1 ring-inset ring-border-subtle active:scale-[0.98] transition-transform"

const PROBE_URLS = [
  "https://example.com",
  "mailto:hello@example.com",
  "/lab/link",
  "tel:+15550100",
] as const

function LabLinkPage() {
  const [depth, setDepth] = useState<number | null>(null)

  //window.history.length rather than the router's — it is the browser's own
  //count, which is what a duplicate push actually grows
  useEffect(() => setDepth(window.history.length), [])

  return (
    <LabPage
      title="Link & ExternalLink"
      subtitle="Two components with opposite jobs: one never leaves the app, one always does. The interesting behaviour is in between — a link held too long is not a tap, and a back link should pop rather than push."
    >
      <LabBrief
        what="That in-app links navigate on a tap but not on a hold, that smartBack pops history instead of stacking a duplicate entry, and that an external link leaves the app the way each platform expects."
        steps={[
          "Tap “to the testing index”. It must navigate. Press the back affordance and you are here again.",
          "Press and HOLD the same link for over a second, then release on it. It must NOT navigate — a hold is a hold, not a tap.",
          "Note the history length below, then tap “/lab (plain)” and come back, twice. The number grows each time.",
          "Now reset the number, tap “/lab (smartBack)” and come back twice. The history length must NOT grow — smartBack popped instead of pushing.",
          "Tap the external link. On native it must open the in-app system browser (a sheet you can dismiss back into the app), not kick you out to Safari or Chrome.",
          "Long-press the external link. In an installed app or a native build there must be no iOS link-preview sheet; in a plain iOS Safari tab there should be one.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Navigation and smartBack both work. The external link opens a new browser tab; popup blockers can eat it if the click is not treated as a gesture — if nothing happens, that is worth reporting.",
          },
          pwa: {
            verdict: "partial",
            note: "Same, except the external link's destination: an installed PWA hands the URL to the default browser, so you leave the app window entirely. That is the platform, and it is why native uses the in-app browser instead.",
          },
          ios: {
            verdict: "works",
            note: "External opens SFSafariViewController IN the app — dismissible, with your session intact. The long-press callout is suppressed by ui.touchCallout, which defaults to installed-app-only.",
          },
          android: {
            verdict: "works",
            note: "External opens a Custom Tab, same idea. Hardware/gesture back from the tab must return to this page rather than exiting the app.",
          },
        }}
        wrong="A long press navigates anyway (the 300ms hold threshold is gone, and every accidental long-press in the app becomes a navigation). smartBack pushes a duplicate entry, so the back stack fills with the same page. An external link on native replaces the WebView instead of opening a browser — that is the worst one, because there is then no way back into the app."
      />

      <LabSection
        title="In-app navigation"
        description="A real <a href> underneath — SEO, ⌘-click and route preloading all intact. Only a plain left-click is intercepted."
      >
        <Link to="/lab" className={LINK_CLASS}>
          to the testing index
        </Link>
        <Link to="/settings" className={LINK_CLASS}>
          to settings
        </Link>
        <LabRow
          label="hold threshold"
          value="300ms"
          hint="A press held past this is read as a hold, not a tap, and does not navigate. Try it on the links above."
        />
        <Link to="/lab" disabled className={`${LINK_CLASS} opacity-40`}>
          disabled — must not navigate
        </Link>
      </LabSection>

      <LabSection
        title="smartBack"
        description="If going back in history would land on `to`, pop instead of pushing a duplicate. That is what keeps an in-app back affordance sharing one stack with the OS edge gesture instead of looping."
      >
        <LabRow
          label="history.length"
          value={depth}
          hint="Read once at mount. Press refresh after navigating to see it move."
        />
        <LabActions>
          <LabButton onClick={() => setDepth(window.history.length)}>
            refresh the count
          </LabButton>
        </LabActions>
        <Link to="/lab" className={LINK_CLASS}>
          /lab (plain — pushes)
        </Link>
        <Link to="/lab" smartBack className={LINK_CLASS}>
          /lab (smartBack — pops when it can)
        </Link>
        <LabCaveat>
          smartBack falls back to a normal push when it cannot confirm the
          back target — a deep link or a hard reload leaves it nothing to
          consult. Seeing a push after a cold start is correct.
        </LabCaveat>
      </LabSection>

      <LabSection
        title="ExternalLink"
        description="Leaving the app is a different act from navigating inside it, so it is a different component. On native it routes through the in-app system browser rather than replacing the WebView."
      >
        <ExternalLink href="https://example.com" className={LINK_CLASS}>
          https://example.com
        </ExternalLink>
        <ExternalLink
          href="mailto:hello@example.com"
          className={LINK_CLASS}
        >
          mailto: — must hand off to the mail app
        </ExternalLink>
      </LabSection>

      <LabSection
        title="isExternalUrl()"
        description="The predicate both components consult. Anything that is not same-origin http(s) is somebody else's problem."
      >
        {PROBE_URLS.map((url) => (
          <ExternalProbe key={url} url={url} />
        ))}
      </LabSection>
    </LabPage>
  )
}

function ExternalProbe({ url }: { url: string }) {
  const [result, setResult] = useState<string | null>(null)

  //origin-relative, so it can only be answered on the client
  useEffect(() => setResult(String(isExternalUrl(url))), [url])

  return <LabRow label={url} value={result} />
}

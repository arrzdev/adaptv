import { Offline } from "adaptv/components"
import { useIsOffline } from "adaptv/hooks"
import { createFileRoute } from "adaptv/router"
import { useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabCaveat,
  LabRow,
  LabSection,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/offline")({
  component: LabOfflinePage,
})

function LabOfflinePage() {
  const isOffline = useIsOffline()
  const [retries, setRetries] = useState(0)
  const [custom, setCustom] = useState(false)

  return (
    <LabPage
      title="Offline"
      subtitle="The screen a user sees when nothing else can be shown. It is a component and not an offline.html because a static file would have no theme, no safe area, no design system — and could only ever exist on web, since a native build has no service worker to serve it."
    >
      <LabBrief
        what="That the offline screen renders in place with the app's theme and safe-area padding, that its retry button works, and that it never leaks the underlying error onto the screen."
        steps={[
          "Read the live reachability row. Then turn the network off (airplane mode, or DevTools → Network → Offline) and watch it flip without a reload.",
          "Look at the rendered screen below: it must use the app's colours in BOTH themes — toggle dark mode from Settings and come back.",
          "Press its retry button. The counter must increase. adaptv's own call site has no counter and reloads the page instead, which is all it can do when the app never booted.",
          "Switch to the custom copy and confirm the title, description and label all change while the layout does not.",
          "Confirm no URL, token or stack text appears anywhere on the screen — the `error` prop is deliberately accepted and never rendered.",
          "On a native build with the network off, navigate around the app. The screen must appear in place with the route intact, not redirect to an /offline URL.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "The component renders identically. Reachability is coarse: navigator.onLine only knows whether an interface exists, so a captive-portal Wi-Fi reads as online. That is the platform's answer, not adaptv's.",
          },
          pwa: {
            verdict: "partial",
            note: "Same coarse reachability, plus the service worker: an installed app with a warm cache can keep working while offline, so the screen may correctly not appear at all.",
          },
          ios: {
            verdict: "works",
            note: "Real reachability from the OS, so the live row above should be trustworthy here. Toggling airplane mode must flip it within a second or so.",
          },
          android: {
            verdict: "works",
            note: "Real reachability from the OS, and it can also distinguish connection type. Same expectation as iOS.",
          },
        }}
        wrong="The screen renders with light-mode colours inside a dark app, or its text runs under the notch/home indicator. Retry does nothing. Any part of the error object is printed on screen — this is the screen users screenshot into support tickets, and a token in a screenshot is a security bug, not a cosmetic one."
      />

      <LabSection title="Live reachability">
        <LabRow
          label="useIsOffline()"
          value={
            <LabBadge tone={isOffline ? "bad" : "ok"}>
              {String(isOffline)}
            </LabBadge>
          }
          hint="Turn the network off and watch this flip with no reload. On web it is navigator.onLine, which is a coarse signal by construction."
        />
      </LabSection>

      <LabSection
        title="The screen, rendered in place"
        description="Boxed here so you can see it next to the rest of the page. In production it fills its route — in place, keeping the URL and the params so retry can reconstruct the request."
      >
        <LabActions>
          <LabButton onClick={() => setCustom((on) => !on)}>
            {custom ? "default copy" : "custom copy"}
          </LabButton>
        </LabActions>
        <div className="h-72 overflow-hidden rounded-md bg-background ring-1 ring-inset ring-border-subtle">
          {custom ? (
            <Offline
              title="Can't reach ChopChop"
              description="Your tasks are saved on this device. They'll sync when you're back."
              retryLabel="Retry now"
              error={new Error("https://api.example.com?token=SECRET")}
              onRetry={() => setRetries((n) => n + 1)}
            />
          ) : (
            <Offline onRetry={() => setRetries((n) => n + 1)} />
          )}
        </div>
        <LabRow label="onRetry calls" value={retries} />
      </LabSection>

      <LabSection title="What it deliberately does not do">
        <LabCaveat>
          The <code>error</code> prop above is a real one carrying a fake
          token, and none of it must appear on screen. It exists so an app
          can log or conditionally surface the failure — never so the
          default screen can print it.
        </LabCaveat>
        <LabRow
          label="redirect to /offline"
          value="never"
          hint="A redirect destroys the URL and the params, adds a history entry, and discards scroll — so retry could not reconstruct the request even if it wanted to."
        />
        <LabRow
          label="who renders it"
          value="adaptv when the app cannot boot; the consumer when a route's DATA is unavailable"
          hint="That is why every prop is optional: the same component is mounted from two places with very different amounts of context."
        />
      </LabSection>
    </LabPage>
  )
}

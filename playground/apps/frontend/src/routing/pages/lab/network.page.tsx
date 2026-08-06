import { getOnline, subscribeOnline } from "@arrzdev/adaptv/capabilities"
import { useIsOffline } from "@arrzdev/adaptv/hooks"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { isNativePlatform } from "@arrzdev/adaptv/utils"
import { useEffect, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import type { LabLogEntry } from "@/components/lab/lab-kit"
import {
  LabBadge,
  LabLog,
  LabRow,
  LabSection,
  labLogEntry,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/network")({
  component: LabNetworkPage,
})

function LabNetworkPage() {
  const online = !useIsOffline()
  const [log, setLog] = useState<LabLogEntry[]>([])
  const [native, setNative] = useState(false)

  useEffect(() => {
    setNative(isNativePlatform())
    //the same subscribe/get pair the hook uses — and the same pair a data layer
    //wires into TanStack Query's onlineManager, which is why it is not a hook
    return subscribeOnline(() => {
      setLog((entries) =>
        [labLogEntry(`getOnline() → ${getOnline()}`), ...entries].slice(
          0,
          40,
        ),
      )
    })
  }, [])

  return (
    <LabPage
      title="Network"
      subtitle="Turn airplane mode on and off. On native the signal is event-driven and accurate; on web it only proves a network interface exists."
    >
      <LabBrief
        what="Reachability, and how much you are allowed to believe it — an event-driven OS signal on native versus a link-level guess on the web."
        steps={[
          "Read the signal-quality badge first: it tells you how much the row above it is worth on this target.",
          "Turn on airplane mode. The reachability row must flip to offline within a second, with no reload, and the log must record the change.",
          "Turn airplane mode off. It must flip back, and log a second event.",
          "Do it three times and confirm one event per change — not a burst.",
          "If you can, join a Wi-Fi network with no internet (a captive portal). On web this will still read ONLINE, which is the documented limit and not a bug.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "navigator.onLine, which only proves a network interface exists. A captive portal or a router with no upstream both read online. Coarse by construction.",
          },
          pwa: {
            verdict: "partial",
            note: "Identical to the browser. Worth pairing with the Offline page: a service worker can keep the app working while this reads offline.",
          },
          ios: {
            verdict: "works",
            note: "@capacitor/network, event-driven from the OS. Trustworthy enough to gate a sync on.",
          },
          android: {
            verdict: "works",
            note: "Same plugin, and it can also distinguish connection type. Doze mode can delay an event by a few seconds on a sleeping device.",
          },
        }}
        wrong="The row never changes when you toggle airplane mode — the subscription is dead, and anything that resumes work on reconnect will never resume. Or events arrive in bursts, which will hammer whatever is wired to them."
      />

      <LabSection title="Reachability">
        <LabRow
          label="useIsOffline()"
          value={
            <LabBadge tone={online ? "ok" : "bad"}>
              {online ? "online" : "offline"}
            </LabBadge>
          }
        />
        <LabRow
          label="signal quality"
          value={
            <LabBadge tone={native ? "ok" : "warn"}>
              {native
                ? "accurate (@capacitor/network)"
                : "coarse (navigator.onLine)"}
            </LabBadge>
          }
          hint="navigator.onLine goes true for a captive portal or a router with no upstream — it is a link check, not a reachability check."
        />
      </LabSection>

      <LabSection title="Events">
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}

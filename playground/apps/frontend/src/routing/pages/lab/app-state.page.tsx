import type { AppState } from "@arrzdev/adaptv/capabilities"
import {
  getAppState,
  onPause,
  onResume,
  subscribeAppState,
} from "@arrzdev/adaptv/capabilities"
import {
  useAppState,
  useOnPause,
  useOnResume,
} from "@arrzdev/adaptv/hooks"
import { createFileRoute } from "@arrzdev/adaptv/router"
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

export const Route = createFileRoute("/_providers/lab/app-state")({
  component: LabAppStatePage,
})

function LabAppStatePage() {
  const [state, setState] = useState<AppState>("active")
  const [log, setLog] = useState<LabLogEntry[]>([])
  //the React wrappers, next to the raw accessors they wrap — the two columns
  //must never disagree, which is the whole point of showing both
  const hookState = useAppState()
  const [resumes, setResumes] = useState(0)
  const [pauses, setPauses] = useState(0)
  useOnResume(() => setResumes((count) => count + 1))
  useOnPause(() => setPauses((count) => count + 1))

  useEffect(() => {
    setState(getAppState())
    const append = (entry: string) =>
      setLog((entries) => [labLogEntry(entry), ...entries].slice(0, 40))

    const unsubscribeAll = [
      subscribeAppState((next) => {
        setState(next)
        append(`subscribeAppState → ${next}`)
      }),
      onResume(() => append("onResume")),
      onPause(() => append("onPause")),
    ]
    return () => {
      for (const unsubscribe of unsubscribeAll) unsubscribe()
    }
  }, [])

  return (
    <LabPage
      title="App state"
      subtitle="Background this app and come back. On native that is a Capacitor resume; on web it is visibilitychange, plus a bfcache pageshow on mobile Safari."
    >
      <LabBrief
        what="That backgrounding and returning to the app produces exactly one pause and one resume, on every shell — including the bfcache restore that has no pause in front of it."
        steps={[
          "Note the two counters, then background the app (home button / swipe up / switch tabs) and come back.",
          "Both counters must have gone up by exactly one. Not two, not zero.",
          "Do it three more times in a row. The counters must track exactly.",
          "Background it and leave it for a minute before returning — a long background must still produce one resume, not a burst.",
          "On mobile Safari: navigate away with the browser's back gesture and then forward again. That is a bfcache restore, and it must still produce a resume even though no pause was observed.",
          "Check that getAppState() and useAppState() never disagree — they are one signal in two shapes.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Driven by visibilitychange. Switching browser TABS counts as backgrounding; merely clicking another window may not, because visibility and focus are different things.",
          },
          pwa: {
            verdict: "works",
            note: "Same signal, plus the bfcache pageshow path on mobile Safari — which is the case with no matching pause and is forced through deliberately.",
          },
          ios: {
            verdict: "works",
            note: "A real Capacitor appStateChange from the OS, so it fires for a phone call or a notification pull-down, not just an app switch.",
          },
          android: {
            verdict: "works",
            note: "Same. Also try the recents switcher and a quick return — a fast round trip must still be one pause and one resume.",
          },
        }}
        wrong="A single background produces two resumes (the edge-trigger is gone and anything wired to it — a refetch, a sync, an analytics ping — now doubles). Or nothing fires on native, which means the data layer is deaf: a WebView resume is not a browser focus event, so TanStack Query's refetchOnWindowFocus will never fire there either."
      />

      <LabSection title="Current">
        <LabRow
          label="getAppState()"
          value={
            <LabBadge tone={state === "active" ? "ok" : "warn"}>
              {state}
            </LabBadge>
          }
        />
      </LabSection>

      <LabSection
        title="Events"
        description="Edge-triggered: a resume fires once, not on every notification while already foregrounded. A bfcache restore is forced through, because the pause that preceded it was never observed."
      >
        <LabLog entries={log} />
      </LabSection>

      <LabSection
        title="The hooks"
        description="useAppState() / useOnResume() / useOnPause() — the React wrappers over the same accessor. The counters are edge-triggered, so backgrounding once adds exactly one."
      >
        <LabRow
          label="useAppState()"
          value={
            <LabBadge tone={hookState === "active" ? "ok" : "warn"}>
              {hookState}
            </LabBadge>
          }
          hint="Must always agree with getAppState() above — one signal, two shapes."
        />
        <LabRow label="useOnResume() calls" value={String(resumes)} />
        <LabRow label="useOnPause() calls" value={String(pauses)} />
      </LabSection>

      <LabSection title="Why this is not just a hook">
        <p className="text-sm text-muted">
          The important consumers are not components. A native WebView
          resume is not a browser focus event, so TanStack Query&apos;s{" "}
          <code>refetchOnWindowFocus</code> never fires on native — the
          subscribe/get pair is what lets the data layer be wired to the
          real signal.
        </p>
      </LabSection>
    </LabPage>
  )
}

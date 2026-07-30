import { PullToRefresh, ScrollView } from "@arrzdev/adaptv/components"
import { useRef, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import type { LabLogEntry } from "@/components/lab/lab-kit"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabCaveat,
  LabLog,
  LabRow,
  LabSection,
  labLogEntry,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute({
  component: LabPullToRefreshPage,
})

const LINES = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
] as const

function LabPullToRefreshPage() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [enabled, setEnabled] = useState(true)
  const [slow, setSlow] = useState(false)
  const [refreshes, setRefreshes] = useState(0)
  const [log, setLog] = useState<LabLogEntry[]>([])

  const note = (text: string) =>
    setLog((entries) => [labLogEntry(text), ...entries].slice(0, 40))

  async function refresh() {
    note("onRefresh started")
    await new Promise((resolve) => setTimeout(resolve, slow ? 3000 : 600))
    setRefreshes((n) => n + 1)
    note("onRefresh resolved")
  }

  return (
    <LabPage
      title="PullToRefresh"
      subtitle="A gesture that must only exist at the very top of a scroller, and must never be confused with a scroll. The failure everyone ships is a page that refuses to scroll up because the refresher grabbed the drag."
    >
      <LabBrief
        what="That pulling down from the TOP of a scroller shows an indicator, that releasing past the threshold runs the async work and holds the snap until it resolves, and that pulling anywhere else just scrolls."
        steps={[
          "Scroll the box below to the middle, then pull DOWN. It must scroll normally — no indicator, nothing captured.",
          "Scroll to the very top and pull down slowly. The indicator must appear and rotate in proportion to how far you have pulled.",
          "Release before the threshold. It must spring back and NOT refresh — the counter must not move.",
          "Pull past the threshold and release. It must snap to the refreshing position, spin, and only close when the work resolves.",
          "Turn on “slow refresh” (3s) and repeat: the snap must stay up for the whole three seconds, not close early and leave a spinner over content.",
          "Turn the component off and pull from the top: no indicator at all, and the scroller must still scroll.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Works with a mouse drag, but this is not the target it is for — a desktop browser has no pull-to-refresh idiom and no rubber band, so it reads as a novelty here. Verify correctness, not feel.",
          },
          pwa: {
            verdict: "works",
            note: "The target this exists for. Careful on Android Chrome in a TAB: the browser's own pull-to-refresh can compete at the very top of the page. Installed, the browser's is gone and only this one remains.",
          },
          ios: {
            verdict: "works",
            note: "The one to judge feel on. It must not fight WebKit's rubber band: pulling at the top should show the indicator rather than bouncing the whole page, and overscroll-behavior on the scroller is what keeps the two apart.",
          },
          android: {
            verdict: "works",
            note: "Same. Watch that the OS gesture-navigation bar at the bottom is unaffected, and that a fast pull-and-release does not double-fire onRefresh.",
          },
        }}
        wrong="An indicator appears when you pull from the middle of the list. The scroller refuses to scroll upward because the refresher captured the drag. onRefresh fires twice for one pull. The snap closes before the promise resolves, leaving a spinner floating over live content — that is stuckMinMs or the promise wiring, and it makes every refresh look broken."
      />

      <LabSection title="State">
        <LabRow
          label="completed refreshes"
          value={refreshes}
          hint="Must increase by exactly one per release past the threshold."
        />
        <LabActions>
          <LabButton onClick={() => setEnabled((on) => !on)}>
            enabled: {String(enabled)}
          </LabButton>
          <LabButton onClick={() => setSlow((on) => !on)}>
            slow refresh: {String(slow)}
          </LabButton>
        </LabActions>
        <LabRow
          label="work duration"
          value={
            <LabBadge tone={slow ? "warn" : "muted"}>
              {slow ? "3000ms" : "600ms"}
            </LabBadge>
          }
        />
      </LabSection>

      <LabSection
        title="Pull the box"
        description="The gesture root wraps the scroller and is told which element actually overflows via scrollContainerRef — the indicator is positioned against the root, and the pull is only armed when that scroller is at scrollTop 0."
      >
        <PullToRefresh
          onRefresh={refresh}
          enabled={enabled}
          scrollContainerRef={scrollRef}
          className="overflow-hidden rounded-md bg-secondary"
        >
          <ScrollView ref={scrollRef} className="h-64 p-3">
            {LINES.map((line) => (
              <p key={line} className="py-2 text-sm text-foreground">
                Line {line} — scroll to the top before pulling.
              </p>
            ))}
          </ScrollView>
        </PullToRefresh>
        <LabCaveat>
          The page you are on is itself a scroller. If pulling inside the
          box moves the whole page instead, the box&apos;s overscroll
          containment is what failed — that is the same{" "}
          <code>overscroll-behavior: contain</code> the View &amp;
          ScrollView page tests, reached from a different direction.
        </LabCaveat>
      </LabSection>

      <LabSection title="Log">
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}

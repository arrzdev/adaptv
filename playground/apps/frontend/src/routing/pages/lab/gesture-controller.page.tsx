import { gestureController } from "@arrzdev/adaptv/capabilities"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { useCallback, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import type { LabLogEntry } from "@/components/lab/lab-kit"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabLog,
  LabRow,
  LabSection,
  labLogEntry,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/gesture-controller")(
  {
    component: LabGestureControllerPage,
  },
)

const DRAWER = { id: "lab-drawer", priority: 300 }
const SWIPE = { id: "lab-swipe", priority: 100 }

function LabGestureControllerPage() {
  const [captured, setCaptured] = useState<string | null>(null)
  const [scrollBlocked, setScrollBlocked] = useState(false)
  const [log, setLog] = useState<LabLogEntry[]>([])

  const sync = useCallback((entry: string) => {
    setLog((entries) => [labLogEntry(entry), ...entries].slice(0, 40))
    setCaptured(gestureController.getCaptured())
    setScrollBlocked(gestureController.isScrollBlocked())
  }, [])

  const request = (
    gesture: { id: string; priority: number },
    blocksScroll: boolean,
  ) => {
    const won = gestureController.requestCapture(
      gesture.id,
      gesture.priority,
      () => sync(`${gesture.id} lost the pointer (onLost)`),
      { blocksScroll },
    )
    sync(
      `${gesture.id} (p${gesture.priority}) requestCapture → ${won ? "won" : "refused"}`,
    )
  }

  return (
    <LabPage
      title="Gesture controller"
      subtitle="One arbiter per app. Exactly one gesture owns the pointer at a time, higher priority pre-empts lower, and the loser is told so it can clean up."
    >
      <LabBrief
        what="That exactly one gesture owns the pointer at a time, that a higher priority pre-empts a lower one, that the loser is told, and that releasing or disabling always frees the pointer."
        steps={[
          "Press “swipe (p100)”. It must win, and getCaptured() must show it.",
          "Now press “drawer (p300)”. It must win too, AND the log must show the swipe receiving its onLost.",
          "Release the drawer, then request the drawer first and the swipe second. The swipe must be REFUSED — lower priority does not pre-empt.",
          "With the drawer holding, check isScrollBlocked(): it must be true, because that gesture asked to block the scroller.",
          "Press “disable drawer” while it holds the pointer. The capture must be released — an unmounting drawer must never leave the pointer held.",
          "Release everything and confirm getCaptured() reads “not reported here”.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Pure JS arbitration, so it behaves identically on every target. This page is testing the algorithm, not the platform.",
          },
          pwa: {
            verdict: "works",
            note: "Identical.",
          },
          ios: {
            verdict: "works",
            note: "Identical arbitration, but this is the target where the scroll block matters: touch-action cannot be changed mid-touch on iOS, so blocking the scroller imperatively is the only way to stop a scroll a drag has taken over.",
          },
          android: {
            verdict: "works",
            note: "Identical arbitration. Chromium can change touch-action mid-gesture, so the scroll block is belt-and-braces here rather than load-bearing.",
          },
        }}
        wrong="A lower-priority gesture wins, or the loser never gets its onLost and keeps animating something nobody is dragging. Worst: a capture that is never released — every gesture on the screen then goes dead with nothing on screen to explain why."
      />

      <LabSection title="State">
        <LabRow
          label="getCaptured()"
          value={
            captured === null ? null : (
              <LabBadge tone="ok">{captured}</LabBadge>
            )
          }
        />
        <LabRow
          label="isScrollBlocked()"
          value={
            <LabBadge tone={scrollBlocked ? "warn" : "muted"}>
              {String(scrollBlocked)}
            </LabBadge>
          }
          hint="`touch-action` cannot be changed mid-touch on iOS, so blocking the scroller imperatively is the only reliable way to stop a scroll a drag has taken over."
        />
      </LabSection>

      <LabSection
        title="Compete for the pointer"
        description="Request the low-priority gesture first, then the high one — watch the low one get its onLost. Then try it in the other order and watch the request be refused."
      >
        <LabActions>
          <LabButton onClick={() => request(SWIPE, false)}>
            swipe (p100)
          </LabButton>
          <LabButton onClick={() => request(DRAWER, true)}>
            drawer (p300, blocks scroll)
          </LabButton>
        </LabActions>
        <LabActions>
          <LabButton
            tone="danger"
            onClick={() => {
              gestureController.release(SWIPE.id)
              sync(`release(${SWIPE.id})`)
            }}
          >
            release swipe
          </LabButton>
          <LabButton
            tone="danger"
            onClick={() => {
              gestureController.release(DRAWER.id)
              sync(`release(${DRAWER.id})`)
            }}
          >
            release drawer
          </LabButton>
        </LabActions>
      </LabSection>

      <LabSection
        title="Disable a gesture"
        description="Disabling the current holder releases the capture — a drawer unmounting mid-drag must not leave the pointer held forever, which would silently deaden every gesture on screen."
      >
        <LabActions>
          <LabButton
            onClick={() => {
              gestureController.setEnabled(DRAWER.id, false)
              sync(`setEnabled(${DRAWER.id}, false)`)
            }}
          >
            disable drawer
          </LabButton>
          <LabButton
            onClick={() => {
              gestureController.setEnabled(DRAWER.id, true)
              sync(`setEnabled(${DRAWER.id}, true)`)
            }}
          >
            enable drawer
          </LabButton>
        </LabActions>
      </LabSection>

      <LabSection title="Log">
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}

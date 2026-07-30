import { Archive, Trash2 } from "lucide-react"
import { useState } from "react"
import labPhotoUrl from "@/assets/lab-photo.jpg?url"
import { LabBrief } from "@/components/lab/lab-brief"
import type { LabLogEntry } from "@/components/lab/lab-kit"
import {
  LabActions,
  LabButton,
  LabCaveat,
  LabLog,
  LabRow,
  LabSection,
  labLogEntry,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"
import { AppSwipeable, IconButton } from "@/components/ui"

export const Route = createFileRoute({
  component: LabSwipeablePage,
})

const ROWS = ["first", "second", "third"] as const

const ACTION_CLASS =
  "h-full min-w-20 rounded-none text-primary-foreground active:scale-100"

function LabSwipeablePage() {
  const [log, setLog] = useState<LabLogEntry[]>([])
  const [enabled, setEnabled] = useState(true)

  const note = (text: string) =>
    setLog((entries) => [labLogEntry(text), ...entries].slice(0, 40))

  return (
    <LabPage
      title="Swipeable"
      subtitle="Row actions. The whole component is one promise — the row follows your finger — and every failure mode is a variation on it letting go."
    >
      <LabBrief
        what="That a row tracks the finger horizontally, opens and closes at the right thresholds, never steals a vertical scroll, and that a group only lets one row be open at a time."
        steps={[
          "Drag the first row slowly to the left. It must track your finger 1:1 the whole way, not jump to an open position.",
          "Release it half open. It must settle to fully open or fully closed, never rest in between.",
          "With one row open, drag another. The first must close by itself — that is the Group.",
          "Scroll the page vertically with your finger STARTING on a row. The page must scroll and the row must not move at all.",
          "Drag the row that contains a photo. It must behave exactly like the others — an image inside a row is where the browser's native image-drag used to steal the pointer.",
          "Tap an action button in the open tray. It must fire once and the row must close.",
          "Turn the rows off with the toggle: dragging must do nothing, and the content must still be readable and tappable.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Everything, with the mouse. Also worth checking a text-selection drag: pressing on the row's label and dragging must swipe, not select a paragraph.",
          },
          pwa: {
            verdict: "works",
            note: "Everything, and this is the target where ui.noSelect is stamped — so the selection-drag case above should be impossible rather than merely unlikely.",
          },
          ios: {
            verdict: "works",
            note: "The strictest target. Two things to be deliberate about: a left-edge swipe must be the OS/app back gesture and NOT open a row, and pointercancel has to arrive when a scroll takes over — that is what the clickable utility's touch-action longhand is for.",
          },
          android: {
            verdict: "works",
            note: "Everything. Watch for the row jumping a few pixels when the drag is recognised: Chromium's slop threshold is larger, and a jump means the gesture is not compensating for it.",
          },
        }}
        wrong="The row stops following your finger part way through a drag and snaps to an end position. A vertical scroll that starts on a row drags the row sideways instead. Two rows are open at once inside a Group. The photo row behaves differently from the others — that is the browser's native image drag stealing the pointer, and the fix is the media user-select reset."
      />

      <LabSection
        title="A group of rows"
        description="Swipeable.Group closes any open sibling when a new one opens, so the tray is never ambiguous. Actions are ordinary buttons in a tray behind the content."
      >
        <LabActions>
          <LabButton onClick={() => setEnabled((on) => !on)}>
            enabled: {String(enabled)}
          </LabButton>
        </LabActions>
        <AppSwipeable.Group>
          <div className="flex flex-col gap-y-2">
            {ROWS.map((row) => (
              <AppSwipeable
                key={row}
                enabled={enabled}
                className="bg-surface"
                onOpen={(side) => note(`${row} opened (${side})`)}
                onClose={() => note(`${row} closed`)}
              >
                <AppSwipeable.Content className="px-4 py-4 text-sm text-foreground">
                  the {row} row — drag me left or right
                </AppSwipeable.Content>
                <AppSwipeable.LeftActions>
                  <IconButton
                    onClick={() => note(`${row} archived`)}
                    aria-label={`Archive the ${row} row`}
                    className={`${ACTION_CLASS} bg-success hover:bg-success`}
                  >
                    <Archive size={20} strokeWidth={1.75} aria-hidden />
                  </IconButton>
                </AppSwipeable.LeftActions>
                <AppSwipeable.RightActions>
                  <IconButton
                    onClick={() => note(`${row} deleted`)}
                    aria-label={`Delete the ${row} row`}
                    className={`${ACTION_CLASS} bg-error hover:bg-error`}
                  >
                    <Trash2 size={20} strokeWidth={1.75} aria-hidden />
                  </IconButton>
                </AppSwipeable.RightActions>
              </AppSwipeable>
            ))}
          </div>
        </AppSwipeable.Group>
      </LabSection>

      <LabSection
        title="A row containing an image"
        description="The historical failure: a selection-drag starting on an <img> is the browser's cue to begin a native image drag, which steals the pointer and the row stops tracking. adaptv makes media unselectable on every target, regardless of ui.noSelect, precisely for this."
      >
        <AppSwipeable
          className="bg-surface"
          onOpen={() => note("photo row opened")}
          onClose={() => note("photo row closed")}
        >
          <AppSwipeable.Content className="flex items-center gap-x-3 px-4 py-3">
            <img
              src={labPhotoUrl}
              alt=""
              width={48}
              height={32}
              className="rounded-sm"
            />
            <span className="text-sm text-foreground">
              start the drag ON the photo
            </span>
          </AppSwipeable.Content>
          <AppSwipeable.RightActions>
            <IconButton
              onClick={() => note("photo row deleted")}
              aria-label="Delete the photo row"
              className={`${ACTION_CLASS} bg-error hover:bg-error`}
            >
              <Trash2 size={20} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </AppSwipeable.RightActions>
        </AppSwipeable>
        <LabCaveat>
          A selected image is broken twice over — it paints a blue wash
          over the picture, and the selection-drag hands the pointer to a
          native image drag. That is why the{" "}
          <code>img, svg, video, canvas</code> reset is doctrine and has no
          config knob, while text selection does.
        </LabCaveat>
      </LabSection>

      <LabSection title="Log">
        <LabRow
          label="enabled"
          value={String(enabled)}
          hint="Disabled rows render their content and nothing else — no gesture, no tray."
        />
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}

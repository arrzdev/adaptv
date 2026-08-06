import { createFileRoute } from "@arrzdev/adaptv/router"
import { useState } from "react"
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
import { Checkbox, Switch } from "@/components/ui"

export const Route = createFileRoute("/_providers/lab/toggles")({
  component: LabTogglesPage,
})

//the app's Checkbox/Switch are thin wrappers: they supply the Box/Thumb slot
//and a className, and forward everything else to the primitive. Testing them IS
//testing the primitive, and it keeps the page in the app's own visual language.

function LabTogglesPage() {
  const [checked, setChecked] = useState(false)
  const [indeterminate, setIndeterminate] = useState(true)
  const [on, setOn] = useState(false)
  const [log, setLog] = useState<LabLogEntry[]>([])

  const note = (text: string) =>
    setLog((entries) => [labLogEntry(text), ...entries].slice(0, 40))

  return (
    <LabPage
      title="Checkbox & Switch"
      subtitle="Two controls with the same contract: a hidden native input for semantics, a painted box or track for looks, and a gesture layer that must never let the two disagree."
    >
      <LabBrief
        what="That both toggle from a tap, from Space while focused, and from a drag on the Switch — and that a controlled instance never moves unless its owner says so."
        steps={[
          "Tap the controlled checkbox. It must flip, and the state row below must flip with it.",
          "Press “freeze the controlled checkbox”, then tap it repeatedly. It must NOT move — onCheckedChange still fires (watch the log) but the visual state is the owner's to decide.",
          "Tab to each control and press Space. Each must toggle exactly once per press, with a visible focus ring.",
          "Drag the Switch thumb slowly from one end to the other and release halfway back. It must settle to the side you released nearest, not snap back arbitrarily.",
          "Flick the Switch quickly. A fast flick must commit even if your finger did not travel the full width.",
          "Check the indeterminate checkbox: it shows a dash, and the FIRST tap must resolve it to checked, not to unchecked.",
          "Try the disabled pair. Nothing moves, nothing fires, and the cursor is not-allowed on desktop.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Everything, including the drag — a mouse drag on the Switch thumb behaves like a finger. This is the easiest target to check the keyboard half on.",
          },
          pwa: {
            verdict: "works",
            note: "Same. Worth re-checking the drag here specifically: an installed app has no browser gesture competing for the horizontal drag, which a browser tab sometimes does.",
          },
          ios: {
            verdict: "works",
            note: "Everything. The one to watch is the Switch drag versus the page scroll — a mostly-horizontal drag must move the thumb and NOT scroll the page, and a mostly-vertical one must scroll and not move the thumb.",
          },
          android: {
            verdict: "works",
            note: "Same as iOS. Also check that a long-press on a toggle does not start a text selection — the noSelect stamp is what prevents it.",
          },
        }}
        wrong="A frozen controlled control moves anyway (the primitive is keeping its own state behind the prop, and the app's data will drift from the UI). Space does nothing while focused, or fires twice. A slow Switch drag jumps to the end instead of following the finger. The indeterminate checkbox resolves to unchecked on the first tap, which loses the user's intent."
      />

      <LabSection
        title="Checkbox — controlled"
        description="`checked` + `onCheckedChange`. The primitive renders whatever it is told and reports what the user asked for; those are two different facts and it never conflates them."
      >
        <div className="flex items-center gap-x-3">
          <Checkbox
            checked={checked}
            onCheckedChange={(next) => {
              note(`onCheckedChange(${next})`)
              setChecked(next)
            }}
            aria-label="Controlled checkbox"
          />
          <span className="text-sm text-foreground">
            controlled — the owner decides
          </span>
        </div>
        <LabRow
          label="checked"
          value={
            <LabBadge tone={checked ? "ok" : "muted"}>
              {String(checked)}
            </LabBadge>
          }
        />
        <FrozenCheckbox note={note} />
      </LabSection>

      <LabSection
        title="Checkbox — uncontrolled and indeterminate"
        description="defaultChecked hands the state to the primitive. `indeterminate` is a third visual state, not a third value — the underlying input is still either on or off."
      >
        <div className="flex items-center gap-x-3">
          <Checkbox
            defaultChecked
            onCheckedChange={(next) => note(`uncontrolled → ${next}`)}
            aria-label="Uncontrolled checkbox"
          />
          <span className="text-sm text-foreground">
            defaultChecked — no owner
          </span>
        </div>
        <div className="flex items-center gap-x-3">
          <Checkbox
            checked={false}
            indeterminate={indeterminate}
            onCheckedChange={(next) => {
              note(`indeterminate → resolved to ${next}`)
              setIndeterminate(false)
            }}
            aria-label="Indeterminate checkbox"
          />
          <span className="text-sm text-foreground">
            indeterminate — first tap must resolve to CHECKED
          </span>
        </div>
        <LabActions>
          <LabButton onClick={() => setIndeterminate(true)}>
            make it indeterminate again
          </LabButton>
        </LabActions>
      </LabSection>

      <LabSection
        title="Switch"
        description="Tap anywhere on the track, or drag the thumb. The drag is the part a plain <input type=checkbox> cannot do, and the part that has to not fight the page scroll."
      >
        <div className="flex items-center gap-x-3">
          <Switch
            checked={on}
            onCheckedChange={(next) => {
              note(`switch → ${next}`)
              setOn(next)
            }}
            aria-label="Lab switch"
          />
          <span className="text-sm text-foreground">
            tap the track, or drag the thumb
          </span>
        </div>
        <LabRow
          label="checked"
          value={
            <LabBadge tone={on ? "ok" : "muted"}>{String(on)}</LabBadge>
          }
        />
      </LabSection>

      <LabSection title="Disabled">
        <div className="flex items-center gap-x-4">
          <Checkbox
            disabled
            checked
            onCheckedChange={() => note("THIS MUST NEVER APPEAR")}
            aria-label="Disabled checkbox"
          />
          <Switch
            disabled
            checked={false}
            onCheckedChange={() => note("THIS MUST NEVER APPEAR")}
            aria-label="Disabled switch"
          />
          <span className="text-sm text-muted">both inert</span>
        </div>
      </LabSection>

      <LabSection title="Log">
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}

/**
 * A controlled checkbox whose owner refuses to move it.
 *
 * The interesting failure it catches is the one that only shows up under a
 * rejected update: a primitive that keeps its own state behind the prop looks
 * perfect until the app says no, and then the UI and the data are out of step
 * with nothing on screen to say so.
 */
function FrozenCheckbox({ note }: { note: (text: string) => void }) {
  const [frozen, setFrozen] = useState(false)
  const [value, setValue] = useState(false)
  const [attempts, setAttempts] = useState(0)

  return (
    <>
      <div className="flex items-center gap-x-3">
        <Checkbox
          checked={value}
          onCheckedChange={(next) => {
            note(`frozen? ${frozen} — asked for ${next}`)
            if (frozen) setAttempts((n) => n + 1)
            else setValue(next)
          }}
          aria-label="Freezable checkbox"
        />
        <span className="text-sm text-foreground">
          {frozen ? "frozen — must not move" : "live"}
        </span>
      </div>
      <LabRow
        label="rejected attempts"
        value={attempts}
        hint="Every one of these must have left the checkbox exactly where it was."
      />
      <LabActions>
        <LabButton onClick={() => setFrozen((f) => !f)}>
          {frozen ? "unfreeze" : "freeze the controlled checkbox"}
        </LabButton>
      </LabActions>
    </>
  )
}

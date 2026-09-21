import { Pressable } from "@arrzdev/adaptv/components"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { useCallback, useState } from "react"
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

export const Route = createFileRoute("/_providers/lab/pressable")({
  component: LabPressablePage,
})

//plain `active:` — adaptv patches the built-in variant, so on a gesture-engine
//element it compiles to `[data-pressed]` (the attribute the engine writes with
//setAttribute, so feedback costs zero React renders) and on anything else it stays
//native `:active`. Nothing to learn, nothing to remember.
const SURFACE =
  "rounded-md bg-secondary px-4 py-6 text-center text-sm font-medium text-foreground transition-transform duration-200 ease-out active:scale-95 active:bg-primary/15"

function LabPressablePage() {
  const [log, setLog] = useState<LabLogEntry[]>([])
  const [taps, setTaps] = useState(0)

  const note = useCallback((text: string) => {
    setLog((entries) => [labLogEntry(text), ...entries].slice(0, 40))
  }, [])

  return (
    <LabPage
      title="Pressable"
      subtitle="adaptv's press engine on any element. Same mechanics as Button, without the <button> semantics, the haptics or the slots."
    >
      <LabBrief
        what="The press engine on a non-semantic element: reentrant press tracking, a forgiving release region, and zero React renders per press."
        steps={[
          "Press and hold the first box. It must shrink and tint immediately.",
          "Still holding, drag off it and hold there — the press must drop. Drag back on — it must COME BACK. That reentrancy is what native :active cannot do.",
          "Release inside. onPress must fire exactly once and the counter must move.",
          "Press the second box (8px outset), drag well past its edge, and release. Nothing must fire.",
          "Press the disabled box. Nothing must fire and it must not animate.",
          "Press the anchor and the rendered <button>. Both must respond, because `render` keeps the engine.",
          "Now try to TAB to the first box. You must not be able to — a pressed div is not a control, and the caveat says so.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Everything. With a mouse, dragging out and back re-lights the press, which is the same behaviour a finger gets.",
          },
          pwa: {
            verdict: "works",
            note: "Identical.",
          },
          ios: {
            verdict: "works",
            note: "Identical, and this is the target the engine exists for: native :active cannot be cleared from JS and will not re-light on re-entry, so the reentrancy step is the one that matters here.",
          },
          android: {
            verdict: "works",
            note: "Identical. Watch for a press that survives a scroll starting on the box — a scroll must cancel the press, not keep it lit.",
          },
        }}
        wrong="The press does not come back when you drag your finger back on. A press that stays lit after release, or after a scroll takes over. Or the disabled box firing — `non-clickable` is locked precisely so a className cannot undo it."
      />

      <LabSection
        title="Press feedback"
        description="Press and hold, then drag your finger off the box and back on again. The press is REENTRANT — it drops when you leave the region and comes back when you slide in, which native :active cannot do."
      >
        <Pressable
          className={SURFACE}
          onPressDown={() => note("onPressDown")}
          onPress={() => {
            setTaps((n) => n + 1)
            note("onPress (released inside the region)")
          }}
        >
          press me
        </Pressable>
        <LabRow label="onPress fired" value={taps} />
        <LabRow
          label="press state"
          value="data-pressed, on the element"
          hint="Not React state: the engine writes the attribute directly, so a press never re-renders. Style it with plain `active:` — adaptv points that variant here instead of at native :active."
        />
      </LabSection>

      <LabSection
        title="Release outside"
        description="Press this one, drag well past its edge, and let go. Nothing fires — the same forgiving tracking a native control does, and the reason activation rides onPress instead of a DOM click."
      >
        <Pressable
          className={SURFACE}
          pressOutset={8}
          onPress={() => note("outside-demo onPress (you stayed close)")}
        >
          small press region (8px outset)
        </Pressable>
      </LabSection>

      <LabSection
        title="Disabled"
        description="Drops every gesture and says so as data-disabled + aria-disabled. The locked class flips to `non-clickable`, which a className cannot undo."
      >
        <Pressable
          disabled
          className={`${SURFACE} opacity-40`}
          onPress={() => note("THIS MUST NEVER APPEAR")}
        >
          disabled
        </Pressable>
      </LabSection>

      <LabSection
        title="Stress — the press outlives the control"
        description="Two things a real app does to a control mid-press: it disables it (a submit that started pending) and it unmounts it (a row that was deleted). Neither may activate on release, leave data-pressed behind, or fire a timer against a node React has dropped."
      >
        <MidPressProbes note={note} />
      </LabSection>

      <LabSection
        title="render — a prop, not asChild"
        description="Render any element and keep the engine. The element's own className merges through mergeStyles, so the structural class still wins."
      >
        <Pressable
          //no children on the Pressable: the element keeps its own
          render={
            <a href="#pressable-lab" className="block">
              an anchor, pressed
            </a>
          }
          className={SURFACE}
          onPress={() => note("anchor onPress")}
        />
        <Pressable
          render={(props, state) => (
            <button type="button" {...props}>
              {state.disabled ? "disabled" : "a real <button>, pressed"}
            </button>
          )}
          className={`${SURFACE} w-full`}
          onPress={() => note("button onPress")}
        />
      </LabSection>

      <LabSection title="Semantics">
        <LabCaveat>
          Pressable adds mechanics, not semantics: a pressed div is not
          focusable and no screen reader announces it. Use Button for
          controls, or hand this one the semantics yourself — a render
          element that is a real button, or role + tabIndex.
        </LabCaveat>
        <LabRow
          label="data-adaptv"
          value={<LabBadge tone="ok">pressable</LabBadge>}
          hint="Restyle every Pressable in an app from global CSS with no imports: [data-adaptv='pressable'] { … }"
        />
      </LabSection>

      <LabSection title="Log">
        <LabLog entries={log} />
      </LabSection>
    </LabPage>
  )
}

//how long after contact the probes turn on themselves: past the engine's 100ms
//show-delay, so the press visual is up when the control is pulled out from under it
const MID_PRESS_AFTER_MS = 150

/**
 * Two controls that change while held. The first disables itself, the second
 * unmounts; a reset restores both. `playground/e2e/stress-press.spec.ts` drives
 * them with a held pointer and asserts on the log: the "MUST NEVER APPEAR" lines
 * are the activations neither control may produce.
 */
function MidPressProbes({ note }: { note: (text: string) => void }) {
  const [disabled, setDisabled] = useState(false)
  const [mounted, setMounted] = useState(true)

  return (
    <>
      <Pressable
        data-testid="pressable-flip-disabled"
        disabled={disabled}
        className={`${SURFACE} ${disabled ? "opacity-40" : ""}`}
        onPressDown={() => {
          note(
            `flip-disabled onPressDown — disabling in ${MID_PRESS_AFTER_MS}ms`,
          )
          setTimeout(() => setDisabled(true), MID_PRESS_AFTER_MS)
        }}
        onPress={() =>
          note("THIS MUST NEVER APPEAR — flip-disabled onPress")
        }
      >
        {disabled
          ? "disabled while held — reset below"
          : "hold me: I disable myself while held"}
      </Pressable>
      {mounted ? (
        <Pressable
          data-testid="pressable-unmount"
          className={SURFACE}
          onPressDown={() => {
            note(
              `unmount onPressDown — unmounting in ${MID_PRESS_AFTER_MS}ms`,
            )
            setTimeout(() => setMounted(false), MID_PRESS_AFTER_MS)
          }}
          onPress={() => note("THIS MUST NEVER APPEAR — unmount onPress")}
        >
          hold me: I unmount while held
        </Pressable>
      ) : (
        <LabRow
          label="unmount probe"
          value="unmounted while held — reset below"
        />
      )}
      <LabActions>
        <LabButton
          testId="pressable-stress-reset"
          onClick={() => {
            setDisabled(false)
            setMounted(true)
          }}
        >
          reset the stress probes
        </LabButton>
      </LabActions>
    </>
  )
}

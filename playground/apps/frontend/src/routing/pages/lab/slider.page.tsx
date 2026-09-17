import { Slider } from "@arrzdev/adaptv/components"
import { createFileRoute } from "@arrzdev/adaptv/router"
import type { RefObject } from "react"
import { useEffect, useRef, useState } from "react"
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

export const Route = createFileRoute("/_providers/lab/slider")({
  component: LabSliderPage,
})

//every readout the suite asserts on carries a `data-lab-readout` id, the way the
//log carries `data-lab-log`: a value is how the page reports what a gesture did,
//and matching on a label's text breaks the moment the copy is retuned
function Readout({ id, children }: { id: string; children: string }) {
  return (
    <span data-lab-readout={id} className="font-mono">
      {children}
    </span>
  )
}

function LabSliderPage() {
  return (
    <LabPage
      title="Slider"
      subtitle="A painted track over a hidden native range input. The gesture has one rule a native range cannot keep: a press anywhere on the track sets the value, and a vertical touch scrolls the page instead."
    >
      <LabBrief
        what="That a tap anywhere on the 44px hit area sets the value, that a drag from that tap follows the pointer, that a touch which moves vertically first yields to the page scroll, that the keyboard steps the hidden input exactly, and that onValueCommit fires once per gesture."
        steps={[
          "Tap the Volume track at about three quarters of its width. The value must jump to ~75 on the tap itself, before any drag, and the fill must land under your finger.",
          "Without lifting, drag left to a quarter. The value must fall monotonically with the pointer; data-dragging must read present while you hold and absent the moment you lift.",
          "On the Controlled slider, do one press-and-drag and release: the change counter climbs with every move, the commit counter goes up by exactly 1, and the last committed value equals the value you released on. Then press set 0 / set 50 / set 100 — the thumb must follow the owner's state with no gesture.",
          "Tab to the Opacity slider and press → three times. The readout must read 0.1, 0.2, 0.3 — never 0.30000000000000004. End reads 1, Home reads 0, and the commit counter climbs once per key.",
          "On the Min 5 slider press → from 5: it must read 8, then 11. ← from 5 must stay at 5 — the grid starts at min, not at 0.",
          "Inside the scroll box, start a drag ON the slider and move straight down. On touch the box must scroll and the value must not move. Now start on the slider and move sideways: the value moves and the box does not.",
          "Press the Disabled slider anywhere. Nothing moves, the value stays 60, and the cursor is not-allowed on desktop.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Everything. A mouse has no scroll to protect, so a mouse press sets the value on pointerdown and any drag from there — including a vertical one — keeps moving the value. The scroll-box card is a touch-only distinction; on a mouse it is just a slider inside a box that does not scroll.",
          },
          pwa: {
            verdict: "works",
            note: "Same as the browser tab on desktop. On a phone-installed PWA the touch rules apply: a vertical drag scrolls, a horizontal one past 6px locks the slider and stamps data-dragging.",
          },
          ios: {
            verdict: "works",
            note: "This is the target the painted track exists for: a native <input type=range> on iOS ignores a touch that starts on its track and only moves from a touch that starts on its thumb. Here a tap anywhere on the 44px root sets the value. The scroll-box card is the one to watch — a vertical touch starting on the track must scroll the box, a horizontal one must move the value, and neither may do both.",
          },
          android: {
            verdict: "works",
            note: "Same as iOS on the WebView floor (Chromium 119). Also check that a long-press on the track does not start a text selection, and that the thumb sits fully inside the track at 0 and at 100.",
          },
        }}
        wrong="A tap on the track that does nothing (the value only moves from the thumb — that is the native range behaviour this replaces). A value that moves when you meant to scroll, or a page that will not scroll from a finger that landed on a slider. A thumb that overhangs either end of the track at 0 or at 100. 0.30000000000000004 in the Opacity readout. A drag that keeps moving the value after a vertical scroll took over the gesture, or data-dragging that stays present after you lift."
      />

      <UncontrolledSection />
      <ControlledSection />
      <StepSection />
      <GridSection />
      <ScrollBoxSection />
      <DisabledSection />

      <LabSection title="Attributes">
        <LabRow
          label="data-adaptv"
          value={
            <>
              <LabBadge tone="ok">slider</LabBadge>
              <LabBadge tone="ok">slider-track</LabBadge>
              <LabBadge tone="ok">slider-range</LabBadge>
              <LabBadge tone="ok">slider-thumb</LabBadge>
            </>
          }
          hint="The root is the 44px-tall hit area; the track, the filled range and the thumb are its painted parts. Target any of them from global CSS: [data-adaptv='slider-thumb'] { … }"
        />
        <LabRow
          label="data-orientation"
          value="horizontal"
          hint="Always present on the root. Only horizontal exists today; the attribute is there so a vertical one can be added without renaming anything."
        />
        <LabRow
          label="data-dragging"
          value="present only while a drag is live"
          hint="Stamped on the root by a mouse press or a locked horizontal touch, removed on release. Never present after a vertical touch that yielded to the scroll."
        />
        <LabRow
          label="data-disabled"
          value="present only when disabled"
          hint="The hidden input carries the real `disabled`; the root's attribute is the styling hook."
        />
        <LabRow
          label="--slider-fill"
          value="0 … 1, inline on the root"
          hint="The value as a fraction of the range. The range's width and the thumb's position are both derived from it, so the two can never disagree."
        />
      </LabSection>
    </LabPage>
  )
}

/* =============================================================================
 * SECTIONS
 * ============================================================================= */

function UncontrolledSection() {
  const wrap = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState(40)
  const probe = useRootProbe(wrap)

  return (
    <LabSection
      title="Uncontrolled"
      description="defaultValue hands the state to the primitive. The rows below read the root back, not the React state: --slider-fill is the inline var the paint is derived from, and data-dragging is the attribute a stylesheet keys on."
    >
      <div ref={wrap}>
        <Slider
          defaultValue={40}
          aria-label="Volume"
          onValueChange={setValue}
        />
      </div>
      <LabRow
        label="value"
        value={<Readout id="volume">{String(value)}</Readout>}
      />
      <LabRow
        label="--slider-fill"
        value={
          probe.fill === null ? (
            <LabBadge tone="muted">reading…</LabBadge>
          ) : (
            <Readout id="volume-fill">{probe.fill}</Readout>
          )
        }
        hint="Read off the root's inline style. Must equal value ÷ 100."
      />
      <LabRow
        label="data-dragging"
        value={
          <LabBadge tone={probe.dragging ? "ok" : "muted"}>
            {probe.dragging ? "present" : "absent"}
          </LabBadge>
        }
        hint="Present only while your pointer holds a live drag."
      />
    </LabSection>
  )
}

function ControlledSection() {
  const [value, setValue] = useState(25)
  const [changes, setChanges] = useState(0)
  const [commits, setCommits] = useState(0)
  const [committed, setCommitted] = useState<number | null>(null)

  return (
    <LabSection
      title="Controlled"
      description="`value` + `onValueChange`. Every pointer move reports; onValueCommit fires once, on release — the callback a form saves on, so it must not fire per pixel."
    >
      <Slider
        value={value}
        aria-label="Controlled"
        onValueChange={(next) => {
          setChanges((n) => n + 1)
          setValue(next)
        }}
        onValueCommit={(next) => {
          setCommits((n) => n + 1)
          setCommitted(next)
        }}
      />
      <LabRow
        label="value"
        value={<Readout id="controlled">{String(value)}</Readout>}
      />
      <LabRow
        label="onValueChange calls"
        value={
          <Readout id="controlled-changes">{String(changes)}</Readout>
        }
      />
      <LabRow
        label="onValueCommit calls"
        value={
          <Readout id="controlled-commits">{String(commits)}</Readout>
        }
        hint="Exactly one per press-and-release, one per tap, one per key."
      />
      <LabRow
        label="last committed"
        value={
          committed === null ? (
            <LabBadge tone="muted">none yet</LabBadge>
          ) : (
            <Readout id="controlled-committed">
              {String(committed)}
            </Readout>
          )
        }
      />
      <LabActions>
        <LabButton onClick={() => setValue(0)}>set 0</LabButton>
        <LabButton onClick={() => setValue(50)}>set 50</LabButton>
        <LabButton onClick={() => setValue(100)}>set 100</LabButton>
      </LabActions>
    </LabSection>
  )
}

function StepSection() {
  const [value, setValue] = useState(0)
  const [commits, setCommits] = useState(0)

  return (
    <LabSection
      title="Step 0.1"
      description="min 0, max 1, step 0.1. The readout prints String(value) verbatim, so a float artefact shows as itself."
    >
      <Slider
        min={0}
        max={1}
        step={0.1}
        defaultValue={0}
        aria-label="Opacity"
        onValueChange={setValue}
        onValueCommit={() => setCommits((n) => n + 1)}
      />
      <LabRow
        label="String(value)"
        value={<Readout id="opacity">{String(value)}</Readout>}
        hint="→ three times from 0 must read 0.1, 0.2, 0.3 — exactly. 0.1 + 0.1 + 0.1 in floating point is 0.30000000000000004, and that is the bug this row exists to show."
      />
      <LabRow
        label="onValueCommit calls"
        value={<Readout id="opacity-commits">{String(commits)}</Readout>}
        hint="Once per key press, once per gesture."
      />
    </LabSection>
  )
}

function GridSection() {
  const [value, setValue] = useState(5)

  return (
    <LabSection
      title="Min 5, step 3"
      description="min 5, max 20, step 3 — the grid is 5, 8, 11, 14, 17, 20. It starts at min, so a value of 6 rounds to 5, never to 6 because 6 is a multiple of 3."
    >
      <Slider
        min={5}
        max={20}
        step={3}
        defaultValue={5}
        aria-label="Grid"
        onValueChange={setValue}
      />
      <LabRow
        label="value"
        value={<Readout id="grid">{String(value)}</Readout>}
        hint="Only 5, 8, 11, 14, 17 or 20 may ever appear here."
      />
    </LabSection>
  )
}

const FILLER = [
  "Filler above the slider, so the box has somewhere to scroll to. The point of this card is the gesture that lands on the track and then decides — by its first few pixels — whether it is a scroll or a drag.",
  "A native range makes that decision for you and makes it badly: on iOS a touch starting on the track is not a drag at all, and on Android it is always a drag, so a list of sliders is a list you cannot scroll.",
  "Filler below the slider. Keep going: the box is taller than it looks and the slider sits in the middle of it, with enough room on both sides for a full flick.",
  "The last paragraph. If you can read this without the slider's value having moved, the vertical touch yielded the way it should.",
]

function ScrollBoxSection() {
  const [value, setValue] = useState(20)
  const [scrollTop, setScrollTop] = useState(0)

  return (
    <LabSection
      title="Inside a scroll"
      description="A fixed-height scroll box with the slider mid-way. Drag vertically starting ON the slider: the box must scroll and the value must not move. Drag horizontally: the value moves and the box does not."
    >
      <div
        data-lab-scroll-box=""
        onScroll={(event) =>
          setScrollTop(Math.round(event.currentTarget.scrollTop))
        }
        className="flex h-56 flex-col gap-y-4 overflow-y-auto overscroll-y-contain rounded-md bg-secondary p-3"
      >
        <p className="text-sm text-muted">{FILLER[0]}</p>
        <p className="text-sm text-muted">{FILLER[1]}</p>
        <Slider
          defaultValue={20}
          aria-label="Boxed"
          onValueChange={setValue}
        />
        <p className="text-sm text-muted">{FILLER[2]}</p>
        <p className="text-sm text-muted">{FILLER[3]}</p>
      </div>
      <LabRow
        label="box scrollTop"
        value={<Readout id="box-scroll-top">{`${scrollTop}px`}</Readout>}
      />
      <LabRow
        label="value"
        value={<Readout id="boxed">{String(value)}</Readout>}
      />
      <LabCaveat>
        Touch only. A mouse has no scroll gesture to protect, so a mouse
        press on the slider is always a drag — including one that then
        moves straight down. The scroll-versus-drag split is proven with a
        finger, on the simulators; the desktop suite pins only the mouse
        half.
      </LabCaveat>
    </LabSection>
  )
}

function DisabledSection() {
  const [fired, setFired] = useState(0)

  return (
    <LabSection title="Disabled">
      <Slider
        disabled
        defaultValue={60}
        aria-label="Disabled slider"
        onValueChange={() => setFired((n) => n + 1)}
      />
      <LabRow
        label="value"
        value="60"
        hint="Inert: no press, drag or key may move it, and the cursor is not-allowed on desktop."
      />
      <LabRow
        label="onValueChange calls"
        value={
          <LabBadge tone={fired === 0 ? "ok" : "bad"}>
            <Readout id="disabled-changes">{String(fired)}</Readout>
          </LabBadge>
        }
        hint="Must stay 0 — a disabled control never reports."
      />
    </LabSection>
  )
}

/* =============================================================================
 * PROBES
 * ============================================================================= */

/**
 * Reads the slider ROOT back, live: the inline `--slider-fill` and whether
 * `data-dragging` is stamped. A MutationObserver rather than a pointer listener,
 * because the attribute is the contract — a stylesheet keys on it — and a probe
 * that mirrors the gesture would be right even when the attribute is wrong.
 */
function useRootProbe(wrap: RefObject<HTMLDivElement | null>) {
  const [fill, setFill] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const root = wrap.current?.querySelector<HTMLElement>(
      "[data-adaptv='slider']",
    )
    if (!root) return
    const read = () => {
      setFill(root.style.getPropertyValue("--slider-fill").trim())
      setDragging(root.hasAttribute("data-dragging"))
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["style", "data-dragging"],
    })
    return () => observer.disconnect()
  }, [wrap])

  return { fill, dragging }
}

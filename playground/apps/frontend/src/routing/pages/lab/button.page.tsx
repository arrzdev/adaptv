import { Button } from "@arrzdev/adaptv/components"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { Check, Loader2, Search } from "lucide-react"
import { useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import type { LabLogEntry } from "@/components/lab/lab-kit"
import {
  LabBadge,
  LabCaveat,
  LabLog,
  LabRow,
  LabSection,
  labLogEntry,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/button")({
  component: LabButtonPage,
})

const SURFACE =
  "rounded-md bg-secondary px-4 py-3 text-sm font-medium text-foreground ring-1 ring-inset ring-border-subtle transition-transform duration-200 ease-out active:scale-95 active:bg-primary/20"

const FILLED =
  "rounded-md bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-transform duration-200 ease-out active:scale-95"

function LabButtonPage() {
  const [log, setLog] = useState<LabLogEntry[]>([])
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)

  const note = (text: string) =>
    setLog((entries) => [labLogEntry(text), ...entries].slice(0, 40))

  function runPending() {
    setPending(true)
    setDone(false)
    note("pending → true (watch the width tween)")
    setTimeout(() => {
      setPending(false)
      setDone(true)
      note("pending → false, trailing check mounted")
    }, 1400)
  }

  return (
    <LabPage
      title="Button"
      subtitle="Pressable's mechanics plus what makes a control a control: a real <button>, keyboard activation, haptics on contact, and slots whose mount/unmount tweens the width instead of snapping it."
    >
      <LabBrief
        what="That Button activates from a finger, a mouse and the keyboard, gives haptic feedback on contact where the platform has any, and animates its width when a slot appears rather than jumping."
        steps={[
          "Lay a finger on the first button and immediately swipe to scroll. The button must NEVER light up — not even for a frame.",
          "Press and hold the first button, drag your finger ~80px away (past its 48px press outset) and release. Nothing must fire.",
          "Press it again and release on it. Exactly one onClick must appear in the log.",
          "Tap it as fast as you physically can. The pressed style must still be visible — it is held for a minimum, so a fast tap is never a sub-frame flicker.",
          "Tab to it and press Space, then Enter. Each must fire exactly once, and the focus ring must be visible.",
          "Press the haptic buttons with a real finger — not a simulator, and not a mouse. Feel for a tick at the moment of CONTACT, not on release.",
          "Press “run a pending cycle” and watch the button's width: the spinner should slide in and the box should GROW smoothly, then shrink back and grow again for the check.",
          "Press the disabled button. Nothing fires, and it must not animate either.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Press, keyboard and width tween all work. Haptics: nothing on desktop (no vibration hardware) and nothing on iOS Safari; on Android Chrome navigator.vibrate fires and you may feel it.",
          },
          pwa: {
            verdict: "partial",
            note: "Same as the browser tab. An installed iOS PWA is the case the invisible <input switch> transducer exists for — a tick there is the only haptic WebKit will give you, and its weight cannot be varied.",
          },
          ios: {
            verdict: "works",
            note: "Everything, including real weighted impacts through the native engine. This is the only target where light/medium/heavy actually differ.",
          },
          android: {
            verdict: "works",
            note: "Everything. The native engine maps the weights onto the OS haptic constants, so the three should feel different — less dramatically than iOS.",
          },
        }}
        wrong="The button flashes its pressed style when you swipe to scroll from it. A press that ends off the button still fires (the release-outside guard is gone, and every mis-tap in the app becomes an action). Space or Enter does nothing while focused, or fires twice. The button's width snaps when a slot mounts instead of tweening. The disabled button animates or fires."
      />

      <LabSection
        title="Press and release"
        description="Activation rides onPress, not a DOM click, so a release outside the region is silently dropped — the same forgiving tracking a native control does. The press region carries a 48px outset, so you have to drag properly clear of it."
      >
        <LabCaveat>
          Drag off and back is a <strong>mouse and stylus</strong> guarantee. With a
          finger on a page that scrolls it is unreachable: the browser claims the
          gesture at its own ~10px slop — well inside the 48px outset — and fires{" "}
          <code>pointercancel</code>, after which the press is over and no JS can take
          it back. Only <code>touch-action: none</code> could, and that would stop you
          scrolling the page whenever a drag happens to start on a button. What is
          guaranteed on touch is the protective half: a gesture the platform turned
          into a scroll never activates, and never leaves the press style stuck on.
        </LabCaveat>
        <Button className={SURFACE} onClick={() => note("onClick")}>
          <Button.Text>press, drag off, release</Button.Text>
        </Button>
        <LabRow
          label="press outset"
          value="48px"
          hint="Bigger than Pressable's default: a thumb on a small control lands off-centre, and adaptv would rather forgive that than drop the tap."
        />
      </LabSection>

      <LabSection
        title="Keyboard"
        description="It is a real <button type='button'>, so Space and Enter both activate it and a screen reader announces it. That is the whole difference from Pressable."
      >
        <Button
          className={SURFACE}
          onClick={() => note("keyboard or pointer activation")}
        >
          <Button.Text>Tab here, then Space and Enter</Button.Text>
        </Button>
      </LabSection>

      <LabSection
        title="haptic"
        description="Fires on press-DOWN — the moment of contact, not the release. Off by default; `true` means light."
      >
        <div className="flex flex-wrap gap-2">
          <Button
            haptic
            className={SURFACE}
            onClick={() => note("haptic (light)")}
          >
            <Button.Text>haptic</Button.Text>
          </Button>
          <Button
            haptic="medium"
            className={SURFACE}
            onClick={() => note("haptic medium")}
          >
            <Button.Text>medium</Button.Text>
          </Button>
          <Button
            haptic="heavy"
            className={SURFACE}
            onClick={() => note("haptic heavy")}
          >
            <Button.Text>heavy</Button.Text>
          </Button>
        </div>
        <LabCaveat>
          A simulator has no Taptic Engine, so this card can only ever be
          verified on real hardware. On iOS <em>web</em> the weight is
          ignored — the system tick is the only haptic WebKit exposes, and
          there is no way to vary it. The prop still takes a weight because
          the other targets honour it.
        </LabCaveat>
      </LabSection>

      <LabSection
        title="Slots and the width tween"
        description="Leading and trailing slots mount and unmount instantly, and the content row tweens its measured width — so a spinner appearing does not make the button snap wider. Put inset spacing on the slot (pe-*), never gap-* on the root: a gap vanishes on unmount and produces a two-step transition."
      >
        <Button className={FILLED} onClick={runPending}>
          <Button.Leading className="pe-2">
            {pending ? (
              <Loader2 size={16} className="animate-spin" aria-hidden />
            ) : done ? (
              <Check size={16} aria-hidden />
            ) : (
              <Search size={16} aria-hidden />
            )}
          </Button.Leading>
          <Button.Text>
            {pending ? "Working…" : done ? "Done" : "run a pending cycle"}
          </Button.Text>
        </Button>
        <LabRow
          label="width mode"
          value="intrinsic (w-fit)"
          hint="A fixed-width button (w-40, w-full) skips the tween and truncates the label instead — that is buttonHasFixedWidth reading the className."
        />
        <Button
          className={`${FILLED} w-full`}
          onClick={() => note("fixed")}
        >
          <Button.Text className="truncate">
            fixed width — the label truncates instead of tweening
          </Button.Text>
        </Button>
      </LabSection>

      <LabSection
        title="Disabled"
        description="Drops every gesture and says so as data-disabled + aria-disabled. The locked class flips to non-clickable, which a className cannot undo."
      >
        <Button
          disabled
          className={`${SURFACE} opacity-40`}
          onClick={() => note("THIS MUST NEVER APPEAR")}
        >
          <Button.Text>disabled</Button.Text>
        </Button>
      </LabSection>

      <LabSection title="Log">
        <LabLog entries={log} />
        <LabRow
          label="styling hooks"
          value={
            <LabBadge tone="warn">
              data-press-engine, data-pressed
            </LabBadge>
          }
          hint="Button carries no data-adaptv='button' — only Image, Pressable and Text stamp that attribute today, so a global `[data-adaptv='button']` rule matches nothing. Reported, not worked around here."
        />
      </LabSection>
    </LabPage>
  )
}

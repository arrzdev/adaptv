import { Fab, Input } from "@arrzdev/adaptv/components"
import { useKeyboard } from "@arrzdev/adaptv/hooks"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { cn } from "@arrzdev/adaptv/utils"
import { Plus } from "lucide-react"
import { useEffect, useState } from "react"
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

export const Route = createFileRoute("/_providers/lab/fab")({
  component: LabFabPage,
})

type Placement = "end" | "center" | "start"

const PLACEMENTS = ["end", "center", "start"] as const

const FIELD_CLASSNAME = cn(
  "block w-full min-w-0 rounded-md bg-surface px-3 py-2 text-base text-foreground ring-1 ring-inset ring-border outline-none",
  "placeholder:text-muted caret-foreground focus:ring-primary",
)

function LabFabPage() {
  const [placement, setPlacement] = useState<Placement>("end")
  const [hidden, setHidden] = useState(false)
  const [avoidKeyboard, setAvoidKeyboard] = useState(true)
  const [rtl, setRtl] = useState(false)
  const [presses, setPresses] = useState(0)
  const [draft, setDraft] = useState("")
  //the page's OWN subscription: the FAB drops its observer when the lift is
  //off, and the publication is refcounted, so without this the <html> rows
  //would go dead in exactly the mode where they explain what went wrong
  const keyboard = useKeyboard()

  return (
    <LabPage
      title="Fab"
      subtitle="A Button pinned to the safe corner of the screen. It owns the three things every hand-rolled floating button gets wrong: the safe-area inset, the keyboard, and the direction of the page."
    >
      <LabBrief
        what="That the one Fab on this page sits a fixed gap off the SAFE edges, rides up to the top of the keyboard, hides below the screen on request, and mirrors to the other corner under RTL — all of it inline style, none of it in your className."
        steps={[
          "Look at the corner. The button must sit the gap (4 spacing units, 16px at the default scale) above the home indicator and in from the side — not glued to the screen edge, and not floating above a phantom inset in a browser tab.",
          "Scroll to the field at the bottom and focus it. The button must rise and stop the same gap above the keyboard's top edge that it had above the home indicator — not inset + gap above it: the keyboard covers the home indicator, so the bottom edge is the larger of the inset and the keyboard height, plus the gap. Watch the bottom row in the readout: it must jump to max(inset, keyboard) + gap in one step, never tween — a keyboard-driven change that animates chases a moving target.",
          "Dismiss the keyboard. The button must land back where it started, and the readout's keyboard row must return to 0px.",
          "Turn the keyboard lift OFF and focus the field again. The button must disappear under the keyboard. This is the bug every consumer ships; the page shows it on purpose so you recognise it.",
          "Press Hide. The button must slide down below the safe edge and be gone from the tab order (data-hidden, aria-hidden, tabindex -1). Press Show: it slides back. Under Reduce Motion both are instant.",
          "Cycle the placements. center must be dead-centre of the screen, start the mirror of end. Then flip RTL with end selected: the button must jump to the LEFT corner, because the offset is inset-inline, not right.",
          "Press it. The counter must increment once per tap, and the haptic must fire on contact where the platform has any.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Desktop: the insets and the keyboard term are both 0, so the button sits exactly gap px from the corner and never moves on focus — correct, there is no on-screen keyboard. A mobile browser: it rises on the inferred keyboard height, which lags the animation by a frame or two.",
          },
          pwa: {
            verdict: "partial",
            note: "Same inference as the mobile browser, but now the bottom inset is real: the button must clear the home indicator at rest and the keyboard on focus, and the two must never add up (the keyboard already covers the safe area, so only the larger term shows).",
          },
          ios: {
            verdict: "works",
            note: "An exact keyboard height from the OS. adaptv suppresses WKWebView's own resize, so the layout viewport does not shrink — the button rises on the variable alone, and its bottom edge lands flush with the keyboard's top edge plus the gap.",
          },
          android: {
            verdict: "works",
            note: "Exact height from the OS, edge-to-edge insets — and the WebView itself shrinks by the keyboard here, so the html variable reads the full height while the lift is 0: the button rides the shrunk viewport's bottom edge and still lands one gap above the keyboard. Check with a keyboard that has a suggestion strip and one without: the button must sit on top of whichever is up.",
          },
        }}
        wrong="The button sits flush against the screen edge in an installed app (the safe inset is missing). It stays put when the keyboard opens with the lift ON, or it rises with the lift OFF. The rise tweens instead of snapping. Hidden leaves it focusable, or it slides up rather than down. RTL leaves it on the right — that means someone wrote `right` instead of `inset-inline-end`. Two presses register from one tap."
      />

      <LabSection
        title="Placement"
        description="Three corners of the same inline axis. end is the default; center swaps the inline offset for a 50% inset plus a translate."
      >
        <LabActions>
          {PLACEMENTS.map((value) => (
            <LabButton
              key={value}
              pressed={placement === value}
              testId={`fab-placement-${value}`}
              onClick={() => setPlacement(value)}
            >
              {value}
            </LabButton>
          ))}
        </LabActions>
        <LabActions>
          <LabButton
            pressed={rtl}
            testId="fab-rtl-toggle"
            onClick={() => setRtl((v) => !v)}
          >
            {rtl ? "RTL on" : "RTL off"}
          </LabButton>
        </LabActions>
        <LabRow
          label="dir on the wrapper"
          value={rtl ? "rtl" : "ltr (inherited)"}
          hint="The FAB is position: fixed, so it takes its direction from its own ancestors, not the viewport. Wrapping it in dir=rtl is enough to mirror it."
        />
      </LabSection>

      <LabSection
        title="Hidden and the keyboard lift"
        description="hidden translates it below the safe edge and takes it out of the tab order. avoidKeyboard is the keyboard term in the bottom offset; off, the button stays where it was and the keyboard covers it."
      >
        <LabActions>
          <LabButton
            pressed={hidden}
            testId="fab-hidden-toggle"
            onClick={() => setHidden((v) => !v)}
          >
            {hidden ? "Show" : "Hide"}
          </LabButton>
          <LabButton
            pressed={!avoidKeyboard}
            testId="fab-avoid-toggle"
            onClick={() => setAvoidKeyboard((v) => !v)}
          >
            {avoidKeyboard ? "Keyboard lift on" : "Keyboard lift off"}
          </LabButton>
        </LabActions>
        <LabCaveat>
          With the lift off the button ends up under the keyboard. That is
          not a mode anyone wants; it is here so the correct behaviour has
          something to be compared against on a device.
        </LabCaveat>
      </LabSection>

      <LabSection
        title="Presses"
        description="Activation is the Button's: onPress, not a DOM click, so a press that scrolls or slides off never counts."
      >
        <LabRow
          label="FAB presses"
          value={<span data-testid="fab-presses">{presses}</span>}
        />
      </LabSection>

      <FabReadout
        placement={placement}
        hidden={hidden}
        avoidKeyboard={avoidKeyboard}
        keyboard={keyboard}
      />

      <LabSection
        title="Raise the keyboard"
        description="The field is deliberately low on the page, with room below it, so the lift is visible next to the readout rather than off-screen."
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Focus me on a device"
          aria-label="FAB test field"
          data-testid="fab-field"
          className={FIELD_CLASSNAME}
        />
      </LabSection>

      {/* room below the field so the page can scroll the field above the
          keyboard while the FAB is still in view over the spacer */}
      <div className="min-h-[60vh]" aria-hidden />

      {/*
       * The wrapper carries `dir`, not the FAB: the component's own props are
       * the thing under test, and RTL in a real app comes from an ancestor —
       * usually <html dir>. The FAB is fixed, so the wrapper adds no box of
       * its own to the flow.
       */}
      <div dir={rtl ? "rtl" : undefined}>
        <Fab
          aria-label="New task"
          data-testid="fab"
          haptic
          placement={placement}
          hidden={hidden}
          avoidKeyboard={avoidKeyboard}
          onClick={() => setPresses((n) => n + 1)}
          className="bg-primary text-primary-foreground"
        >
          <Plus size={24} aria-hidden />
        </Fab>
      </div>
    </LabPage>
  )
}

/* =============================================================================
 * READOUT
 * ============================================================================= */

type FabGeometry = {
  /** The computed longhands, as the browser resolved them. */
  bottom: string
  insetInlineEnd: string
  insetInlineStart: string
  /** The live box against the viewport — what a finger actually finds. */
  gapBottom: number
  gapRight: number
  gapLeft: number
  keyboardOpen: boolean
  placement: string | null
  hidden: boolean
}

type RootKeyboard = {
  variable: string
  open: boolean
}

/**
 * The FAB's geometry and the keyboard contract it is built on, read back
 * off the DOM rather than off React state — the page's flags are the input;
 * this is what the browser did with them.
 *
 * No rAF loop: the FAB only moves when its inline style changes (an
 * attribute mutation on the element), when `<html>` publishes a new
 * keyboard height (an attribute mutation there), or when the viewport
 * itself changes. Two observers and the viewport listeners cover all of it,
 * plus `transitionend` for the hidden slide, whose end state the observers
 * cannot see.
 */
function FabReadout({
  placement,
  hidden,
  avoidKeyboard,
  keyboard,
}: {
  placement: Placement
  hidden: boolean
  avoidKeyboard: boolean
  keyboard: { isOpen: boolean; height: number }
}) {
  const [geometry, setGeometry] = useState<FabGeometry | null>(null)
  const [root, setRoot] = useState<RootKeyboard | null>(null)

  useEffect(() => {
    const html = document.documentElement
    const readRoot = () =>
      setRoot({
        variable: getComputedStyle(html)
          .getPropertyValue("--adaptv-keyboard-height")
          .trim(),
        open: html.hasAttribute("data-keyboard-open"),
      })
    const readFab = () => {
      const fab = document.querySelector<HTMLElement>(
        '[data-adaptv="fab"]',
      )
      if (!fab) {
        setGeometry(null)
        return
      }
      const style = getComputedStyle(fab)
      const box = fab.getBoundingClientRect()
      setGeometry({
        bottom: style.bottom,
        insetInlineEnd: style.insetInlineEnd,
        insetInlineStart: style.insetInlineStart,
        gapBottom: Math.round(window.innerHeight - box.bottom),
        gapRight: Math.round(window.innerWidth - box.right),
        gapLeft: Math.round(box.left),
        keyboardOpen: fab.hasAttribute("data-keyboard-open"),
        placement: fab.getAttribute("data-placement"),
        hidden: fab.hasAttribute("data-hidden"),
      })
    }
    const readAll = () => {
      readRoot()
      readFab()
    }
    readAll()

    const rootObserver = new MutationObserver(readAll)
    rootObserver.observe(html, {
      attributes: true,
      attributeFilter: ["data-keyboard-open", "style"],
    })
    //the FAB re-renders its inline style when a prop changes, and the
    //keyboard hook it calls itself stamps data-keyboard-open on it
    const fab = document.querySelector('[data-adaptv="fab"]')
    const fabObserver = new MutationObserver(readFab)
    if (fab) {
      fabObserver.observe(fab, { attributes: true })
      fab.addEventListener("transitionend", readFab)
    }
    window.addEventListener("resize", readFab)
    const viewport = window.visualViewport
    viewport?.addEventListener("resize", readFab)
    viewport?.addEventListener("scroll", readFab)
    return () => {
      rootObserver.disconnect()
      fabObserver.disconnect()
      fab?.removeEventListener("transitionend", readFab)
      window.removeEventListener("resize", readFab)
      viewport?.removeEventListener("resize", readFab)
      viewport?.removeEventListener("scroll", readFab)
    }
    //the flags are inputs to the FAB's inline style; re-read once React has
    //committed each change, in case the observer fired before layout settled
  }, [placement, hidden, avoidKeyboard])

  return (
    <LabSection
      title="Readout"
      description="Computed off the element and off <html>, not off this page's state. The bottom row must equal max(inset, keyboard) + gap at every moment, and the gap rows are what the finger finds."
    >
      <div data-testid="fab-readout" className="flex flex-col gap-y-3">
        <LabRow
          label="bottom"
          value={geometry?.bottom ?? null}
          hint="calc(max(var(--adaptv-inset-bottom), var(--adaptv-keyboard-height)) + gap), resolved. In a browser tab both variables are 0."
        />
        <LabRow
          label="inset-inline-end"
          value={geometry?.insetInlineEnd ?? null}
        />
        <LabRow
          label="inset-inline-start"
          value={geometry?.insetInlineStart ?? null}
        />
        <LabRow
          label="gap to bottom edge"
          value={geometry ? `${geometry.gapBottom}px` : null}
          hint="Negative while hidden: the box is below the viewport."
        />
        <LabRow
          label="gap to right / left edge"
          value={
            geometry
              ? `${geometry.gapRight}px / ${geometry.gapLeft}px`
              : null
          }
        />
        <LabRow
          label="useKeyboard()"
          value={`${keyboard.isOpen ? "open" : "closed"} · ${keyboard.height}px`}
          hint="The page's own subscription. It must agree with the two <html> rows below at every moment."
        />
        <LabRow
          label="html --adaptv-keyboard-height"
          value={root?.variable ?? null}
        />
        <LabRow
          label="html[data-keyboard-open]"
          value={
            root === null ? null : (
              <LabBadge tone={root.open ? "ok" : "muted"}>
                {root.open ? "present" : "absent"}
              </LabBadge>
            )
          }
        />
        <LabRow
          label="fab[data-keyboard-open]"
          value={
            geometry === null ? null : (
              <LabBadge tone={geometry.keyboardOpen ? "ok" : "muted"}>
                {geometry.keyboardOpen ? "present" : "absent"}
              </LabBadge>
            )
          }
          hint="The FAB calls useKeyboard itself, so the two flags are one value stamped twice. They must never disagree."
        />
        <LabRow
          label="placement · hidden · avoidKeyboard"
          value={
            <>
              <LabBadge tone="ok">
                {geometry?.placement ?? placement}
              </LabBadge>
              <LabBadge tone={hidden ? "warn" : "muted"}>
                {geometry?.hidden ? "hidden" : "shown"}
              </LabBadge>
              <LabBadge tone={avoidKeyboard ? "ok" : "warn"}>
                {avoidKeyboard ? "lift on" : "lift off"}
              </LabBadge>
            </>
          }
        />
      </div>
    </LabSection>
  )
}

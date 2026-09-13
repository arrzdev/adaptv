import { Button, Spinner, Text } from "@arrzdev/adaptv/components"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { useRef, useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabBadge,
  LabButton,
  LabRow,
  LabSection,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute("/_providers/lab/spinner")({
  component: LabSpinnerPage,
})

/** How many spinners sit below the spacer — the size of Quasar's measurement. */
const FIELD_COUNT = 100

/** How long the busy button holds the main thread. */
const BUSY_MS = 1000

/** The text sizes the inline card walks. */
const INLINE_SIZES = [
  ["xs", "text-xs"],
  ["base", "text-base"],
  ["2xl", "text-2xl"],
] as const

/*
 * Every readout on this page is read ON DEMAND, from a button. A readout that
 * polled (an interval, a rAF loop) would be exactly the per-frame work the off-screen
 * pause exists to remove, and the idle measurement in spinner.spec.ts would be
 * measuring the lab instead of the component.
 */

type PlayStates = {
  running: number
  paused: number
  none: number
}

/** The play state of every spinner under `root`, as the engine reports it. */
function playStatesUnder(root: Element | null): PlayStates {
  const states: PlayStates = { running: 0, paused: 0, none: 0 }
  if (!root) return states
  for (const el of root.querySelectorAll('[data-adaptv="spinner"]')) {
    const animation = el.getAnimations()[0]
    if (!animation) states.none += 1
    else if (animation.playState === "paused") states.paused += 1
    else if (animation.playState === "running") states.running += 1
  }
  return states
}

function formatStates(states: PlayStates): string {
  return `${states.running} running · ${states.paused} paused · ${states.none} not animating`
}

function LabSpinnerPage() {
  return (
    <LabPage
      title="Spinner"
      subtitle="An indeterminate activity indicator that pauses off screen, keeps turning while the main thread is busy, and is announced once."
    >
      <LabBrief
        what="the three things Spinner owns: it pauses while off screen (one shared IntersectionObserver → animation-play-state), it rotates an HTML box with a transform keyframe so the compositor keeps it turning through a busy main thread, and a labelled spinner is a progressbar announced once through one shared live region. Plus its reduced-motion form: a slow pulse, never a stop."
        steps={[
          "Watch the spinners in the first card: they turn smoothly, at the size of the text they sit in.",
          "Tap “Busy main thread 1 s”. The page is frozen for a second (the counter under the button does not move) but every spinner on screen KEEPS TURNING through it.",
          "Tap “Read play states” in the field card while it is off screen: the 100 spinners read 0 running · 100 paused. Scroll down until the field is on screen and tap “Read play states” at the bottom of the field: the ones you can see read running.",
          "Tap “Hide” in the hidden card, then “Read”: the hidden spinner reads not animating. “Show” brings it back running.",
          "With a screen reader on, tap “Start loading”: “Loading tasks” is announced ONCE although three labelled spinners mount. Swipe onto one: it is read as a progress indicator named “Loading tasks”. The spinner inside the busy button is not read on its own.",
          "Turn on Reduce Motion (iOS: Settings → Accessibility → Motion; Android: Remove animations) and reload: the spinners stop turning and pulse slowly instead. They must not stand still.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Everything. The off-screen pause, the turn through a busy main thread (composited in Chromium and WebKit) and the single announcement all work in a browser tab.",
          },
          pwa: {
            verdict: "works",
            note: "Same engine as the browser tab, same result.",
          },
          ios: {
            verdict: "works",
            note: "WKWebView: IntersectionObserver is iOS 12.2+, so the pause holds on the iOS 15 floor. VoiceOver reads the labelled spinner as a progress indicator.",
          },
          android: {
            verdict: "works",
            note: "Android WebView is Chromium: same as the browser tab.",
          },
        }}
        wrong="A spinner freezes during the busy second. The off-screen field reads anything but 0 running. A hidden spinner reads running. The screen reader says “Loading tasks” three times, or not at all. Under Reduce Motion a spinner stands still, or still turns."
      />

      <OnScreenProbe />
      <BusyProbe />
      <LabelProbe />
      <HiddenProbe />
      <FieldProbe />

      <LabSection title="Attributes">
        <LabRow
          label="data-adaptv"
          value={<LabBadge tone="ok">spinner</LabBadge>}
          hint="Target every spinner from global CSS with no imports: [data-adaptv='spinner'] { … }"
        />
        <LabRow
          label="data-spinner-offscreen"
          value="present while out of the viewport"
          hint="Written by the shared IntersectionObserver; the stylesheet pauses the animation on it."
        />
      </LabSection>
    </LabPage>
  )
}

/* =============================================================================
 * PROBES
 * ============================================================================= */

function OnScreenProbe() {
  const root = useRef<HTMLDivElement>(null)
  const [readout, setReadout] = useState<string | null>(null)

  function read() {
    const el = root.current?.querySelector(
      '[data-testid="spinner-onscreen"]',
    )
    const animation = el?.getAnimations()[0]
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches
    setReadout(
      animation
        ? `${(animation as CSSAnimation).animationName} · ${animation.playState} · reduced motion ${reduced}`
        : `not animating · reduced motion ${reduced}`,
    )
  }

  return (
    <LabSection
      title="On screen"
      description="Decorative spinners sized by the text they sit in."
    >
      <div ref={root} className="flex flex-col gap-y-2">
        {INLINE_SIZES.map(([name, size]) => (
          <Text key={name} className={`${size} text-foreground`}>
            <Spinner
              data-testid={
                name === "base" ? "spinner-onscreen" : undefined
              }
            />{" "}
            Syncing ({name})
          </Text>
        ))}
        <Text className="text-base text-primary">
          <Spinner className="size-8" /> size-8, text-primary
        </Text>
      </div>
      <LabActions>
        <LabButton onClick={read}>Read animation</LabButton>
      </LabActions>
      <LabRow label="animation" value={readout ?? "tap Read animation"} />
    </LabSection>
  )
}

function BusyProbe() {
  const [ticks, setTicks] = useState(0)
  const [lastBusy, setLastBusy] = useState<string | null>(null)

  function blockMainThread() {
    const start = performance.now()
    //a synchronous loop, not a timer: nothing else on the main thread runs until it
    //returns, which is the situation a spinner is on screen for
    while (performance.now() - start < BUSY_MS) {
      //spin
    }
    setLastBusy(`${Math.round(performance.now() - start)} ms`)
    setTicks((n) => n + 1)
  }

  return (
    <LabSection
      title="Busy main thread"
      description="The spinner beside the button must keep turning while the page is frozen."
    >
      <div className="flex items-center gap-x-3">
        <Spinner data-testid="spinner-busy" className="size-8" />
        <LabActions>
          <LabButton onClick={blockMainThread}>
            Busy main thread 1 s
          </LabButton>
        </LabActions>
      </div>
      <LabRow
        label="blocked for"
        value={lastBusy ?? "not yet"}
        hint={`times pressed: ${ticks}`}
      />
    </LabSection>
  )
}

function LabelProbe() {
  const [loading, setLoading] = useState(false)

  return (
    <LabSection
      title="Label"
      description="Three labelled spinners mount together; the label is announced once. The button's spinner is decorative — the button carries the state."
    >
      <LabActions>
        <LabButton onClick={() => setLoading((on) => !on)}>
          {loading ? "Stop loading" : "Start loading"}
        </LabButton>
      </LabActions>
      <div
        data-testid="spinner-label-host"
        className="flex items-center gap-x-4"
      >
        {loading && (
          <>
            <Spinner
              label="Loading tasks"
              data-testid="spinner-labelled"
              className="size-6"
            />
            <Spinner label="Loading tasks" className="size-6" />
            <Spinner label="Loading tasks" className="size-6" />
          </>
        )}
        <Button
          aria-busy={loading || undefined}
          disabled={loading}
          data-testid="spinner-button"
          className="gap-x-2"
        >
          {loading && <Spinner data-testid="spinner-in-button" />}
          {loading ? "Saving" : "Save"}
        </Button>
      </div>
    </LabSection>
  )
}

function HiddenProbe() {
  const root = useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = useState(false)
  const [readout, setReadout] = useState<string | null>(null)

  return (
    <LabSection
      title="Hidden"
      description="A spinner under a display:none ancestor has no animation to run."
    >
      <LabActions>
        <LabButton onClick={() => setHidden((h) => !h)}>
          {hidden ? "Show" : "Hide"}
        </LabButton>
        <LabButton
          onClick={() =>
            setReadout(formatStates(playStatesUnder(root.current)))
          }
        >
          Read
        </LabButton>
      </LabActions>
      <div ref={root}>
        <div data-testid="spinner-hidden-host" hidden={hidden}>
          <Text className="text-base text-foreground">
            <Spinner data-testid="spinner-hidden" /> hideable
          </Text>
        </div>
      </div>
      <LabRow label="play states" value={readout ?? "tap Read"} />
    </LabSection>
  )
}

function FieldProbe() {
  const root = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(true)
  const [readout, setReadout] = useState<string | null>(null)

  const read = () =>
    setReadout(formatStates(playStatesUnder(root.current)))

  return (
    <LabSection
      title={`${FIELD_COUNT} spinners off screen`}
      description="Below a tall spacer. While they are out of the viewport they must all read paused."
    >
      <LabActions>
        <LabButton onClick={read}>Read play states</LabButton>
        <LabButton onClick={() => setMounted((m) => !m)}>
          {mounted ? "Unmount the field" : "Mount the field"}
        </LabButton>
      </LabActions>
      <LabRow
        label="play states"
        value={readout ?? "tap Read play states"}
      />
      <div ref={root} data-testid="spinner-field-host">
        {/* tall enough to push the field off any phone or desktop viewport */}
        <div className="h-[300vh]" aria-hidden="true" />
        {mounted && (
          <div
            data-testid="spinner-field"
            className="grid grid-cols-10 gap-2 text-foreground"
          >
            {Array.from({ length: FIELD_COUNT }, (_, i) => (
              //the list is static and never reordered
              <Spinner key={i} className="size-5" />
            ))}
          </div>
        )}
      </div>
      <LabActions>
        <LabButton onClick={read}>Read play states</LabButton>
      </LabActions>
    </LabSection>
  )
}

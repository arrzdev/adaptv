import { ProgressBar, Text } from "adaptv/components"
import { createFileRoute } from "adaptv/router"
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

export const Route = createFileRoute("/_providers/lab/progress-bar")({
  component: LabProgressBarPage,
})

/** How many indeterminate bars sit below the spacer — Spinner's field size. */
const FIELD_COUNT = 100
//the field is static and never reordered, so its ids are its positions
const FIELD = Array.from({ length: FIELD_COUNT }, (_, i) => `cell-${i}`)

/** How long the busy button holds the main thread. */
const BUSY_MS = 1000

/** The values the determinate card offers, the out-of-range ones included. */
const VALUES: Array<[string, number | undefined]> = [
  ["No value", undefined],
  ["0", 0],
  ["25 %", 0.25],
  ["60 %", 0.6],
  ["100 %", 1],
  ["−0.5", -0.5],
  ["1.5", 1.5],
  ["NaN", Number.NaN],
]

/*
 * Every readout is read ON DEMAND, from a button: a polling readout would be the
 * per-frame work the off-screen pause removes, and a text that changed with the value
 * would lay out the page in the middle of the fill's transition, which
 * progress-bar.spec.ts measures.
 */

type PlayStates = { running: number; paused: number; none: number }

/** The play state of every bar's indicator under `root`, as the engine reports it. */
function playStatesUnder(root: Element | null): PlayStates {
  const states: PlayStates = { running: 0, paused: 0, none: 0 }
  if (!root) return states
  for (const el of root.querySelectorAll('[data-adaptv="progress-bar"]')) {
    const animation = el.getAnimations({ subtree: true })[0]
    if (!animation) states.none += 1
    else if (animation.playState === "paused") states.paused += 1
    else if (animation.playState === "running") states.running += 1
  }
  return states
}

function LabProgressBarPage() {
  return (
    <LabPage
      title="ProgressBar"
      subtitle="Determinate or indeterminate. Moves by transform only, pauses off screen, fills from the right in RTL and survives forced colors."
    >
      <LabBrief
        what="the four things ProgressBar owns: the fill is scaleX and the sweep translateX (no layout per frame), an off-screen indeterminate bar pauses through Spinner's shared observer, RTL fills from the right, and forced colors keep the fill visible. Reduced motion: a pulse, never a stop."
        steps={[
          "Tap the values in the first card: the bar eases to each one. −0.5 reads 0 %, 1.5 reads 100 %, and No value or NaN turn it into a sweep.",
          "Tap “Start loading”: a labelled sweep appears. Tap “Busy main thread 1 s”: the sweep keeps moving while the page is frozen.",
          'In the RTL card, tap “Show the RTL sweeps”: under dir="rtl" the bar fills from the right and the sweep travels right to left. In every row the sweep enters from the side the fill grows from, crosses the whole track and leaves by the other side.',
          "Tap “Read play states” at the top of the field card: 0 running · 100 paused. Scroll to the field and tap the button below it: running.",
          "Turn on Reduce Motion and reload: the sweep becomes a full-width pulse, and values jump instead of easing.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Everything. Chromium's trace shows the fill and the sweep composited; forced colors can be emulated in Chromium devtools.",
          },
          pwa: {
            verdict: "works",
            note: "Same engine as the browser tab, same result.",
          },
          ios: {
            verdict: "works",
            note: "WKWebView: IntersectionObserver is iOS 12.2+, so the pause holds on the iOS 15 floor.",
          },
          android: {
            verdict: "works",
            note: "Android WebView is Chromium: same as the browser tab.",
          },
        }}
        wrong="The bar fills from the left in the RTL card. A value outside 0–1 draws past the track. The sweep freezes during the busy second. The off-screen field reads anything but 0 running. Under Reduce Motion the sweep still travels, or stands still."
      />

      <DeterminateProbe />
      <IndeterminateProbe />
      <RtlProbe />
      <FieldProbe />

      <LabSection title="Attributes">
        <LabRow
          label="data-adaptv"
          value={<LabBadge tone="ok">progress-bar</LabBadge>}
          hint="Target every bar from global CSS: [data-adaptv='progress-bar'] > [data-part='indicator'] { … }"
        />
        <LabRow
          label="data-progress-bar-indeterminate"
          value="present with no known value"
        />
        <LabRow
          label="data-progress-bar-offscreen"
          value="present while an indeterminate bar is out of the viewport"
        />
      </LabSection>
    </LabPage>
  )
}

/* =============================================================================
 * PROBES
 * ============================================================================= */

function DeterminateProbe() {
  const root = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState<number | undefined>(0.25)
  const [readout, setReadout] = useState<string | null>(null)

  function read() {
    const el = root.current?.querySelector('[data-adaptv="progress-bar"]')
    if (!(el instanceof HTMLElement)) return
    setReadout(
      el.hasAttribute("data-progress-bar-indeterminate")
        ? "indeterminate · no aria-valuenow"
        : `aria-valuenow ${el.getAttribute("aria-valuenow")} · --progress-value ${el.style.getPropertyValue("--progress-value")}`,
    )
  }

  return (
    <LabSection
      title="Determinate"
      description="A value from 0 to 1, clamped. No value, or one that is not a number, is indeterminate."
    >
      <div ref={root}>
        <ProgressBar
          data-testid="progress-determinate"
          value={value}
          label="Uploading photo"
          className="h-2 text-primary"
        />
      </div>
      <LabActions>
        {VALUES.map(([name, next]) => (
          <LabButton key={name} onClick={() => setValue(next)}>
            {name}
          </LabButton>
        ))}
      </LabActions>
      <LabActions>
        <LabButton onClick={read}>Read</LabButton>
      </LabActions>
      <LabRow label="exposed" value={readout ?? "tap Read"} />
    </LabSection>
  )
}

function IndeterminateProbe() {
  const [loading, setLoading] = useState(false)
  const [lastBusy, setLastBusy] = useState<string | null>(null)

  function blockMainThread() {
    const start = performance.now()
    //a synchronous loop: nothing else on the main thread runs until it returns
    while (performance.now() - start < BUSY_MS) {
      //spin
    }
    setLastBusy(`${Math.round(performance.now() - start)} ms`)
  }

  return (
    <LabSection
      title="Indeterminate"
      description="Mounted on demand, so a page left at the top has nothing running."
    >
      <LabActions>
        <LabButton onClick={() => setLoading((on) => !on)}>
          {loading ? "Stop loading" : "Start loading"}
        </LabButton>
        <LabButton onClick={blockMainThread}>
          Busy main thread 1 s
        </LabButton>
      </LabActions>
      {loading && (
        <ProgressBar
          data-testid="progress-indeterminate"
          label="Loading tasks"
          className="h-2 text-primary"
        />
      )}
      <LabRow label="blocked for" value={lastBusy ?? "not yet"} />
    </LabSection>
  )
}

function RtlProbe() {
  const [sweep, setSweep] = useState(false)

  return (
    <LabSection
      title="RTL"
      description="Direction comes from a dir='rtl' attribute on the bar or an ancestor. Under one, the fill grows from the right and the sweep travels leftwards. A dir='ltr' island inside it still reads RTL, and CSS direction without the attribute reads LTR, but in every case the fill and the sweep agree and the sweep stays on the track."
    >
      <div dir="rtl" className="flex flex-col gap-y-3">
        <Text className="text-sm text-foreground">٢٥٪ · dir="rtl"</Text>
        <ProgressBar
          data-testid="progress-rtl-determinate"
          value={0.25}
          className="h-2 text-primary"
        />
        {sweep && (
          <ProgressBar
            data-testid="progress-rtl-indeterminate"
            className="h-2 text-primary"
          />
        )}
        <div dir="ltr" className="flex flex-col gap-y-3">
          <Text className="text-sm text-foreground">
            25 % · a dir="ltr" island inside dir="rtl"
          </Text>
          <ProgressBar
            data-testid="progress-island-determinate"
            value={0.25}
            className="h-2 text-primary"
          />
          {sweep && (
            <ProgressBar
              data-testid="progress-island-indeterminate"
              className="h-2 text-primary"
            />
          )}
        </div>
      </div>
      <div style={{ direction: "rtl" }} className="flex flex-col gap-y-3">
        <Text className="text-sm text-foreground">
          25 % · CSS direction: rtl, no attribute
        </Text>
        <ProgressBar
          data-testid="progress-cssdir-determinate"
          value={0.25}
          className="h-2 text-primary"
        />
        {sweep && (
          <ProgressBar
            data-testid="progress-cssdir-indeterminate"
            className="h-2 text-primary"
          />
        )}
      </div>
      <LabActions>
        <LabButton onClick={() => setSweep((on) => !on)}>
          {sweep ? "Hide the RTL sweeps" : "Show the RTL sweeps"}
        </LabButton>
      </LabActions>
    </LabSection>
  )
}

function FieldProbe() {
  const root = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(true)
  const [readout, setReadout] = useState<string | null>(null)

  function read() {
    const states = playStatesUnder(root.current)
    setReadout(
      `${states.running} running · ${states.paused} paused · ${states.none} not animating`,
    )
  }

  return (
    <LabSection
      title={`${FIELD_COUNT} bars off screen`}
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
      <div ref={root}>
        {/* tall enough to push the field off any phone or desktop viewport */}
        <div className="h-[300vh]" aria-hidden="true" />
        {mounted && (
          <div
            data-testid="progress-field"
            className="grid grid-cols-5 gap-2 text-foreground"
          >
            {FIELD.map((id) => (
              <ProgressBar key={id} />
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

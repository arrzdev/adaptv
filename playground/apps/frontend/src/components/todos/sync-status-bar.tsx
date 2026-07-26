import { useEffect, useRef, useState } from "react"
import { useSyncStatus } from "@/hooks/use-sync-status"

//oscilloscope sync indicator on <canvas>. it means exactly ONE thing: a sync is
//actively running. the line sweeps in left→right *already waving* (an
//oscilloscope trace drawing itself). once the waves appear they ALWAYS stay for
//at least MIN_WAVE_MS — independent of why they appeared or how the run ends —
//so the indicator never flickers. after that minimum they resolve by the phase:
//success collapses every wave to a straight line at once and fades away;
//offline/error cut straight to their text label. nothing is drawn at rest.
//
//the non-syncing states are quiet muted TEXT labels in the same slot, no lines:
//  synced  → nothing
//  offline → "Offline (n)" — no network, we wait for reconnect
//  error   → "Unsynced (n)" — online but the backend is unreachable, retrying
//(rendered in the JSX below). the controller reports offline the instant the
//network drops, so the waves never even START while offline — they only show if
//a run was genuinely in flight, then resolve to the label after the min-hold.
//
//motion grammar: entrances decelerate (ease-out), the success collapse uses a
//sine ease and drops every wave together, the idle retract accelerates
//(ease-in). every stage ends at zero velocity so steps flow with no kink; the
//row reserves its height so nothing ever shifts.

const HEIGHT = 11 //css px (kept short)
const MAX_AMP = 2.4 //wave half-height in px (kept shallow)
//a light → brand → deep sweep of orange shades, drawn as a gradient along the
//line. constant now — the indicator only ever means "syncing".
const ORANGE_STOPS: [number, number, number][] = [
  [247, 165, 104], //light  #F7A568
  [240, 125, 61], //brand  #F07D3D
  [211, 88, 34], //deep   #D35822
]
const ORANGE_CSS = ORANGE_STOPS.map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`)

const SCROLL_PXPS = 16 //wave drift speed at full amplitude
const WAVE_K = (2 * Math.PI) / 14 //wavenumber: wave period 14px

//stage durations (ms)
const GROW_MS = 380 //the line sweeps in (already waving)
//once waves appear they ALWAYS show for at least this long before resolving, so
//a fast or spurious run can never flicker — independent of why it appeared
const MIN_WAVE_MS = 1400
//success exit: the waves morph to a straight line in place, then the line fades
//out — the fade is offset so the flatten reads clearly before it goes
const EXIT_MORPH_MS = 360 //waves → straight line
const EXIT_FADE_DELAY = 220 //let the line form before the fade begins
const EXIT_FADE_MS = 360 //the straight line fades to nothing

type Intent = "active" | "idle"
type Stage = "idle" | "grow" | "wave" | "exit"

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

//symmetric smoothstep — used for the success fade and the reduced-motion breath
function smooth(t: number): number {
  const c = clamp01(t)
  return c * c * (3 - 2 * c)
}

//ease-out cubic — a confident, decelerating entrance (grow)
function easeOut(t: number): number {
  const c = clamp01(t)
  return 1 - (1 - c) ** 3
}

//ease-in-out sine — the buttery swell for the success amplitude collapse
function easeInOut(t: number): number {
  return -(Math.cos(Math.PI * clamp01(t)) - 1) / 2
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

export function SyncStatusBar() {
  const { phase, unsynced } = useSyncStatus()
  //true while the canvas is drawing the wave line (its whole life: grow → wave →
  //exit). the offline/error text is gated on this being FALSE, so the waves and
  //a text label can never render together — only ever one of them at a time.
  const [wavesVisible, setWavesVisible] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const startRef = useRef<() => void>(() => {})

  //one-time canvas setup; the live phase is read through phaseRef in the loop
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return
    const cv = canvas
    const cx = ctx
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches

    const st = {
      stage: "idle" as Stage,
      at: 0, //performance.now when the current stage began
      activeAt: 0, //when the active display (grow) began — anchors MIN_WAVE_MS
      reveal: 0, //0 absent → 1 full width
      fill: 0, //0 flat line → 1 waving (gated off for reduced-motion)
      scroll: 0,
      fade: 0, //0 visible → 1 faded out (the success exit)
      amp: 1, //uniform height scale; the exit drops every wave at once
      //captured at each stage start so tweens run from the live value
      fromReveal: 0,
      fromFill: 0,
    }
    let raf = 0
    let running = false
    let last = 0

    //cached CSS width — avoids a layout-flushing clientWidth read every frame.
    //setting cv.width resets the 2D context, so the static stroke style is
    //(re)applied here rather than every frame.
    let cssW = 0
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      cssW = cv.clientWidth
      cv.width = Math.round(cssW * dpr)
      cv.height = Math.round(HEIGHT * dpr)
      cx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cx.lineWidth = 2
      cx.lineCap = "round"
      cx.lineJoin = "round"
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(cv)

    function setStage(stage: Stage, now: number) {
      st.stage = stage
      st.at = now
      st.fromReveal = st.reveal
      st.fromFill = st.fill
    }

    //collapse to the resting idle state, resetting the transient channels so the
    //next entrance animates from clean values. the loop then pauses at idle.
    function toIdle(now: number) {
      st.reveal = 0
      st.fill = 0
      st.amp = 1
      st.fade = 0
      setStage("idle", now)
      setWavesVisible(false) //canvas is blank now → a text label may show
    }

    function intentOf(): Intent {
      const p = phaseRef.current
      return p === "syncing" || p === "pending" ? "active" : "idle"
    }

    function loop(now: number) {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      const intent = intentOf()

      //an active run (syncing|pending) starts the wave display. once it starts
      //we COMMIT to showing it for >= MIN_WAVE_MS, so a fast or spurious run can
      //never flicker — it always plays out, then resolves to the phase below.
      if (st.stage === "idle" && intent === "active") {
        setStage("grow", now)
        st.activeAt = now
        setWavesVisible(true) //waves are on screen → any text label is hidden
      }

      const el = now - st.at
      switch (st.stage) {
        case "grow":
          //sweeps in left→right, already waving (reduced-motion cross-fades in
          //via opacity instead — handled in the draw). always advances to wave,
          //even if the run already ended, so the minimum display is honoured.
          st.fill = reduce ? 0 : 1
          st.reveal = reduce
            ? 1
            : lerp(st.fromReveal, 1, easeOut(el / GROW_MS))
          if (el >= GROW_MS) setStage("wave", now)
          break
        case "wave":
          st.reveal = 1
          st.fill = reduce ? 0 : 1
          //hold until the run is done AND the waves have shown their minimum,
          //then resolve by the phase NOW: success collapses + fades (exit);
          //offline/error cut straight to their text label. this min-hold is the
          //whole anti-flicker guarantee, independent of why the waves appeared.
          if (intent !== "active" && now - st.activeAt >= MIN_WAVE_MS) {
            const p = phaseRef.current
            if (p === "offline" || p === "error") toIdle(now)
            else setStage("exit", now)
          }
          break
        case "exit":
          //success: every wave drops to a straight line at once (a uniform
          //amplitude collapse, not a directional wash), then the line fades
          //out. the fade is offset so the flatten reads before it goes (the
          //width never retracts).
          st.reveal = 1
          st.fill = reduce ? 0 : 1
          st.amp = reduce ? 0 : 1 - easeInOut(el / EXIT_MORPH_MS)
          st.fade = smooth((el - EXIT_FADE_DELAY) / EXIT_FADE_MS)
          if (el >= EXIT_FADE_DELAY + EXIT_FADE_MS) toIdle(now)
          break
        case "idle":
          //resting: nothing drawn (the clearRect below wipes the canvas)
          st.reveal = 0
          st.fill = 0
          break
      }

      //scroll ramps with the visible wave amplitude, so the drift eases in/out
      //(and decelerates as the exit collapse flattens it)
      if (!reduce) st.scroll += dt * SCROLL_PXPS * st.fill * st.amp

      const mid = HEIGHT / 2
      cx.clearRect(0, 0, cssW, HEIGHT)

      const drawW = st.reveal * cssW
      if (drawW > 0.5 && cssW > 0) {
        //uniform wave amplitude; `fill` gates it off for reduced-motion, `amp`
        //collapses it to flat on the success exit
        const peak = MAX_AMP * st.amp * st.fill
        cx.beginPath()
        let started = false
        for (let x = 0; x <= drawW; x += 1) {
          const y = mid + peak * Math.sin((x + st.scroll) * WAVE_K)
          if (started) cx.lineTo(x, y)
          else {
            cx.moveTo(x, y)
            started = true
          }
        }
        cx.lineTo(
          drawW,
          mid + peak * Math.sin((drawW + st.scroll) * WAVE_K),
        )

        //orange-shade gradient along the line (constant — never tints)
        const grad = cx.createLinearGradient(0, 0, drawW, 0)
        for (let i = 0; i < ORANGE_CSS.length; i++) {
          grad.addColorStop(i / (ORANGE_CSS.length - 1), ORANGE_CSS[i])
        }
        //fade out entirely during the success exit
        let alpha = 1 - st.fade
        if (reduce) {
          //motion-free fallback: cross-fade the line in/out and breathe its
          //opacity gently while working, instead of any positional motion
          const breath =
            0.6 + 0.4 * (0.5 + 0.5 * Math.cos((now / 1500) * 2 * Math.PI))
          if (st.stage === "grow") alpha *= breath * smooth(el / GROW_MS)
          else alpha *= breath
        }
        cx.globalAlpha = alpha
        cx.strokeStyle = grad
        cx.stroke()
        cx.globalAlpha = 1
      }

      //idle is the only static state — pause until the [phase] effect resumes us
      if (st.stage === "idle") {
        running = false
        return
      }
      raf = requestAnimationFrame(loop)
    }

    function start() {
      if (running) return
      running = true
      last = performance.now()
      raf = requestAnimationFrame(loop)
    }
    startRef.current = start
    start()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: phase is an intentional trigger to resume the paused loop
  useEffect(() => {
    startRef.current()
  }, [phase])

  //the canvas is absolutely positioned inside a fixed-height wrapper so its
  //300×150 intrinsic size can never drive flex layout. the wrapper stretches to
  //the button-group width above it. offline/error render no line — just a quiet
  //right-aligned text label in the same slot.
  return (
    <div
      className="relative w-full self-stretch"
      style={{ height: HEIGHT }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden
        className="absolute inset-0 block size-full"
      />
      {(phase === "offline" || phase === "error") && !wavesVisible && (
        <span
          aria-live="polite"
          className="absolute inset-y-0 right-0 flex items-center whitespace-nowrap text-[10px] font-medium leading-none text-muted tabular-nums"
        >
          {phase === "offline" ? "Offline" : "Unsynced"}
          {unsynced > 0 ? ` (${unsynced})` : ""}
        </span>
      )}
    </div>
  )
}

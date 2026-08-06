/**
 * Dev-only frame-rate telemetry for the drawer's animations. Read-only, OFF by default, and zero
 * cost unless armed — nothing here allocates or schedules a frame until you turn it on.
 *
 * The drawer animates its height and translate on COMPOSITED transforms specifically to hold 60fps
 * (see the FLIP notes in `drawer-engine`: animating `max-height` reflowed the whole sheet every
 * frame and measured 23-28fps; a transform costs the main thread nothing). This measures whether it
 * actually does, per environment — a composited animation keeps `requestAnimationFrame` ticking at
 * the display's rate even under main-thread load; a reflow-per-frame one starves it, and the dropped
 * frames show up here.
 *
 *   Arm:   window.__adaptvDrawerFpsOn = true       // or localStorage['adaptv:drawer-fps'] = '1'
 *   Read:  window.__adaptvDrawerFps                 // the last sample
 *          window.__adaptvDrawerFpsLog              // the recent samples (most recent last)
 *          window.__adaptvDrawerFpsDump()           // a one-line-per-sample console table
 *
 * A "sample" is one panel animation (open, close, keyboard grow/shrink, drag settle) — the engine
 * brackets each with `beginPanelAnimation`/`endPanelAnimation`, which is where start/stop are wired.
 */

export type DrawerFpsSample = {
  /** What was animating: "open" | "close" | "keyboard" | "drawer" (generic). */
  label: string
  /** Wall-clock length of the animation, ms. */
  durationMs: number
  /** Frames actually painted during it. */
  frames: number
  /** frames / duration, rounded. The number to compare against the display's refresh rate. */
  fps: number
  /** Frames whose gap ran longer than 1.5 ideal frames — a visible hitch. */
  droppedFrames: number
  /** The single longest inter-frame gap, ms — the worst hitch in the run. */
  worstFrameMs: number
}

const IDEAL_FRAME_MS = 1000 / 60
// A gap longer than 1.5 ideal frames means at least one frame was skipped — the same accounting the
// /lab/drawer-keyboard conformance harness uses, so numbers from the two line up.
const DROP_THRESHOLD_MS = IDEAL_FRAME_MS * 1.5
const LOG_CAP = 30

/**
 * Reduce a run's inter-frame gaps (ms between consecutive painted frames) to an fps verdict. Pure,
 * so the accounting is unit-testable without a real animation frame.
 */
export function summarizeFrameGaps(
  label: string,
  gaps: number[],
): DrawerFpsSample {
  const durationMs = gaps.reduce((sum, gap) => sum + gap, 0)
  const frames = gaps.length
  return {
    label,
    durationMs: Math.round(durationMs),
    frames,
    fps: durationMs > 0 ? Math.round((frames / durationMs) * 1000) : 0,
    droppedFrames: gaps.filter((gap) => gap > DROP_THRESHOLD_MS).length,
    worstFrameMs: Math.round(
      gaps.reduce((max, gap) => Math.max(max, gap), 0),
    ),
  }
}

//---- Runtime harness (dev-only, off by default) ----------------

const ARM_KEY = "__adaptvDrawerFpsOn"
const RESULT_KEY = "__adaptvDrawerFps"
const LOG_KEY = "__adaptvDrawerFpsLog"
const DUMP_KEY = "__adaptvDrawerFpsDump"
const STORAGE_KEY = "adaptv:drawer-fps"

type FpsHost = {
  [ARM_KEY]?: boolean
  [RESULT_KEY]?: DrawerFpsSample
  [LOG_KEY]?: DrawerFpsSample[]
  [DUMP_KEY]?: () => DrawerFpsSample[]
}

function fpsHost(): FpsHost | null {
  return typeof window === "undefined"
    ? null
    : (window as unknown as FpsHost)
}

function isArmed(host: FpsHost): boolean {
  if (host[ARM_KEY]) return true
  try {
    return window.localStorage?.getItem(STORAGE_KEY) === "1"
  } catch {
    //localStorage can throw in private mode / sandboxed frames — treat as unarmed
    return false
  }
}

type ActiveSample = {
  label: string
  gaps: number[]
  last: number
  raf: number
}

let active: ActiveSample | null = null

/**
 * Begin timing a panel animation — no-op unless armed. If a sample is already running, this is an
 * INTERRUPT (a keyboard grow cutting into an open, a reopen mid-close): finalize the old one first,
 * then start fresh. The interrupted animation's `endPanelAnimation` never fires (its run id is
 * stale), so without this the old sample would leak `active` forever and silently swallow every
 * sample after the first interrupt.
 */
export function startDrawerFpsSample(label: string): void {
  const host = fpsHost()
  if (!host || !isArmed(host)) return
  if (active) stopDrawerFpsSample()

  const sample: ActiveSample = {
    label,
    gaps: [],
    last: performance.now(),
    raf: 0,
  }
  const tick = (now: number) => {
    sample.gaps.push(now - sample.last)
    sample.last = now
    sample.raf = requestAnimationFrame(tick)
  }
  sample.raf = requestAnimationFrame(tick)
  active = sample
}

/** End the active sample, compute the verdict, and publish it on `window`. */
export function stopDrawerFpsSample(): void {
  const host = fpsHost()
  if (!host || !active) return

  cancelAnimationFrame(active.raf)
  // Drop the first gap: it spans sample-start → first rAF, which carries scheduling latency rather
  // than a real painted frame, and would drag the average down on an otherwise smooth run.
  const result = summarizeFrameGaps(active.label, active.gaps.slice(1))
  active = null

  host[RESULT_KEY] = result

  const log = host[LOG_KEY] ?? []
  log.push(result)
  if (log.length > LOG_CAP) log.shift()
  host[LOG_KEY] = log

  if (!host[DUMP_KEY]) {
    host[DUMP_KEY] = () => {
      const rows = host[LOG_KEY] ?? []
      console.table(rows)
      return rows
    }
  }
}

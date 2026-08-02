import { measureDrawerContentNaturalHeight } from "#adaptv/components/drawer/drawer-keyboard"

// Drawer keyboard telemetry — a read-only frame-by-frame recorder for the content box's
// geometry across a keyboard open/close, so the "over-shrink then snap on dismiss" can be
// read off a timeline instead of guessed at. It measures; it never writes, so it cannot
// perturb the animation it observes.
//
// OFF by default and zero-cost: the per-frame sampler only runs when armed. Arm it with
// `window.__adaptvDrawerTeleOn = true` (or `localStorage['adaptv:drawer-tele'] = '1'`),
// reproduce, then read `window.__adaptvDrawerTele` (a flat array of samples) — over CDP or
// in devtools. `window.__adaptvDrawerTeleDump()` prints a compact table and the min box
// height seen per phase, which is where the over-shrink shows up.

export type DrawerTeleSample = {
  /** ms since this capture started */
  t: number
  /** "open" | "close" — the keyboard transition this frame belongs to */
  phase: string
  kbOpen: boolean
  kbHeight: number
  innerH: number
  vvH: number | null
  /** the live rendered box height — the number the user watches move */
  boxH: number
  /** engine-owned inline overrides while a keyboard episode is in flight */
  styleMaxH: string
  styleMinH: string
  stylePadB: string
  /** what the box's max-height actually resolves to this frame */
  computedMaxH: string
  /** the box's own content height, recomputed the way the engine measures it */
  natural: number
}

declare global {
  interface Window {
    __adaptvDrawerTeleOn?: boolean
    __adaptvDrawerTele?: DrawerTeleSample[]
    __adaptvDrawerTeleDump?: () => DrawerTeleSample[]
  }
}

function isArmed(): boolean {
  if (typeof window === "undefined") return false
  if (window.__adaptvDrawerTeleOn === true) return true
  try {
    return window.localStorage?.getItem("adaptv:drawer-tele") === "1"
  } catch {
    return false
  }
}

function buffer(): DrawerTeleSample[] {
  if (!window.__adaptvDrawerTele) window.__adaptvDrawerTele = []
  if (!window.__adaptvDrawerTeleDump) {
    window.__adaptvDrawerTeleDump = () => {
      const rows = window.__adaptvDrawerTele ?? []
      console.table(
        rows.map((r) => ({
          t: r.t,
          phase: r.phase,
          kb: r.kbOpen ? r.kbHeight : 0,
          boxH: r.boxH,
          natural: r.natural,
          maxH: r.styleMaxH,
          minH: r.styleMinH,
          padB: r.stylePadB,
          innerH: r.innerH,
        })),
      )
      for (const phase of ["open", "close"]) {
        const hs = rows.filter((r) => r.phase === phase).map((r) => r.boxH)
        if (hs.length)
          console.log(
            `[drawer-tele] ${phase}: boxH min=${Math.min(...hs)} max=${Math.max(...hs)} last=${hs[hs.length - 1]}`,
          )
      }
      return rows
    }
  }
  return window.__adaptvDrawerTele
}

/**
 * Sample the content box every frame for `durationMs`, tagged with `phase`. Returns a stop
 * function (call on cleanup). No-op unless armed. Read-only.
 */
export function captureDrawerKeyboardTransition(opts: {
  content: HTMLElement | null
  scroller: HTMLElement | null
  getKeyboard: () => { isOpen: boolean; height: number }
  phase: string
  durationMs?: number
}): () => void {
  const { content, scroller, getKeyboard, phase, durationMs = 1500 } = opts
  if (!isArmed() || !content) return () => {}
  const log = buffer()
  const start = performance.now()
  let stopped = false
  let raf = 0

  const tick = () => {
    if (stopped || !content.isConnected) return
    const now = performance.now()
    const kb = getKeyboard()
    log.push({
      t: Math.round(now - start),
      phase,
      kbOpen: kb.isOpen,
      kbHeight: Math.round(kb.height),
      innerH: window.innerHeight,
      vvH: window.visualViewport
        ? Math.round(window.visualViewport.height)
        : null,
      boxH: Math.round(content.getBoundingClientRect().height),
      styleMaxH: content.style.maxHeight || "(unset)",
      styleMinH: content.style.minHeight || "(unset)",
      stylePadB: content.style.paddingBottom || "(unset)",
      computedMaxH: getComputedStyle(content).maxHeight,
      natural: Math.round(
        measureDrawerContentNaturalHeight(content, scroller, 0),
      ),
    })
    if (now - start >= durationMs) {
      stopped = true
      return
    }
    raf = requestAnimationFrame(tick)
  }

  raf = requestAnimationFrame(tick)
  return () => {
    stopped = true
    cancelAnimationFrame(raf)
  }
}

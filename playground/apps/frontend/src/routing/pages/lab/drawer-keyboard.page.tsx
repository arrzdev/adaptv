import { createFileRoute } from "@arrzdev/adaptv/router"
import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { LabButton, LabSection } from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"
import { AppDrawer } from "@/components/ui"

export const Route = createFileRoute("/_providers/lab/drawer-keyboard")({
  component: LabDrawerKeyboardPage,
})

/*
 * The drawer-vs-keyboard conformance harness.
 *
 * A real software keyboard cannot be scripted — simulators don't raise one for an automated run,
 * and no web API lets a page synthesise `visualViewport` geometry. So this page drives adaptv's
 * keyboard observer through its test seam (`window.__adaptvKeyboardMock`) and paints a solid
 * block of the same height over the bottom of the screen: from the sheet's point of view that IS
 * the keyboard, and it has to be avoided exactly the same way.
 *
 * The page then asserts what a UIKit sheet guarantees, and renders the verdict — so ONE
 * screenshot is the whole report on web, iOS and Android alike, and browser automation can read
 * `window.__drawerConformance` instead.
 */

const KEYBOARD_MOCK_EVENT = "adaptv:keyboard-mock"
const KEYBOARD_COLOR = "#7c3aed"

function setMockKeyboard(height: number) {
  const host = window as unknown as {
    __adaptvKeyboardMock?: { isOpen: boolean; height: number }
  }
  host.__adaptvKeyboardMock = { isOpen: height > 0, height }
  window.dispatchEvent(new Event(KEYBOARD_MOCK_EVENT))
}

type Sample = {
  t: number
  top: number
  bottom: number
  height: number
  /** distance from the content's bottom edge to the keyboard's painted top edge */
  gap: number
}
type Check = { name: string; pass: boolean; detail: string }
/** `samples` is the geometry series the checks were read from, so a reader over CDP can see the
 *  shape of a motion and not only its endpoints. */
type StepResult = {
  step: string
  checks: Check[]
  perf?: string
  samples: Sample[]
}

/** Frame intervals in ms, in order — the only thing that can tell smooth from janky. */
type Trace = { samples: Sample[]; frames: number[] }

const SETTLE_MS = 700
const FRAME_TOLERANCE = 2

function sampleGeometry(content: HTMLElement, startedAt: number): Sample {
  const rect = content.getBoundingClientRect()
  const room =
    Number.parseFloat(getComputedStyle(content).paddingBottom) || 0
  const fake = document.querySelector<HTMLElement>(
    '[data-testid="fake-keyboard"]',
  )
  const keyboardTop = fake
    ? fake.getBoundingClientRect().top
    : window.innerHeight
  const bottom = Math.round(rect.bottom - room)
  return {
    t: Math.round(performance.now() - startedAt),
    top: Math.round(rect.top),
    //the content's own bottom — what the user can actually reach, excluding held room
    bottom,
    height: Math.round(rect.height),
    gap: Math.round(bottom - Math.min(keyboardTop, window.innerHeight)),
  }
}

/*
 * Sampled on a timer, NOT on `requestAnimationFrame`: a browser pane that is open but not
 * on screen reports `document.hidden`, and a hidden document never fires rAF — the run simply
 * hangs. A timer keeps ticking, so the harness always terminates and can say so. (It cannot
 * fix the deeper problem: a hidden document also freezes its animation timeline, so the
 * *motion* checks are only meaningful where the page is actually rendering. `hidden` is
 * reported alongside the verdict for exactly that reason.)
 */
function recordTransition(
  content: HTMLElement,
  apply: () => void,
  mid?: { at: number; apply: () => void },
): Promise<Trace> {
  return new Promise((resolve) => {
    const samples: Sample[] = []
    //Sampled on requestAnimationFrame, NOT a timer: a timer measures wall-clock, and wall-clock
    //cannot see a dropped frame. The gaps BETWEEN rAF callbacks are the animation's real frame
    //rate, which is the only number that distinguishes a 60fps ease from a 25fps one that lands
    //in the same place at the same time — the distinction every geometry assertion here is blind
    //to, and the one that decides whether the sheet feels like a UIKit sheet.
    const frames: number[] = []
    const startedAt = performance.now()
    let last = startedAt
    let perturbed = false
    let ticked = false
    let raf = 0

    apply()
    function tick() {
      ticked = true
      const now = performance.now()
      frames.push(now - last)
      last = now
      const elapsed = now - startedAt
      if (mid && !perturbed && elapsed >= mid.at) {
        perturbed = true
        mid.apply()
      }
      samples.push(sampleGeometry(content, startedAt))
      if (elapsed < SETTLE_MS) {
        raf = requestAnimationFrame(tick)
        return
      }
      resolve({ samples, frames })
    }
    raf = requestAnimationFrame(tick)
    //a document that is open but not on screen never fires rAF; do not hang on it
    setTimeout(() => {
      if (ticked) return
      cancelAnimationFrame(raf)
      samples.push(sampleGeometry(content, startedAt))
      resolve({ samples, frames })
    }, SETTLE_MS + 400)
  })
}

/** Fraction of the total travel covered by `t` ms — the snap detector. */
function timeToFraction(
  samples: Sample[],
  pick: (s: Sample) => number,
  fraction: number,
): number {
  const from = pick(samples[0])
  const to = pick(samples[samples.length - 1])
  const travel = to - from
  if (Math.abs(travel) < 1) return Number.POSITIVE_INFINITY
  for (const sample of samples) {
    if (Math.abs(pick(sample) - from) >= Math.abs(travel) * fraction) {
      return sample.t
    }
  }
  return samples[samples.length - 1].t
}

type Reversal = { px: number; t: number; before: number; after: number }

/**
 * The worst step AGAINST the direction of travel, or null when every sample moves the same way.
 * Reported with its time and both values, because "812 → 487" says only that an edge turned
 * around somewhere: an installed target can show that line and nothing else, and whether the
 * turn is an overshoot past the rest, a late step before the keyboard lands or a one-frame
 * wobble is the whole diagnosis. One overlay screenshot has to carry it.
 */
function worstReversal(
  samples: Sample[],
  pick: (s: Sample) => number,
): Reversal | null {
  const from = pick(samples[0])
  const to = pick(samples[samples.length - 1])
  const sign = Math.sign(to - from)
  if (sign === 0) return null
  let worst: Reversal | null = null
  for (let i = 1; i < samples.length; i++) {
    const before = pick(samples[i - 1])
    const after = pick(samples[i])
    const delta = (after - before) * sign
    if (delta < 0 && (!worst || delta < -worst.px)) {
      worst = { px: -delta, t: Math.round(samples[i].t), before, after }
    }
  }
  return worst
}

function reversalCheck(
  name: string,
  samples: Sample[],
  pick: (s: Sample) => number,
): Check {
  const turn = worstReversal(samples, pick)
  const path = `${pick(samples[0])} → ${pick(samples[samples.length - 1])}`
  return {
    name,
    pass: !turn || turn.px <= FRAME_TOLERANCE,
    detail: turn
      ? `${path}, turned ${Math.round(turn.px)}px at ${turn.t}ms (${turn.before} → ${turn.after})`
      : path,
  }
}

function checkTransition(
  step: string,
  { samples, frames }: Trace,
  expected: {
    safeTop: number
    contentBottom: number
    animated: boolean
    monotonic?: boolean
    easeFloorMs?: number
  },
): StepResult {
  const last = samples[samples.length - 1]
  const minTop = Math.min(...samples.map((s) => s.top))
  const topTravel = Math.abs(last.top - samples[0].top)
  const t90 = timeToFraction(samples, (s) => s.top, 0.9)

  /*
   * There is no frame-jump check here, deliberately.
   *
   * Two generations of one existed and neither could discriminate. In pixels it measured the
   * SAMPLER — `setInterval` skips on a busy main thread, so healthy eases showed 60px "jumps".
   * Normalised against path length it passed a genuinely broken version (a 330px two-frame step,
   * later confirmed by video) and failed healthy ones by three points. A metric that has been
   * wrong in both directions is not a loose threshold, it is not a measurement.
   *
   * The property it was reaching for — does this motion ease or step — is answered properly by
   * `?only=<scenario>` plus a slit-scan over the marker on the sheet's top edge (docs/design/behaviors.md §4).
   * That reads the painted frames, so there is nothing to tune and nothing to fool.
   */
  const checks: Check[] = [
    {
      name: "never above the safe top",
      pass: minTop >= expected.safeTop - FRAME_TOLERANCE,
      detail: `min ${minTop} >= ${expected.safeTop}`,
    },
    {
      name: "content clears the keyboard",
      pass: last.bottom <= expected.contentBottom + FRAME_TOLERANCE,
      detail: `bottom ${last.bottom} <= ${expected.contentBottom}`,
    },
    {
      name: "settles flush against it",
      pass:
        last.bottom >= expected.contentBottom - FRAME_TOLERANCE ||
        last.top <= expected.safeTop + FRAME_TOLERANCE,
      detail: `bottom ${last.bottom} vs ${expected.contentBottom}, top ${last.top} vs ${expected.safeTop}`,
    },
  ]

  //a step that deliberately changes its mind mid-flight is allowed to turn around; every other
  //step must not, because a reversal is the sheet correcting something it should not have done
  if (expected.monotonic !== false) {
    checks.push(
      reversalCheck("top edge never reverses", samples, (s) => s.top),
      reversalCheck(
        "content edge never reverses",
        samples,
        (s) => s.bottom,
      ),
    )
  }

  // A snap is travel finished far too early — the failure mode this harness exists to catch. The
  // floor is lower for a step that re-aims mid-flight, and that is not a concession: a correction
  // is DELIBERATELY compressed into the motion already running (clamped at 0.12s) so it blends
  // instead of appending a slow tail. Judging it by the fresh-transition figure flags the engine
  // for doing the right thing — as it did at a sampled 116ms against a 120ms bar.
  const floor = expected.easeFloorMs ?? 120
  if (expected.animated && topTravel > 20) {
    checks.push({
      name: "eased, not snapped",
      pass: t90 >= floor,
      detail: `90% of ${Math.round(topTravel)}px at ${t90}ms (need >=${floor})`,
    })
  }

  // Smoothness, measured rather than eyeballed. A dropped frame is any interval long enough to
  // have missed a vsync; SwiftUI's sheet drops none. `fps` is over the animating window, so a
  // number well under 60 means the main thread was busy — which for this drawer means layout,
  // because animating max-height/min-height/padding reflows the sheet on every frame.
  const animating = frames.slice(
    1,
    Math.max(2, Math.round(frames.length * 0.6)),
  )
  const elapsed = animating.reduce((a, b) => a + b, 0)
  const fps = elapsed > 0 ? (animating.length / elapsed) * 1000 : 0
  const worstFrame = animating.length ? Math.max(...animating) : 0
  const dropped = animating.filter((f) => f > 25).length

  if (frames.length > 4) {
    checks.push({
      name: "runs at frame rate",
      pass: fps >= 45 && dropped <= 2,
      detail: `${fps.toFixed(0)}fps, ${dropped} dropped, worst ${worstFrame.toFixed(0)}ms`,
    })
  }

  return {
    step,
    checks,
    perf: `${fps.toFixed(0)}fps w${worstFrame.toFixed(0)}ms d${dropped}`,
    samples,
  }
}

function LabDrawerKeyboardPage() {
  const [open, setOpen] = useState(false)
  const [extraRows, setExtraRows] = useState(0)
  const [keyboard, setKeyboard] = useState(0)
  const [keyboardShown, setKeyboardShown] = useState(false)

  //Derived from the height, never hand-set: a flag that each call site has to remember leaves the
  //block hidden for the steps someone forgot, and then the gap is measured against the viewport
  //floor instead of the keyboard. One frame late on purpose, so the slide has a start state.
  useEffect(() => {
    if (keyboard <= 0) {
      setKeyboardShown(false)
      return
    }
    const frame = requestAnimationFrame(() => setKeyboardShown(true))
    return () => cancelAnimationFrame(frame)
  }, [keyboard])
  const [results, setResults] = useState<StepResult[]>([])
  const [running, setRunning] = useState(false)
  const extraRowsRef = useRef(0)
  extraRowsRef.current = extraRows

  //the mock has to exist before the drawer's observer mounts
  useEffect(() => {
    setMockKeyboard(0)
    return () => setMockKeyboard(0)
  }, [])

  //`?autorun` opens the sheet on load, so a headless surface that cannot tap (a simulator driven
  //by `simctl openurl`, `adb ... VIEW -d`) still triggers the self-run — the verdict then reads
  //off the on-screen overlay in one screenshot. Pairs with `?only=` to isolate a single scenario.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("autorun")) {
      setOpen(true)
    }
  }, [])

  // A real keyboard retracts when the field loses focus, and `dismissVirtualKeyboard()` works by
  // blurring — so a mock that ignores blur cannot model the one interaction where the drawer
  // dismisses the keyboard itself. While focus-linked, a `focusout` retracts the mock, which is
  // what lets the drag scenario observe the room unwinding with the finger still down.
  const focusLinkedRef = useRef(false)
  useEffect(() => {
    function onFocusOut() {
      if (!focusLinkedRef.current) return
      setKeyboard(0)
      setMockKeyboard(0)
    }
    document.addEventListener("focusout", onFocusOut)
    return () => document.removeEventListener("focusout", onFocusOut)
  }, [])

  //Self-running: the trigger cannot live on the page, because once the sheet is open the page is
  //behind its backdrop and every tap dismisses it. Open is the only interaction the harness
  //needs — one tap on any target, then read the verdict off the overlay.
  const runRef = useRef<(() => Promise<void>) | null>(null)
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => void runRef.current?.(), 600)
    return () => clearTimeout(timer)
  }, [open])

  const run = useCallback(async () => {
    //`?only=picker` runs just the collapse-mid-raise case, so a screen recording is a few seconds
    //long and the motion under test is the only thing in it
    const only = new URLSearchParams(window.location.search).get("only")
    setRunning(true)
    setResults([])
    const content = document.querySelector<HTMLElement>(
      "[data-pwa-drawer] > div",
    )
    if (!content) {
      setRunning(false)
      return
    }
    const collected: StepResult[] = []
    const publish = () => {
      ;(
        window as unknown as { __drawerConformance?: StepResult[] }
      ).__drawerConformance = collected
    }
    try {
      await scenarios(content, only, collected)
    } catch (error) {
      //a scenario that throws is a verdict too, and it must reach the overlay and the window
      //property rather than leaving both readers waiting on a run that silently stopped
      collected.push({
        step: "run aborted",
        samples: [],
        checks: [
          {
            name: "every scenario ran",
            pass: false,
            detail: error instanceof Error ? error.message : String(error),
          },
        ],
      })
      setResults([...collected])
    } finally {
      setExtraRows(0)
      publish()
      setRunning(false)
    }

    //hoisted: the scenarios read `step`, `kb` and the refs the run set up above
    async function scenarios(
      content: HTMLElement,
      only: string | null,
      collected: StepResult[],
    ) {
      const viewportHeight = window.innerHeight
      //the highest the sheet may ever reach: the stylesheet's own cap, read at rest (the engine
      //owns `max-height` inline only while it is holding keyboard room)
      const cssCap = Number.parseFloat(getComputedStyle(content).maxHeight)
      const safeTop = Number.isFinite(cssCap)
        ? Math.round(viewportHeight - cssCap)
        : 0

      // Keyboard heights as a FRACTION of the viewport, never px. A fixed 320 is ~40% of a phone
      // held upright and ~90% of the same phone on its side, so a px literal quietly turns a
      // realistic test into an absurd one the moment the device rotates — and landscape is exactly
      // where the interesting case lives (a keyboard taller than the sheet's hidden reserve).
      const kb = (fraction: number) =>
        Math.round(viewportHeight * fraction)
      const pct = (fraction: number) => `${Math.round(fraction * 100)}%`

      async function step(
        name: string,
        keyboardHeight: number,
        apply: () => void,
        options: {
          mid?: { at: number; apply: () => void }
          monotonic?: boolean
        } = {},
      ) {
        const trace = await recordTransition(
          content as HTMLElement,
          apply,
          options.mid,
        )
        collected.push(
          checkTransition(name, trace, {
            safeTop,
            contentBottom: viewportHeight - keyboardHeight,
            animated: true,
            monotonic: options.monotonic,
            //a mid-flight correction rides the 0.12s clamp, less one 16ms sample interval
            easeFloorMs: options.mid ? 104 : undefined,
          }),
        )
        setResults([...collected])
      }

      if (only === "lag") {
        //the picker-first / keyboard-lagging repro in isolation (no warm-up raise), so a slit-scan
        //over the top edge reads only this motion — before the fix a dip, after it one descent
        setExtraRows(8)
        setKeyboard(0)
        setMockKeyboard(0)
        await new Promise((r) => setTimeout(r, SETTLE_MS))
        const field = content.querySelector<HTMLInputElement>("input")
        await step(
          "picker collapses, keyboard lags",
          kb(0.4),
          () => {
            field?.focus()
            setExtraRows(0)
          },
          {
            mid: {
              at: 48,
              apply: () => {
                setKeyboard(kb(0.4))
                setMockKeyboard(kb(0.4))
              },
            },
          },
        )
        return
      }
      if (only !== "picker") {
        await step(`raise 0→${pct(0.4)}`, kb(0.4), () => {
          setKeyboard(kb(0.4))
          setMockKeyboard(kb(0.4))
        })
      }
      if (only === "dismiss") {
        //raise, settle, then the release under test — nothing else in the recording
        await step(`raise 0→${pct(0.37)}`, kb(0.37), () => {
          setKeyboard(kb(0.37))
          setMockKeyboard(kb(0.37))
        })
        await step(`dismiss ${pct(0.37)}→0`, 0, () => {
          setKeyboard(0)
          setMockKeyboard(0)
        })
        return
      }
      if (only) {
        setExtraRows(8)
        await new Promise((r) => setTimeout(r, SETTLE_MS))
        await step(
          "picker collapses mid-raise",
          kb(0.4),
          () => {
            setKeyboard(kb(0.4))
            setMockKeyboard(kb(0.4))
          },
          {
            monotonic: false,
            mid: { at: 100, apply: () => setExtraRows(0) },
          },
        )
        return
      }
      await step(`grow ${pct(0.4)}→${pct(0.47)}`, kb(0.47), () => {
        setKeyboard(kb(0.47))
        setMockKeyboard(kb(0.47))
      })
      await step(`shrink ${pct(0.47)}→${pct(0.37)}`, kb(0.37), () => {
        setKeyboard(kb(0.37))
        setMockKeyboard(kb(0.37))
      })
      await step(`content grows (kb ${pct(0.37)})`, kb(0.37), () => {
        setExtraRows(6)
      })
      await step(`content shrinks (kb ${pct(0.37)})`, kb(0.37), () => {
        setExtraRows(0)
      })
      await step(`dismiss ${pct(0.37)}→0`, 0, () => {
        setKeyboard(0)
        setMockKeyboard(0)
      })

      // ---- the hard half: nothing below settles from rest ----

      //iOS reports a raise in two steps as a rule; the correction lands mid-motion
      await step(
        `re-aim mid-raise ${pct(0.42)}→${pct(0.47)}`,
        kb(0.47),
        () => {
          setKeyboard(kb(0.42))
          setMockKeyboard(kb(0.42))
        },
        {
          mid: {
            at: 100,
            apply: () => {
              setKeyboard(kb(0.47))
              setMockKeyboard(kb(0.47))
            },
          },
        },
      )

      //changed its mind: dismissed while still rising. Must land at rest with no residue.
      await step(
        "flip: dismiss mid-raise",
        0,
        () => {
          setKeyboard(kb(0.45))
          setMockKeyboard(kb(0.45))
        },
        {
          monotonic: false,
          mid: {
            at: 120,
            apply: () => {
              setKeyboard(0)
              setMockKeyboard(0)
            },
          },
        },
      )

      //content that outgrows the cap while the keyboard holds its room — the top must stop at the
      //cap and the overflow must become scroll, not a sheet that walks off the top of the screen
      await step(`grow past the cap (kb ${pct(0.4)})`, kb(0.4), () => {
        setKeyboard(kb(0.4))
        setMockKeyboard(kb(0.4))
        setExtraRows(24)
      })

      //and back down again, from a sheet that is now pinned at its cap
      await step("keyboard off, content still tall", 0, () => {
        setKeyboard(0)
        setMockKeyboard(0)
      })

      // An EXTREME keyboard — more of the screen than the sheet's hidden reserve (55% of the
      // viewport) and more than half the room it had. Landscape is the usual way to meet this, but
      // orientation is not the variable that matters: what matters is keyboard-vs-reserve, and a
      // portrait phone with a 70% keyboard is the same test without needing to rotate a device the
      // app refuses to render in.
      await step(`raise 0→${pct(0.7)} (extreme)`, kb(0.7), () => {
        setExtraRows(2)
        setKeyboard(kb(0.7))
        setMockKeyboard(kb(0.7))
      })
      await step(`release ${pct(0.7)}→0`, 0, () => {
        setKeyboard(0)
        setMockKeyboard(0)
      })

      // Two geometry changes at once: focusing a field collapses an expanded picker (content
      // SHRINKS) at the same moment the keyboard raises (room GROWS). Each is animated correctly on
      // its own; together they are two updates racing over the same box.
      setExtraRows(8)
      await new Promise((r) => setTimeout(r, SETTLE_MS))
      await step(
        "picker collapses mid-raise",
        kb(0.4),
        () => {
          setKeyboard(kb(0.4))
          setMockKeyboard(kb(0.4))
        },
        {
          monotonic: false,
          mid: { at: 100, apply: () => setExtraRows(0) },
        },
      )
      await step("release after collapse", 0, () => {
        setKeyboard(0)
        setMockKeyboard(0)
      })

      // The SAME two changes, but in the order that actually flickers, and with the inter-frame gap
      // the near-instant mock otherwise hides. The keyboard is DOWN and the picker EXPANDED; on focus
      // the picker collapses (content SHRINKS) and — a few frames LATER, not together — the keyboard
      // raises (room GROWS). While only the picker was open no room was held, so the collapse cannot
      // ride the keyboard-room effect (it early-returns at room 0): without a floor primed on focus
      // the sheet's top DROPS on the collapse frame and is pulled back UP when the keyboard arrives —
      // a reversal. The `focus` here is the real signal (the fix listens for it); the mock drives the
      // height directly, bypassing the web prediction that already coalesces this, so the lag — and
      // the dip it causes — reproduces the NATIVE path on every platform this harness runs on.
      setExtraRows(8)
      setKeyboard(0)
      setMockKeyboard(0)
      await new Promise((r) => setTimeout(r, SETTLE_MS))
      const laggedField = content.querySelector<HTMLInputElement>("input")
      await step(
        "picker collapses, keyboard lags",
        kb(0.4),
        () => {
          laggedField?.focus()
          setExtraRows(0)
        },
        {
          mid: {
            at: 48,
            apply: () => {
              setKeyboard(kb(0.4))
              setMockKeyboard(kb(0.4))
            },
          },
        },
      )
      //back to a clean baseline for the drag section below (keyboard down, nothing focused)
      laggedField?.blur()
      setKeyboard(0)
      setMockKeyboard(0)
      await new Promise((r) => setTimeout(r, SETTLE_MS))

      // ---- drag with the keyboard up ----
      //
      // SwiftUI lets you pull a sheet down while the keyboard is up; the keyboard rides along and
      // both leave together. Suppressing the gesture instead — which is what adaptv did — means the
      // one instinctive way out of a form silently does nothing while a field is focused.
      const panel = content.parentElement
      //Desktop WebKit (Playwright's webkit) constructs a TouchEvent but not a Touch — `new Touch()`
      //is an illegal constructor there, where iOS WebKit and every Chromium build it. The synthetic
      //drag cannot be fired without one, and a step that throws must say so instead of taking the
      //whole run with it — every reader of `__drawerConformance` waited on a verdict that never came.
      const canSynthesiseTouch = (() => {
        try {
          new TouchEvent("touchstart", {
            touches: [
              new Touch({
                identifier: 1,
                target: document.body,
                clientX: 0,
                clientY: 0,
              }),
            ],
          })
          return true
        } catch {
          return false
        }
      })()
      if (panel && !canSynthesiseTouch) {
        collected.push({
          step: "drag with the keyboard up",
          samples: [],
          checks: [],
          perf: "skipped — this engine cannot construct a TouchEvent",
        })
        setResults([...collected])
      }
      if (panel && canSynthesiseTouch) {
        //Start from the top of the scroller. A downward drag on SCROLLED content is a scroll, not a
        //sheet drag — that is the drawer being right, and a test that inherits a scroll position
        //from an earlier scenario is just asserting the wrong thing.
        const dragScroller = [...content.children].find(
          (el) => getComputedStyle(el).overflowY === "auto",
        ) as HTMLElement | undefined
        if (dragScroller) dragScroller.scrollTop = 0
        //focus a real field, so the drawer's own dismissal (a blur) retracts the mock like the OS would
        focusLinkedRef.current = true
        content.querySelector<HTMLInputElement>("input")?.focus()
        setKeyboard(kb(0.4))
        setMockKeyboard(kb(0.4))
        await new Promise((r) => setTimeout(r, SETTLE_MS))
        const roomBefore = Number.parseFloat(
          getComputedStyle(content).paddingBottom,
        )

        const readY = () =>
          new DOMMatrixReadOnly(getComputedStyle(panel).transform).m42
        const startY = Math.round(content.getBoundingClientRect().top + 80)
        const touch = (y: number) =>
          new Touch({
            identifier: 1,
            target: panel,
            clientX: 180,
            clientY: y,
          })
        const fire = (type: string, y: number) =>
          panel.dispatchEvent(
            new TouchEvent(type, {
              bubbles: true,
              cancelable: true,
              touches: type === "touchend" ? [] : [touch(y)],
              changedTouches: [touch(y)],
            }),
          )

        // Deliberately SHORT and slow — 60px at ~0.33px/ms, under both the 25%-of-travel and the
        // 0.4px/ms release thresholds. A longer, faster pull dismisses the sheet, which is correct
        // and is why the first version of this scenario read a detached node: it was labelled
        // "released short" while actually flinging the drawer closed.
        fire("touchstart", startY)
        let followed = 0
        for (let i = 1; i <= 6; i++) {
          fire("touchmove", startY + i * 10)
          await new Promise((r) => setTimeout(r, 30))
          followed = Math.max(followed, readY())
        }
        fire("touchend", startY + 60)
        await new Promise((r) => setTimeout(r, SETTLE_MS))
        const roomAfter =
          Number.parseFloat(getComputedStyle(content).paddingBottom) || 0

        collected.push({
          step: "drag with the keyboard up",
          //a finger-driven step: the sheet is read where the finger is, not on a frame series
          samples: [],
          checks: [
            {
              name: "the sheet follows the finger",
              pass: followed > 20,
              detail: `moved ${Math.round(followed)}px (need >20)`,
            },
            {
              name: "snaps back when released short",
              pass: Math.abs(readY()) <= 2,
              detail: `resting at ${Math.round(readY())}`,
            },
            {
              //the drag dismisses the keyboard; the room it was holding has to come back too, or
              //the sheet is left carrying empty space for a keyboard that is no longer there
              name: "the room unwinds with it",
              pass: roomBefore > 20 && roomAfter <= 2,
              detail: `${Math.round(roomBefore)}px → ${Math.round(roomAfter)}px`,
            },
          ],
        })
        setResults([...collected])

        focusLinkedRef.current = false
        setKeyboard(0)
        setMockKeyboard(0)
        await new Promise((r) => setTimeout(r, SETTLE_MS))
      }

      // ---- scroll anchoring: the sheet may move, your place may not ----
      //
      // When the box grows back, the scroller's viewport grows with it and the content can slide
      // under the user. Measured from MID-scroll deliberately: pinned at the very bottom the
      // content genuinely must slide to fill the space the keyboard gave back — UIScrollView does
      // exactly the same when a bottom inset shrinks, and demanding otherwise would be inventing a
      // rule iOS does not have. Mid-scroll there is no such excuse: nothing is clamped, so whatever
      // row you were looking at must stay where it was relative to the sheet.
      const scroller = [...content.children].find(
        (el) => getComputedStyle(el).overflowY === "auto",
      ) as HTMLElement | undefined

      if (scroller) {
        setExtraRows(14)
        setKeyboard(kb(0.4))
        setMockKeyboard(kb(0.4))
        await new Promise((r) => setTimeout(r, SETTLE_MS))
        scroller.scrollTop = Math.round(
          (scroller.scrollHeight - scroller.clientHeight) / 2,
        )
        await new Promise((r) => setTimeout(r, 100))

        //a row near the top of the viewport, which mid-scroll is nowhere near an extreme
        const anchor = scroller.querySelector<HTMLElement>(
          "div:first-of-type",
        )
        const before = {
          anchor: anchor?.getBoundingClientRect().top ?? 0,
          content: content.getBoundingClientRect().top,
        }

        const trace = await recordTransition(content, () => {
          setKeyboard(0)
          setMockKeyboard(0)
        })

        const drift =
          anchor && content
            ? Math.abs(
                anchor.getBoundingClientRect().top -
                  before.anchor -
                  (content.getBoundingClientRect().top - before.content),
              )
            : 0

        const anchored = checkTransition(
          "scroll anchored on dismiss (mid-scroll)",
          trace,
          {
            safeTop,
            contentBottom: viewportHeight,
            animated: true,
          },
        )
        anchored.checks.push({
          name: "content keeps its place",
          pass: drift <= 4,
          detail: `drifted ${Math.round(drift)}px past the sheet (need <=4)`,
        })
        collected.push(anchored)
        setResults([...collected])
      }
    }
  }, [])

  runRef.current = run

  const total = results.reduce((n, r) => n + r.checks.length, 0)
  const failed = results.reduce(
    (n, r) => n + r.checks.filter((c) => !c.pass).length,
    0,
  )

  return (
    <LabPage title="Drawer × keyboard">
      <LabSection
        title="Conformance run"
        description="Drives adaptv's keyboard observer through its test seam and paints a solid block the sheet has to avoid. One screenshot is the whole report."
      >
        <LabButton onClick={() => setOpen(true)}>
          Open drawer (runs itself)
        </LabButton>
      </LabSection>

      {(running || results.length > 0) &&
        //Portalled to <body>, like the drawer is. A z-index only competes inside its own stacking
        //context, so a report nested in the page tree loses to a portalled sheet however high the
        //number — which silently truncated the verdict on WebKit and made a partial list read as
        //a full pass.
        createPortal(
          <pre
            data-testid="conformance-report"
            //above the panel and the fake keyboard: the verdict has to survive being screenshotted
            //mid-run on a device, which is the only way to read it there
            style={{
              position: "fixed",
              insetInline: 0,
              top: 0,
              zIndex: 300,
              margin: 0,
              padding: 4,
              background: "rgba(0,0,0,0.85)",
              color: "#4ade80",
              font: "9px ui-monospace, monospace",
              lineHeight: 1.3,
              whiteSpace: "pre-wrap",
              pointerEvents: "none",
            }}
          >
            {`${failed === 0 ? "PASS" : `FAIL ${failed}/${total}`}${document.hidden ? " (document hidden — motion frozen, checks unreliable)" : ""}\n${results
              .map(
                (r) =>
                  `${r.checks.every((c) => c.pass) ? "ok  " : "FAIL"} ${r.step}  ${r.perf ?? ""}\n${r.checks
                    .filter((c) => !c.pass)
                    .map((c) => `       ✗ ${c.name} — ${c.detail}`)
                    .join("\n")}`,
              )
              .join("\n")}`}
          </pre>,
          document.body,
        )}

      <AppDrawer open={open} onOpenChange={setOpen}>
        <AppDrawer.Portal>
          <AppDrawer.Overlay />
          <AppDrawer.Content>
            {/*ground-truth marker: a saturated strip at the sheet's top edge, so a frame from a
                 screen recording can be measured by finding a colour instead of by inferring an
                 edge out of two dark greys*/}
            <div
              aria-hidden
              style={{
                position: "absolute",
                insetInline: 0,
                top: 0,
                height: 6,
                background: "#ff0000",
              }}
            />
            <AppDrawer.Handle />
            <AppDrawer.Shell className="flex flex-col gap-y-4 pt-4">
              <AppDrawer.Title>Keyboard conformance</AppDrawer.Title>
              <input
                className="w-full rounded-md border border-border-subtle bg-surface px-3 py-3 text-base text-foreground"
                placeholder="Focus me"
                aria-label="Harness field"
              />
              {Array.from(
                { length: 4 + extraRows },
                (_, i) => `Row ${i + 1}`,
              ).map((row) => (
                <div
                  key={row}
                  className="rounded-md bg-secondary px-3 py-3 text-sm text-foreground"
                >
                  {row}
                </div>
              ))}
            </AppDrawer.Shell>
          </AppDrawer.Content>
        </AppDrawer.Portal>
      </AppDrawer>

      {/* the fake keyboard — above the sheet, exactly like the real one */}
      {keyboard > 0 && (
        <div
          aria-hidden
          data-testid="fake-keyboard"
          style={{
            position: "fixed",
            insetInline: 0,
            bottom: 0,
            height: keyboard,
            zIndex: 200,
            background: KEYBOARD_COLOR,
            //A real keyboard SLIDES (~250ms). Appearing instantly hid the property that matters
            //most for parity: the sheet must track the keyboard's edge the whole way up, not just
            //agree with it once both have stopped.
            transform: `translateY(${keyboardShown ? 0 : keyboard}px)`,
            transition:
              "transform 250ms cubic-bezier(0.17, 0.59, 0.21, 1)",
          }}
        />
      )}
    </LabPage>
  )
}

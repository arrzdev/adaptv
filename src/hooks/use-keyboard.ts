import { useEffect, useMemo, useReducer, useRef, useState } from "react"
import {
  hasNativeKeyboard,
  listenNativeKeyboard,
  measureKeyboardPayment,
} from "#adaptv/capabilities/keyboard"
import {
  predictKeyboardHeight,
  recordKeyboardHeight,
} from "#adaptv/capabilities/keyboard-height-cache"

const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
  "image",
  "button",
  "submit",
  "reset",
])

/** Whether focusing `target` would raise the on-screen keyboard (text inputs only). */
export function willOpenVirtualKeyboard(target: Element) {
  return (
    (target instanceof HTMLInputElement &&
      !NON_TEXT_INPUT_TYPES.has(target.type)) ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

type VirtualKeyboardApi = {
  overlaysContent: boolean
  boundingRect: { height: number }
  addEventListener: (
    type: "geometrychange",
    listener: EventListenerOrEventListenerObject,
  ) => void
  removeEventListener: (
    type: "geometrychange",
    listener: EventListenerOrEventListenerObject,
  ) => void
}

export function isSecureContext() {
  return typeof window !== "undefined" && window.isSecureContext
}

export function getVirtualKeyboardApi(): VirtualKeyboardApi | null {
  if (!isSecureContext() || !("virtualKeyboard" in navigator)) return null
  return navigator.virtualKeyboard as VirtualKeyboardApi
}

/** The focused element if focusing it raises the on-screen keyboard (shadow roots walked), else `null`. */
export function getActiveInputElement() {
  let active: Element | null = document.activeElement

  while (
    active instanceof HTMLElement &&
    active.shadowRoot?.activeElement
  ) {
    active = active.shadowRoot.activeElement
  }

  return active && willOpenVirtualKeyboard(active)
    ? (active as HTMLElement)
    : null
}

function readKeyboardHeight(visualViewportThreshold: number): number {
  const vk = getVirtualKeyboardApi()
  if (vk && vk.boundingRect.height > 0) {
    return vk.boundingRect.height
  }

  const vv = window.visualViewport
  if (!vv) return 0

  //rounded: iOS reports fractional viewport heights (e.g. 534.328125), and consumers
  //animate toward these values — integer targets avoid sub-pixel re-aims
  const heightDiff = Math.round(window.innerHeight - vv.height)
  if (heightDiff > visualViewportThreshold) return heightDiff

  //overlaysContent: layout height unchanged; keyboard shows as vv offset
  const offsetBottom = Math.round(
    window.innerHeight - vv.offsetTop - vv.height,
  )
  if (offsetBottom > visualViewportThreshold) return offsetBottom

  return 0
}

/*
 * A harness can drive the keyboard directly, because the thing this hook observes cannot be
 * automated: simulators do not raise a software keyboard for a scripted run, and no web API lets
 * a page synthesise `visualViewport` geometry. Everything downstream of here — the drawer's whole
 * room-and-growth behaviour — is therefore untestable end-to-end without a seam.
 *
 * Opt-in by construction: nothing sets this global by accident, and while it is set this hook
 * reports the mock and nothing else, so a harness can drive raise/grow/shrink/dismiss frame by
 * frame and assert what the sheet did. Install it BEFORE the observer mounts (the drawer's only
 * mounts when it opens), then dispatch `adaptv:keyboard-mock` on every change.
 */
export const KEYBOARD_MOCK_EVENT = "adaptv:keyboard-mock"
const KEYBOARD_MOCK_KEY = "__adaptvKeyboardMock"

type KeyboardMockHost = { [KEYBOARD_MOCK_KEY]?: Partial<KeyboardReport> }

function readKeyboardMock(): KeyboardReport | null {
  if (typeof window === "undefined") return null
  const mock = (window as unknown as KeyboardMockHost)[KEYBOARD_MOCK_KEY]
  if (!mock || typeof mock.height !== "number") return null
  return { isOpen: Boolean(mock.isOpen), height: mock.height }
}

/** Blur the focused field so the on-screen keyboard can dismiss. */
export function dismissVirtualKeyboard() {
  if (typeof document === "undefined") return
  const el = document.activeElement
  if (el instanceof HTMLElement && willOpenVirtualKeyboard(el)) {
    el.blur()
  }
}

/*
 * The keyboard is a singleton, so its geometry belongs on `<html>` where any rule in
 * the app can see it — global chrome (a tab bar that lifts, a docked toolbar) must be
 * able to react without living inside an `<AvoidKeyboard>` subtree.
 *
 * `--adaptv-keyboard-height` (docs/decisions/styling.md §4) is a measured scalar: continuous, and it
 * has to compose inside `calc()`, which an attribute cannot. The resting `0px` is
 * declared in styles/keyboard.css so the variable is ALWAYS defined and no call site
 * needs a `, 0px` fallback; the inline value written here overrides it.
 *
 * `data-keyboard-open` is boolean-PRESENCE (§3.1) — present or absent, never
 * `="false"` — so Tailwind v4's bare `data-keyboard-open:pb-4` works and
 * `not-data-keyboard-open:` composes for the inverse.
 *
 * Refcounted, because more than one component may observe the keyboard at once and a
 * DISABLED observer reports `{ isOpen: false, height: 0 }` — letting it publish would
 * let it stamp "closed" over a live keyboard. Only enabled observers register, and the
 * root is only reset once the last of them goes away.
 */
const KEYBOARD_HEIGHT_VAR = "--adaptv-keyboard-height"
const KEYBOARD_OPEN_ATTR = "data-keyboard-open"

let keyboardPublisherCount = 0

function publishKeyboardState({ isOpen, height }: KeyboardReport) {
  if (typeof document === "undefined") return
  const root = document.documentElement
  root.style.setProperty(KEYBOARD_HEIGHT_VAR, `${height}px`)
  if (isOpen) root.setAttribute(KEYBOARD_OPEN_ATTR, "")
  else root.removeAttribute(KEYBOARD_OPEN_ATTR)
}

function clearPublishedKeyboardState() {
  if (typeof document === "undefined") return
  const root = document.documentElement
  //remove rather than set to "0px": the stylesheet's resting declaration is the
  //source of truth for "closed", and leaving an inline copy behind would shadow a
  //consumer who overrides it
  root.style.removeProperty(KEYBOARD_HEIGHT_VAR)
  root.removeAttribute(KEYBOARD_OPEN_ATTR)
}

/** What the observer commits: open or not, and how tall. */
type KeyboardReport = {
  /** `true` while a text field is focused and the on-screen keyboard is up. */
  isOpen: boolean
  /** Live keyboard height in px (0 when closed). */
  height: number
}

export type KeyboardState = KeyboardReport & {
  /**
   * px of `height` the layout viewport has NOT already given up for the keyboard. Equals `height`
   * everywhere but Android native, whose WebView shrinks by the keyboard itself
   * (`capabilities/keyboard.ts`); there it is 0 once that resize lands. Lay out against this, not
   * `height`, or the keyboard is counted twice.
   */
  unpaidHeight: number
  /**
   * `true` where the layout viewport itself resizes for the keyboard (Android native): the
   * keyboard's top edge is then `innerHeight - unpaidHeight`, and the visual viewport says
   * nothing about it.
   */
  resizesLayoutViewport: boolean
}

export type UseKeyboardOptions = {
  /** Disable the listeners (resets to closed). Default `true`. */
  isEnabled?: boolean
  /** Min visual-viewport delta (px) treated as the keyboard. Default `100`. */
  visualViewportThreshold?: number
  /** Settle delay (ms) for viewport resize/scroll bursts. Default `50`. */
  debounceDelay?: number
  /**
   * Seed the height from the learned cache the moment a field is focused, so a consumer can start
   * lifting on the same frame as the tap instead of waiting for the OS to report the keyboard
   * (default `false`). The real measurement then confirms or corrects the guess, and a prediction
   * that no keyboard confirms retracts.
   *
   * Applies to the web/PWA path AND the native path. Native reports an exact height, but it reports
   * it in STEPS — iOS raises the keyboard and then, on a login form, its ~45px AutoFill bar ~250ms
   * later — so without a prediction the sheet animates once per step and lands twice. Seeding the
   * settled height up front collapses both steps into one motion. The mock path drives the value
   * directly and is unaffected.
   */
  predictFromCache?: boolean
}

// The keyboard can vanish while a text field stays focused — iOS password autofill fills the
// fields and dismisses the keyboard WITHOUT blurring. `readKeyboardHeight` then returns 0 while
// the field is still focused, and the observer would keep reporting the keyboard open (the lift
// stays stuck). We can't close on the first 0: during the open slide iOS emits transient 0-height
// reads that recover to a real height a frame later. So when an ALREADY-OPEN keyboard reads 0 with
// the field still focused, confirm the dismissal after this delay; any >0 read in the window cancels
// it. Gated to "already open", the open path (which reads 0 before it has ever opened) never arms
// this — that gate is what a prior naive "close on any settled 0" fix was missing.
const KEYBOARD_DISMISS_CONFIRM_MS = 150

// A prediction (seeded from the height cache on focus, before the OS confirms anything) is held
// this long waiting for a real measurement. The keyboard's own slide is ~250ms, but the first raise
// after a launch is slower — Android measures the IME's height 850ms–1.1s after the focus tap on a
// Pixel 7 emulator — and a window that closes before it lands retracts a prediction that was right:
// the sheet grows on focus, eases back, and grows again when the height arrives. If nothing ever
// materialises (hardware keyboard, programmatic focus, a readonly field the gate missed), the
// prediction retracts at the end of this window and the sheet settles back — the only cost of a
// longer window is that this rarer case holds the predicted height a little longer first.
const KEYBOARD_PREDICT_CONFIRM_MS = 800

// Same discipline for a height DECREASE while already open: switching fields makes iOS emit
// transient mid-animation dips (device-measured: 380 → 335 → 380 within ~85ms) that must not
// re-aim consumers twice per switch. A dropped height only commits after it holds for this
// long — re-read LIVE at fire time, so what commits is always the current geometry, never a
// remembered value. A genuine shrink (the QuickType bar hiding: 380 → 340) holds and lands as
// ONE settled update. Increases and the first raise commit immediately (see syncKeyboardState).
const KEYBOARD_HEIGHT_CONFIRM_MS = 120

// While a native keyboard is open, iOS toggles the ~45px password AutoFill accessory bar on and off
// (device-measured: height flicks 346↔301 for as long as the field is focused, each dip lasting
// ~260ms). A shrink smaller than this is treated as that bar and HELD rather than committed, so the
// sheet doesn't bounce down and back up on the flicker.
const NATIVE_KEYBOARD_SHRINK_HYSTERESIS_PX = 60

// How long a small shrink is held before it's honored; what lands is the last small shrink reported
// inside the window, and a shorter one re-arms it once (see the subscription). Longer than the
// bar's ~260ms dip so the toggle is absorbed, short enough that a GENUINE small reduction still
// lands promptly — the sheet is never stuck too tall, which is what keeps the drawer responsive to
// real keyboard changes.
const NATIVE_KEYBOARD_SHRINK_HOLD_MS = 350

/**
 * Whether a native keyboard report is a SMALL shrink to HOLD (the iOS password AutoFill bar hiding)
 * rather than commit straight away. Only while the keyboard stays open, and only a drop shorter than
 * `thresholdPx` — a grow, a large shrink or a dismiss all fall through and commit. Pure, so the
 * hysteresis decision is unit-testable without the timers around it.
 */
export function isSuppressibleKeyboardShrink(
  wasOpen: boolean,
  committedHeight: number,
  next: KeyboardReport,
  thresholdPx: number,
): boolean {
  return (
    next.isOpen &&
    wasOpen &&
    next.height < committedHeight &&
    committedHeight - next.height < thresholdPx
  )
}

/**
 * Canonical on-screen keyboard observer. Reports a live height + open flag,
 * sourced from the VirtualKeyboard API when available and falling back to
 * `visualViewport` geometry. Only reports open while a text input is focused.
 *
 * Also publishes the state on `<html>` for CSS: `--adaptv-keyboard-height` (always
 * defined, `0px` closed) and the boolean-presence `data-keyboard-open` attribute —
 * so app-level chrome can respond with no React state of its own.
 */
export function useKeyboard({
  isEnabled = true,
  visualViewportThreshold = 100,
  debounceDelay = 50,
  predictFromCache = false,
}: UseKeyboardOptions = {}): KeyboardState {
  const [state, setState] = useState<KeyboardReport>({
    isOpen: false,
    height: 0,
  })
  //a resize that changes only what the layout viewport has paid re-renders through this
  const [, rereadPayment] = useReducer((count: number) => count + 1, 0)

  const focusedElementRef = useRef<HTMLElement | null>(null)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusOutFrame = useRef<number | null>(null)
  //pending confirmation that an already-open keyboard, now reading 0 while still focused,
  //truly dismissed (vs. a transient open-slide 0). See KEYBOARD_DISMISS_CONFIRM_MS.
  const dismissConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  //pending confirmation that an already-open keyboard's CHANGED height is stable
  //(vs. transient mid-field-switch geometry). See KEYBOARD_HEIGHT_CONFIRM_MS.
  const heightConfirmTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  //a prediction is "pending" from the moment it seeds an open state on focus until a real
  //measurement confirms it (any >0 read) or the confirm window retracts it. While pending, a
  //zero-height read must NOT arm the normal dismiss confirmation — the prediction timer owns the
  //retract, and the dismiss path would otherwise close a keyboard that is still sliding in.
  const predictionPendingRef = useRef(false)
  const predictionTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  )
  //latest committed state for the event-path guards (dismiss/height confirms, resize fast-path)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const vv = window.visualViewport
    const vk = getVirtualKeyboardApi()

    function cancelDismissConfirm() {
      if (dismissConfirmTimer.current) {
        clearTimeout(dismissConfirmTimer.current)
        dismissConfirmTimer.current = null
      }
    }

    function cancelHeightConfirm() {
      if (heightConfirmTimer.current) {
        clearTimeout(heightConfirmTimer.current)
        heightConfirmTimer.current = null
      }
    }

    //A prediction is resolved: either a real read confirmed it, or we are tearing down. Stops the
    //retract timer and drops the "pending" gate so the dismiss path is live again.
    function clearPrediction() {
      if (predictionTimer.current) {
        clearTimeout(predictionTimer.current)
        predictionTimer.current = null
      }
      predictionPendingRef.current = false
    }

    function resetKeyboardState() {
      cancelDismissConfirm()
      cancelHeightConfirm()
      clearPrediction()
      focusedElementRef.current = null
      setState({ isOpen: false, height: 0 })
    }

    //Commit a changed height only once it holds: re-reads LIVE geometry at fire time (never a
    //remembered value) and drops the commit if the height meanwhile returned to the committed
    //one — the transient mid-field-switch flap filters itself out.
    function scheduleHeightConfirm() {
      if (heightConfirmTimer.current) return
      heightConfirmTimer.current = setTimeout(() => {
        heightConfirmTimer.current = null
        const active = getActiveInputElement() ?? focusedElementRef.current
        const stillFocused =
          active !== null && willOpenVirtualKeyboard(active)
        if (!stillFocused || !stateRef.current.isOpen) return

        const height = readKeyboardHeight(visualViewportThreshold)
        if (
          height > 0 &&
          Math.abs(height - stateRef.current.height) >= 2
        ) {
          setKeyboardState({ isOpen: true, height })
          recordKeyboardHeight(active, height)
        }
      }, KEYBOARD_HEIGHT_CONFIRM_MS)
    }

    //Confirm-after-delay that a focused-but-zero-height keyboard truly dismissed. Armed only
    //while currently open; any >0 read cancels it (transient open-slide jitter). Re-verifies at
    //fire time before committing the close so a keyboard that came back isn't wrongly dropped.
    function scheduleDismissConfirm() {
      if (dismissConfirmTimer.current) return
      dismissConfirmTimer.current = setTimeout(() => {
        dismissConfirmTimer.current = null
        const active = getActiveInputElement() ?? focusedElementRef.current
        const stillFocused =
          active !== null && willOpenVirtualKeyboard(active)
        if (
          stillFocused &&
          readKeyboardHeight(visualViewportThreshold) === 0 &&
          stateRef.current.isOpen
        ) {
          setKeyboardState({ isOpen: false, height: 0 })
        }
      }, KEYBOARD_DISMISS_CONFIRM_MS)
    }

    //Seed the height from the learned cache the instant a field is focused, so a consumer starts
    //moving on the same frame as the tap instead of waiting for the viewport to report. Gated: opt
    //-in, never when a keyboard is already up, and never for a field that raises none (readonly /
    //disabled). The real measurement that follows confirms or corrects the guess via the normal
    //grow/shrink paths; if none arrives, the prediction timer retracts it.
    function maybePredict(el: HTMLElement) {
      if (!predictFromCache || stateRef.current.isOpen) return
      const field = el as HTMLInputElement
      if (field.readOnly || field.disabled) return
      const predicted = predictKeyboardHeight(el)
      if (predicted === null) return
      cancelDismissConfirm()
      cancelHeightConfirm()
      predictionPendingRef.current = true
      setKeyboardState({ isOpen: true, height: predicted })
      schedulePredictionConfirm()
    }

    //Retract a prediction the OS never confirmed. Re-reads LIVE at fire time: a real keyboard up by
    //now means the >0 read path already cleared the prediction; only a still-zero read while still
    //focused-and-open means the keyboard genuinely never came (hardware keyboard, programmatic
    //focus) — settle back to closed.
    function schedulePredictionConfirm() {
      if (predictionTimer.current) clearTimeout(predictionTimer.current)
      predictionTimer.current = setTimeout(() => {
        predictionTimer.current = null
        predictionPendingRef.current = false
        const active = getActiveInputElement() ?? focusedElementRef.current
        const stillFocused =
          active !== null && willOpenVirtualKeyboard(active)
        if (
          stillFocused &&
          stateRef.current.isOpen &&
          readKeyboardHeight(visualViewportThreshold) === 0
        ) {
          setKeyboardState({ isOpen: false, height: 0 })
        }
      }, KEYBOARD_PREDICT_CONFIRM_MS)
    }

    function setKeyboardState(nextState: KeyboardReport) {
      setState((prev) => {
        if (
          prev.isOpen === nextState.isOpen &&
          Math.abs(prev.height - nextState.height) < 2
        ) {
          return prev
        }

        return nextState
      })
    }

    function syncKeyboardState() {
      const active = getActiveInputElement() ?? focusedElementRef.current
      const inputIsFocused =
        active !== null && willOpenVirtualKeyboard(active)

      if (!inputIsFocused) {
        resetKeyboardState()
        return
      }

      focusedElementRef.current = active
      const keyboardHeight = readKeyboardHeight(visualViewportThreshold)

      if (keyboardHeight > 0) {
        //real keyboard present — abort any pending dismiss confirmation, and resolve any
        //prediction: the keyboard the guess was waiting for has now measurably arrived
        cancelDismissConfirm()
        clearPrediction()

        //first raise (closed → open): commit immediately, the lift must start now. Learn the
        //height so the next open of a same-shape field can be predicted.
        if (!stateRef.current.isOpen) {
          cancelHeightConfirm()
          setKeyboardState({ isOpen: true, height: keyboardHeight })
          recordKeyboardHeight(active, keyboardHeight)
          return
        }

        //already open, same height (± the dedup epsilon): drop any pending change — the
        //read returned to the committed value, so the change was transient. Still record it:
        //this is the steady-state read that confirms a correct prediction's height.
        if (Math.abs(keyboardHeight - stateRef.current.height) < 2) {
          cancelHeightConfirm()
          recordKeyboardHeight(active, keyboardHeight)
          return
        }

        //already open, height GREW: commit immediately. A raise's first read can catch the
        //keyboard mid-slide (device-measured: 335 with the viewport at 539, settling at 380
        //~74ms later) — the upward correction must land EARLY in the lift tween, not after a
        //stability delay. Observed transients only ever DIP (380→335→380 mid field-switch),
        //and under-lift is the harmful direction (content behind the keyboard) — react fast.
        if (keyboardHeight > stateRef.current.height) {
          cancelHeightConfirm()
          setKeyboardState({ isOpen: true, height: keyboardHeight })
          recordKeyboardHeight(active, keyboardHeight)
          return
        }

        //already open, height DROPPED: commit only once stable (field-switch transients)
        scheduleHeightConfirm()
        return
      }

      //focused but zero height. If we were open, this is a dismissal that left the field focused
      //(iOS autofill); confirm after a delay. If we were never open, it's the pre-open path — the
      //keyboard's real height arrives via a later resize — so ignore.
      if (stateRef.current.isOpen) {
        //a still-pending prediction reads zero for the whole keyboard slide — the prediction timer
        //owns that retract, so the dismiss path must not fire here and close it mid-appearance
        if (predictionPendingRef.current) return
        scheduleDismissConfirm()
      }
    }

    function updateKeyboardState() {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)

      debounceTimer.current = setTimeout(() => {
        syncKeyboardState()
      }, debounceDelay)
    }

    function handleGeometryChange() {
      syncKeyboardState()
      updateKeyboardState()
    }

    function handleViewportResize() {
      //Dismissal fast-path: an already-open keyboard whose fresh read is 0 arms the dismiss
      //confirmation NOW instead of paying the debounce first — the confirm window itself
      //re-verifies before committing, so a debounce in front of it is pure added latency.
      //The raise path stays debounced only: it coalesces iOS's multi-step height reports.
      if (
        stateRef.current.isOpen &&
        readKeyboardHeight(visualViewportThreshold) === 0
      ) {
        syncKeyboardState()
      }
      updateKeyboardState()
    }

    function handleFocusIn(event: FocusEvent) {
      if (
        event.target instanceof HTMLElement &&
        willOpenVirtualKeyboard(event.target)
      ) {
        focusedElementRef.current = event.target
        //seed the lift from the cache before syncing — sync reads a still-zero height at this
        //instant (the keyboard has not begun to slide), so on its own it would do nothing
        maybePredict(event.target)
        syncKeyboardState()
        updateKeyboardState()
      }
    }

    function handleFocusOut() {
      focusOutFrame.current = requestAnimationFrame(() => {
        focusOutFrame.current = null
        focusedElementRef.current = getActiveInputElement()
        syncKeyboardState()
        updateKeyboardState()
      })
    }

    if (!isEnabled) {
      resetKeyboardState()
      return
    }

    //driven by a harness (see the test seam above): report the mock and nothing else, so a
    //scripted raise/grow/shrink is exactly what every consumer sees.
    if (readKeyboardMock()) {
      function syncMock() {
        const mock = readKeyboardMock()
        if (mock) setKeyboardState(mock)
      }
      syncMock()
      window.addEventListener(KEYBOARD_MOCK_EVENT, syncMock)
      return () => {
        window.removeEventListener(KEYBOARD_MOCK_EVENT, syncMock)
        setState({ isOpen: false, height: 0 })
      }
    }

    //native: the OS reports exact height + will-show/hide, so skip the whole
    //visualViewport heuristic path (dismiss/height confirms, transient filtering).
    if (hasNativeKeyboard()) {
      let committedHeight = 0
      let committedOpen = false
      let shrinkHoldTimer: ReturnType<typeof setTimeout> | null = null
      //the latest small shrink the open hold absorbed — what it commits when its window expires
      let heldHeight = 0
      //whether the open hold already spent its one re-arm on a shorter replacement
      let shrinkHoldRearmed = false

      function cancelShrinkHold() {
        if (shrinkHoldTimer) {
          clearTimeout(shrinkHoldTimer)
          shrinkHoldTimer = null
        }
      }

      //reads `heldHeight` when it FIRES, so every replacement made inside the window is what lands
      function armShrinkHold() {
        shrinkHoldTimer = setTimeout(() => {
          shrinkHoldTimer = null
          commitMeasuredNative({ isOpen: true, height: heldHeight })
        }, NATIVE_KEYBOARD_SHRINK_HOLD_MS)
      }

      function commitNative(next: KeyboardReport) {
        committedOpen = next.isOpen
        committedHeight = next.isOpen ? next.height : 0
        setState({ isOpen: next.isOpen, height: next.height })
      }

      //A height the OS actually reported — commit it AND teach the cache, so the next open of a
      //same-shape field can be predicted. Only reached from the native subscription, so every value
      //here is a real measurement; `recordKeyboardHeight` ignores a 0 (a dismiss teaches nothing)
      //and a repeat of the same height, and the last value to survive a session is the settled one.
      function commitMeasuredNative(next: KeyboardReport) {
        commitNative(next)
        const active = getActiveInputElement() ?? focusedElementRef.current
        if (active) recordKeyboardHeight(active, next.height)
      }

      function cancelNativePrediction() {
        predictionPendingRef.current = false
        if (predictionTimer.current) {
          clearTimeout(predictionTimer.current)
          predictionTimer.current = null
        }
      }

      // Seed the settled height on the FOCUS frame, from what this field shape measured last time.
      //
      // The native bridge is exact but stepwise: `keyboardWillShow` carries the bare keyboard, and on
      // a login form iOS follows it ~250ms later with the AutoFill bar as a SECOND, taller report. By
      // then the first lift has finished, so the drawer runs a second animation and the sheet visibly
      // lands twice. Predicting the final height makes the first motion the only motion — the bare
      // report that follows is a small SHRINK against the prediction, which the hysteresis below
      // HOLDS, and the real taller report then lands on the value already committed and dedups away.
      //
      // A cold cache (first ever focus of this shape on this device) simply predicts nothing and the
      // stepwise behaviour is unchanged. `commitNative`, not `commitMeasuredNative`: a guess must
      // never be written back to the cache as if it were a measurement.
      function predictNative(el: HTMLElement) {
        if (!predictFromCache || stateRef.current.isOpen) return
        const field = el as HTMLInputElement
        if (field.readOnly || field.disabled) return
        const predicted = predictKeyboardHeight(el)
        if (predicted === null) return
        predictionPendingRef.current = true
        commitNative({ isOpen: true, height: predicted })
        //Retract a prediction the OS never confirms. Unlike the web path there is nothing to re-read
        //here — the native signal is push-only — so a keyboard that never arrives (a hardware/Magic
        //Keyboard, a programmatic focus) would otherwise leave the sheet lifted for a keyboard that
        //isn't there. Any real report cancels it first (see the subscription below).
        if (predictionTimer.current) clearTimeout(predictionTimer.current)
        predictionTimer.current = setTimeout(() => {
          predictionTimer.current = null
          if (!predictionPendingRef.current) return
          predictionPendingRef.current = false
          commitNative({ isOpen: false, height: 0 })
        }, KEYBOARD_PREDICT_CONFIRM_MS)
      }

      function handleNativeFocusIn(event: FocusEvent) {
        if (!(event.target instanceof HTMLElement)) return
        if (!willOpenVirtualKeyboard(event.target)) return
        focusedElementRef.current = event.target
        predictNative(event.target)
      }

      document.addEventListener("focusin", handleNativeFocusIn)

      //every report the OS makes, a repeat of the last one included (a field switch under the same
      //keyboard teaches the cache the new field; a hide must close a pending prediction)
      function handleNativeReport(info: KeyboardReport) {
        // A real report is the confirmation a prediction was waiting for — retire the retract timer
        // here, BEFORE deciding what to do with the value. Doing it inside the commit would miss the
        // held-shrink branch below (which commits nothing yet), and the retract would then fire mid
        // -raise and close a keyboard that is genuinely on screen.
        cancelNativePrediction()

        // Hold the settled height against iOS's password AutoFill bar flickering on/off. A SMALL
        // shrink while open (the ~45px bar hiding, which iOS reverses ~260ms later) is HELD for a
        // beat rather than committed: if the height climbs back within the window it was the toggle
        // and the sheet never bounced; if it STAYS shorter past the window it is a genuine change
        // and commits — so the sheet is never stuck too tall (the drawer stays responsive). Grows,
        // large shrinks and a real dismiss (height 0) all commit immediately and cancel any hold.
        //
        // This is also what absorbs the bare `keyboardWillShow` that follows a PREDICTION: against a
        // predicted 346 the OS's first 301 is exactly such a small shrink, so it is held rather than
        // dropping the sheet, and the AutoFill step's real 346 lands on the committed value and
        // dedups. A prediction that was too tall because the bar genuinely didn't appear is not held
        // forever — the window expires and the real height commits.
        const isSmallShrink = isSuppressibleKeyboardShrink(
          committedOpen,
          committedHeight,
          info,
          NATIVE_KEYBOARD_SHRINK_HYSTERESIS_PX,
        )

        if (!isSmallShrink) {
          cancelShrinkHold()
          commitMeasuredNative(info)
          return
        }

        // The hold is a delay, not a snapshot. The bridge is push-only: once the keyboard stops
        // changing nothing reports again, so the value the hold commits is the last word until the
        // field blurs. A second small shrink inside the window (a stale prediction corrected by the
        // AutoFill step, a field switch that settles in two reports) therefore REPLACES the value —
        // committing the first one would leave content behind the keyboard the OS last reported.
        //
        // A TALLER replacement is the keyboard settling and keeps the deadline. A SHORTER one may be
        // the bar dipping late in a window a genuine shrink opened, and committing it on that
        // deadline would drop the sheet and lift it again ~260ms later — so it re-arms the window
        // for a full hold of its own, ONCE per hold: a keyboard that keeps dipping holds the sheet
        // too tall for two windows at most, never for as long as the reports keep coming.
        if (!shrinkHoldTimer) {
          shrinkHoldRearmed = false
          armShrinkHold()
        } else if (info.height < heldHeight && !shrinkHoldRearmed) {
          shrinkHoldRearmed = true
          cancelShrinkHold()
          armShrinkHold()
        }
        heldHeight = info.height
      }

      const unsubscribe = listenNativeKeyboard({
        onReport: handleNativeReport,
        //Where the WebView pays for the keyboard, a resize moves the unpaid part while the OS says
        //nothing. No keyboard event: re-render to read the payment, and leave the prediction, the
        //hold and the cache exactly as they were.
        onPaymentChange: rereadPayment,
      })

      return () => {
        document.removeEventListener("focusin", handleNativeFocusIn)
        unsubscribe()
        cancelNativePrediction()
        cancelShrinkHold()
        commitNative({ isOpen: false, height: 0 })
      }
    }

    document.addEventListener("focusin", handleFocusIn)
    document.addEventListener("focusout", handleFocusOut)

    if (vv) {
      vv.addEventListener("resize", handleViewportResize)
      vv.addEventListener("scroll", updateKeyboardState)
    }

    if (vk) {
      vk.addEventListener("geometrychange", handleGeometryChange)
    }

    focusedElementRef.current = getActiveInputElement()
    syncKeyboardState()

    return () => {
      document.removeEventListener("focusin", handleFocusIn)
      document.removeEventListener("focusout", handleFocusOut)

      if (vv) {
        vv.removeEventListener("resize", handleViewportResize)
        vv.removeEventListener("scroll", updateKeyboardState)
      }

      if (vk) {
        vk.removeEventListener("geometrychange", handleGeometryChange)
      }

      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      if (focusOutFrame.current !== null) {
        cancelAnimationFrame(focusOutFrame.current)
        focusOutFrame.current = null
      }
      resetKeyboardState()
    }
  }, [debounceDelay, isEnabled, visualViewportThreshold, predictFromCache])

  //register as a publisher for as long as this observer is enabled; the last one out
  //hands the root back to the stylesheet's resting values
  useEffect(() => {
    if (!isEnabled) return
    keyboardPublisherCount++
    return () => {
      keyboardPublisherCount--
      if (keyboardPublisherCount === 0) clearPublishedKeyboardState()
    }
  }, [isEnabled])

  useEffect(() => {
    if (!isEnabled) return
    publishKeyboardState(state)
  }, [isEnabled, state])

  //Read at render from the committed height — a prediction or a held shrink included — so the
  //unpaid part is right in the same commit whichever of the resize and the report came first. The
  //seam reports a keyboard no viewport paid for.
  const { unpaidHeight, resizesLayoutViewport } = readKeyboardMock()
    ? { unpaidHeight: state.height, resizesLayoutViewport: false }
    : measureKeyboardPayment(state.height)

  return useMemo(
    () => ({ ...state, unpaidHeight, resizesLayoutViewport }),
    [state, unpaidHeight, resizesLayoutViewport],
  )
}

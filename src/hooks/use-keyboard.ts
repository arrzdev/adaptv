import { useEffect, useRef, useState } from "react"
import {
  hasNativeKeyboard,
  subscribeNativeKeyboard,
} from "#adaptv/capabilities/keyboard"
import {
  predictKeyboardHeight,
  recordKeyboardHeight,
} from "#adaptv/capabilities/keyboard-height-cache"

//---- Text-input detection ----------------

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

//---- VirtualKeyboard API ----------------

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

function getActiveInputElement() {
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

//---- Test seam ----------------

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

type KeyboardMockHost = { [KEYBOARD_MOCK_KEY]?: Partial<KeyboardState> }

function readKeyboardMock(): KeyboardState | null {
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

//---- Root publication ----------------

/*
 * The keyboard is a singleton, so its geometry belongs on `<html>` where any rule in
 * the app can see it — global chrome (a tab bar that lifts, a docked toolbar) must be
 * able to react without living inside an `<AvoidKeyboard>` subtree.
 *
 * `--adaptv-keyboard-height` (STYLING.md §4) is a measured scalar: continuous, and it
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

function publishKeyboardState({ isOpen, height }: KeyboardState) {
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

//---- Hook ----------------

export type KeyboardState = {
  /** `true` while a text field is focused and the on-screen keyboard is up. */
  isOpen: boolean
  /** Live keyboard height in px (0 when closed). */
  height: number
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
   * lifting on the same frame as the tap instead of waiting for `visualViewport` to report the
   * keyboard (default `false`). The real measurement then confirms or corrects the guess, and a
   * prediction that no keyboard confirms retracts. Web/PWA path only — native already reports the
   * exact height, and the mock path drives the value directly. Opt-in while it is proven on-device.
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
// this long waiting for a real measurement. The keyboard's own slide is ~250ms, so the window has
// to clear that — retract sooner and a genuine keyboard gets killed mid-appearance and flickers
// back. If nothing ever materialises (hardware keyboard, programmatic focus, a readonly field the
// gate missed), the prediction retracts at the end of this window and the sheet settles back.
const KEYBOARD_PREDICT_CONFIRM_MS = 400

// Same discipline for a height DECREASE while already open: switching fields makes iOS emit
// transient mid-animation dips (device-measured: 380 → 335 → 380 within ~85ms) that must not
// re-aim consumers twice per switch. A dropped height only commits after it holds for this
// long — re-read LIVE at fire time, so what commits is always the current geometry, never a
// remembered value. A genuine shrink (the QuickType bar hiding: 380 → 340) holds and lands as
// ONE settled update. Increases and the first raise commit immediately (see syncKeyboardState).
const KEYBOARD_HEIGHT_CONFIRM_MS = 120

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
  const [state, setState] = useState<KeyboardState>({
    isOpen: false,
    height: 0,
  })

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

    function setKeyboardState(nextState: KeyboardState) {
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
      const unsubscribe = subscribeNativeKeyboard((info) => setState(info))
      return () => {
        unsubscribe()
        setState({ isOpen: false, height: 0 })
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

  return state
}

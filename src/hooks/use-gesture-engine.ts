import { useCallback, useEffect, useRef } from "react"

export type GestureState =
  | "idle"
  //pointer down and within the press region — native UIControl `isPressed = true`
  | "pressing"
  //pointer down but dragged outside the press region — `isPressed = false`, yet
  //fully recoverable: slide back in and it returns to `pressing`
  | "outside"
  //a long-press was recognized; the hold/drag now owns the gesture
  | "longpress"
  //a hard cancel (scroll-steal, capture loss, disabled mid-press) — never fires
  | "cancelled"
export type GestureEvent = React.PointerEvent | React.KeyboardEvent

//press-region margin tuned per input: a fingertip wobbles far more than a mouse
//cursor, so touch gets a roomier margin around the element's frame before the
//press is read as "outside". used only when the caller doesn't pin pressOutset.
//touch is generous — a normal tap drifts ~35px on release (measured on device).
//
//EXPORTED because `useClickFix` has to agree with them. It serves the case this
//engine structurally cannot — a hit target with no frame of its own, drawn inside
//a canvas — so it measures travel where this measures containment. Two budgets
//for "was that a tap" would mean a button and a canvas shape disagreeing about
//the same finger on the same screen.
export const TOUCH_PRESS_OUTSET_PX = 24
export const POINTER_PRESS_OUTSET_PX = 6
//how far the pointer may travel from the press anchor before the *pending*
//long-press is abandoned (distance mode). mirrors UILongPressGestureRecognizer's
//allowableMovement (10pt). the tap itself is unaffected — it tracks the frame.
const LONG_PRESS_MAX_DISTANCE_PX = 10
//SwiftUI `onLongPressGesture` minimumDuration default
const DEFAULT_LONG_PRESS_MS = 500

export interface UseGestureEngineOptions {
  /** Pointer/keyboard went down on the element. Native `isPressed = true`. */
  onPressDown?: (e: GestureEvent) => void
  /** Released inside the press region without a long-press — the tap. */
  onPressUp?: (e: GestureEvent) => void
  /** Long-press recognized at the threshold, while still held (native `perform`). */
  onLongPressDown?: (e: GestureEvent) => void
  /** Pointer moved after the long-press fired — the drag phase of a held gesture. */
  onLongPressMove?: (e: React.PointerEvent) => void
  /** Released after a long-press fired (native sequenced gesture `onEnded`). */
  onLongPressUp?: (e: GestureEvent) => void
  onStateChange?: (state: GestureState) => void
  /** Hold (ms) before a long-press is recognized. @default 500 */
  longPressThreshold?: number
  /**
   * Travel (px) past which a *pending* long-press is abandoned (distance mode).
   * Only the long-press is affected — the tap tracks the frame, not this budget.
   * @default {@link LONG_PRESS_MAX_DISTANCE_PX}
   */
  longPressMaxDistance?: number
  /**
   * Margin (px) added around the element frame for the reentrant press region —
   * the area within which the press stays armed and the visual stays lit. Larger
   * values forgive more finger drift on small targets. Defaults to a
   * pointer-adaptive budget ({@link TOUCH_PRESS_OUTSET_PX} touch /
   * {@link POINTER_PRESS_OUTSET_PX} mouse/pen).
   */
  pressOutset?: number
  /**
   * What abandons a *pending* long-press:
   * - `"distance"` — travel past {@link longPressMaxDistance} from the anchor.
   * - `"leave"` — the pointer leaving the press region.
   * @default "distance"
   */
  slopMode?: "distance" | "leave"
  /**
   * Once a long-press fires, block page scroll (non-passive `touchmove`
   * `preventDefault`) so the hold can own a drag. @default true
   */
  claimPointerOnLongPress?: boolean
  /** Disables all gesture interactions and automatically drops events */
  disabled?: boolean
}

export interface GestureHandlers {
  /**
   * Boolean-presence marker (§3.1) saying "this node's press state is engine-owned".
   * Read by the patched `active:` variant (styles/patches.css), which sends a marked
   * element to `[data-pressed]` and everything else to native `:active` — so a
   * consumer's own `<button className="active:scale-95">` keeps working while an
   * engine target gets the reentrant, JS-clearable state instead.
   *
   * It rides in the handler bag rather than being written from a mount effect, and
   * that is the correctness argument, not a shortcut: the engine holds no ref of its
   * own (it reads `e.currentTarget` — see `PressableSlotProps`, where adding one
   * would break every `render` target narrower than `HTMLElement`, and Button, which
   * already composes two owners onto its host ref). Riding the bag also makes the
   * marker *exactly* co-extensive with the engine — spread the handlers and you have
   * it, forget to and there is no engine to mismatch — and it lands with the first
   * paint, so there is no frame in which `:active` and the engine both apply.
   */
  "data-press-engine": string
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerCancel: (e: React.PointerEvent) => void
  //an unexpected capture loss (node removed, capture stolen by an ancestor swipe)
  //mid-press is a hard cancel — this is how a sibling gesture that steals the
  //pointer (e.g. AppSwipeable) vetoes the tap without an explicit cancel() call
  onLostPointerCapture: (e: React.PointerEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
  onKeyUp: (e: React.KeyboardEvent) => void
  //capture phase runs ancestor-first, so this swallows the trailing click of a
  //moved / cancelled / long-pressed gesture before any descendant sees it
  onClickCapture: (e: React.MouseEvent) => void
  onClick: (e: React.MouseEvent) => void
}

/** Omit native handler props owned by {@link useGestureEngine}. */
export type OmitGestureEngineHandlers<T> = Omit<T, keyof GestureHandlers>

//the engine mirrors the live press state onto the element as `data-pressed`, the
//single source of truth for press feedback. it is reentrant (toggles as the
//finger leaves and re-enters the region) and pointer-only — keyboard activation
//never lights it, so Enter/Space don't trigger a press-scale animation.
//the patched `active:` variant reads this attribute; `data-press-engine` (in the
//returned handler bag) is what tells the variant to read it HERE and not `:active`.
/*
 * Ported from Ionic Framework (MIT, © 2015-present Drifty Co.)
 * core/src/utils/tap-click/index.ts — `ADD_ACTIVATED_DEFERS` / `CLEAR_STATE_DEFERS`.
 *
 * Why: a press visual applied on `pointerdown` flashes on every touch that turns
 * out to be a SCROLL. Ionic's note is exact — "tap click effects such as the ripple
 * effect should not happen when scrolling… `pointercancel` is dispatched on a
 * gesture when scrolling starts, so this lets us avoid having to listen for
 * ion-content's scroll events". Waiting 100ms before showing anything means the
 * cancel almost always arrives first, and the user who laid a finger down and
 * swiped never sees the button light up.
 */
const SHOW_PRESSED_AFTER_MS = 100

/*
 * …and the mirror of it. A tap shorter than the show-delay would otherwise render
 * NO feedback at all, so a press that ends early still shows, for at least this
 * long. Ionic's `CLEAR_STATE_DEFERS`.
 */
const MIN_PRESSED_MS = 150

const PRESSED_ATTR = "data-pressed"

function setPressedFlag(el: HTMLElement | null, pressed: boolean) {
  if (!el) return
  if (pressed) {
    el.setAttribute(PRESSED_ATTR, "")
    return
  }
  el.removeAttribute(PRESSED_ATTR)
}

function isWithinRegion(
  rect: DOMRect,
  x: number,
  y: number,
  outset: number,
): boolean {
  return (
    x >= rect.left - outset &&
    x <= rect.right + outset &&
    y >= rect.top - outset &&
    y <= rect.bottom + outset
  )
}

export function useGestureEngine({
  onPressDown,
  onPressUp,
  onLongPressDown,
  onLongPressMove,
  onLongPressUp,
  onStateChange,
  longPressThreshold = DEFAULT_LONG_PRESS_MS,
  longPressMaxDistance = LONG_PRESS_MAX_DISTANCE_PX,
  pressOutset,
  slopMode = "distance",
  claimPointerOnLongPress = true,
  disabled = false,
}: UseGestureEngineOptions): GestureHandlers {
  //--- press/tap track (reentrant) ------------------------------------------
  const active = useRef(false)
  //pointer is currently within the press region — drives the visual + whether a
  //release counts as a tap. flips freely as the finger leaves and re-enters
  const inside = useRef(false)
  //--- long-press track (terminal once it fails) ----------------------------
  const longPressFired = useRef(false)
  //moved too far / left the region before the threshold: the long-press can no
  //longer recognize for this press, but the tap stays live (two independent
  //tracks — exactly how native runs UIControl tracking alongside a recognizer)
  const longPressFailed = useRef(false)
  //--- shared ---------------------------------------------------------------
  //armed when a gesture resolves as anything but a clean in-region tap (drag
  //off, cancel, or long-press). the next click on this element is then swallowed
  const suppressClick = useRef(false)
  const anchorX = useRef(0)
  const anchorY = useRef(0)
  const isKeyboard = useRef(false)
  const lpTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  //the deferred SHOW, and the wall-clock the visual actually appeared at — the
  //minimum-duration guarantee needs to know how long it has already been up
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shownAt = useRef(0)
  //budgets resolved per-press from the pointer type
  const outset = useRef(POINTER_PRESS_OUTSET_PX)
  const maxDistance = useRef(LONG_PRESS_MAX_DISTANCE_PX)
  //frame captured at press-start; the region is this rect grown by `outset`
  const targetRect = useRef<DOMRect | null>(null)
  //the element this gesture is bound to — carries data-pressed + the scroll guard
  const pressTargetEl = useRef<HTMLElement | null>(null)
  //non-passive touchmove guard that reclaims the pointer once a long-press owns
  //it (iOS can't change touch-action mid-touch, so preventDefault is the only way)
  const touchGuard = useRef<((e: TouchEvent) => void) | null>(null)

  //a press may only be promoted to a long-press if someone is listening. otherwise
  //a tap-only control held past the threshold would resolve as a long-press and
  //skip onPressUp — the tap silently never fires (the classic "nothing happened")
  const wantsLongPress = Boolean(
    onLongPressDown || onLongPressMove || onLongPressUp,
  )

  const notifyState = useCallback(
    (s: GestureState) => onStateChange?.(s),
    [onStateChange],
  )

  const detachTouchGuard = useCallback(() => {
    if (touchGuard.current && pressTargetEl.current) {
      pressTargetEl.current.removeEventListener(
        "touchmove",
        touchGuard.current,
      )
    }
    touchGuard.current = null
  }, [])

  /*
   * The press visual is SCHEDULED, never immediate.
   *
   * `showPressed` arms a {@link SHOW_PRESSED_AFTER_MS} timer instead of setting the
   * attribute, so a touch that the browser turns into a scroll — which arrives as
   * `pointercancel` — is cancelled before anything is drawn. That is the whole
   * reason a finger laid down and swiped must not light the control up.
   *
   * `hidePressed` is the mirror: once the visual IS up it stays for at least
   * {@link MIN_PRESSED_MS}, so a fast tap is still visible. `force` skips that for
   * the cases where the press is genuinely over and the visual must go now (unmount,
   * long-press taking over, a cancel that arrived after the visual was already up).
   */
  const clearPressTimers = useCallback(() => {
    if (showTimer.current !== null) {
      clearTimeout(showTimer.current)
      showTimer.current = null
    }
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }, [])

  const showPressed = useCallback((el: HTMLElement) => {
    if (showTimer.current !== null) clearTimeout(showTimer.current)
    //a pending hide belongs to the press this one replaces; letting it fire would
    //blank the NEW visual mid-press (two fast taps, or a drag back in under 150ms)
    if (hideTimer.current !== null) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    showTimer.current = setTimeout(() => {
      showTimer.current = null
      shownAt.current = Date.now()
      setPressedFlag(el, true)
    }, SHOW_PRESSED_AFTER_MS)
  }, [])

  const hidePressed = useCallback((force = false) => {
    const el = pressTargetEl.current
    //still pending: it was never drawn, so drop it and leave nothing behind
    if (showTimer.current !== null) {
      clearTimeout(showTimer.current)
      showTimer.current = null
      setPressedFlag(el, false)
      return
    }
    if (force || shownAt.current === 0) {
      setPressedFlag(el, false)
      shownAt.current = 0
      return
    }
    const remaining = MIN_PRESSED_MS - (Date.now() - shownAt.current)
    if (remaining <= 0) {
      setPressedFlag(el, false)
      shownAt.current = 0
      return
    }
    //hold the element itself, not the ref: the press may be torn down before this
    //fires and the ref is nulled on cleanup
    const target = el
    if (hideTimer.current !== null) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null
      shownAt.current = 0
      setPressedFlag(target, false)
    }, remaining)
  }, [])

  const cleanup = useCallback(() => {
    active.current = false
    inside.current = false
    longPressFired.current = false
    longPressFailed.current = false
    isKeyboard.current = false
    targetRect.current = null
    hidePressed()
    detachTouchGuard()
    pressTargetEl.current = null
    if (showTimer.current !== null) {
      clearTimeout(showTimer.current)
      showTimer.current = null
    }
    if (lpTimer.current !== null) {
      clearTimeout(lpTimer.current)
      lpTimer.current = null
    }
  }, [detachTouchGuard, hidePressed])

  const clearLongPressTimer = useCallback(() => {
    if (lpTimer.current !== null) {
      clearTimeout(lpTimer.current)
      lpTimer.current = null
    }
  }, [])

  const startLongPressTimer = useCallback(
    (e: GestureEvent) => {
      if (!wantsLongPress) return
      lpTimer.current = setTimeout(() => {
        if (!active.current || longPressFailed.current) return
        longPressFired.current = true
        //the hold is no longer a tap — drop the press visual so the consumer can
        //apply its own long-press feedback (lift, menu, drag handle, …). Forced:
        //the minimum-duration guarantee is about perceiving a TAP, and this is not one.
        hidePressed(true)
        notifyState("longpress")
        onLongPressDown?.(e)
      }, longPressThreshold)
    },
    [
      notifyState,
      onLongPressDown,
      longPressThreshold,
      wantsLongPress,
      hidePressed,
    ],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return
      if (e.button !== 0 || !e.isPrimary) return

      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)

      cleanup()
      //a fresh press starts clean; only this gesture's own outcome may re-arm it
      suppressClick.current = false
      active.current = true
      inside.current = true
      anchorX.current = e.clientX
      anchorY.current = e.clientY
      outset.current =
        pressOutset ??
        (e.pointerType === "touch"
          ? TOUCH_PRESS_OUTSET_PX
          : POINTER_PRESS_OUTSET_PX)
      maxDistance.current = longPressMaxDistance
      targetRect.current = el.getBoundingClientRect()
      pressTargetEl.current = el
      //SCHEDULE the visual; do not stamp it. A touch that becomes a scroll is
      //cancelled inside the delay and must never have lit up. (Keyboard never does.)
      showPressed(el)

      //arm the scroll guard up-front; it only bites once the long-press fires
      if (wantsLongPress && claimPointerOnLongPress) {
        const guard = (ev: TouchEvent) => {
          if (longPressFired.current) ev.preventDefault()
        }
        el.addEventListener("touchmove", guard, { passive: false })
        touchGuard.current = guard
      }

      notifyState("pressing")
      onPressDown?.(e)

      startLongPressTimer(e)
    },
    [
      cleanup,
      notifyState,
      onPressDown,
      startLongPressTimer,
      disabled,
      pressOutset,
      longPressMaxDistance,
      claimPointerOnLongPress,
      wantsLongPress,
      showPressed,
    ],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || !e.isPrimary || !active.current) return

      //after a long-press fires, the hold owns the gesture: forward the drag and
      //stop toggling the tap region
      if (longPressFired.current) {
        onLongPressMove?.(e)
        return
      }

      const rect = targetRect.current
      if (rect) {
        const within = isWithinRegion(
          rect,
          e.clientX,
          e.clientY,
          outset.current,
        )
        //reentrant: the visual and tap-armed state follow region membership
        if (within !== inside.current) {
          inside.current = within
          if (within) {
            const el = pressTargetEl.current
            if (el) showPressed(el)
          } else {
            hidePressed(true)
          }
          notifyState(within ? "pressing" : "outside")
        }
      }

      //abandon a pending long-press once travel/leave exceeds its budget. this is
      //the long-press track only — the tap above stays armed by frame containment
      if (wantsLongPress && !longPressFailed.current) {
        let exceeded = false
        if (slopMode === "leave") {
          exceeded = !inside.current
        } else {
          const dx = Math.abs(e.clientX - anchorX.current)
          const dy = Math.abs(e.clientY - anchorY.current)
          exceeded = Math.max(dx, dy) > maxDistance.current
        }
        if (exceeded) {
          longPressFailed.current = true
          clearLongPressTimer()
        }
      }
    },
    [
      disabled,
      slopMode,
      notifyState,
      onLongPressMove,
      clearLongPressTimer,
      wantsLongPress,
      showPressed,
      hidePressed,
    ],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (disabled || !e.isPrimary || !active.current) return

      const wasLongPress = longPressFired.current
      const wasInside = inside.current

      cleanup()
      notifyState("idle")

      if (wasLongPress) {
        //a completed hold is not a tap — swallow the click the browser fires on
        //release so a held control never also activates on let-go
        suppressClick.current = true
        onLongPressUp?.(e)
        return
      }

      if (wasInside) {
        onPressUp?.(e)
        return
      }
      //released outside the region — no activation; veto any trailing click
      suppressClick.current = true
    },
    [cleanup, notifyState, onPressUp, onLongPressUp, disabled],
  )

  const onPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      if (!e.isPrimary) return
      //a cancel (scroll-hijack, platform steal) is not a tap; swallow any trailing
      //click and report it distinctly from a clean release
      suppressClick.current = true
      cleanup()
      notifyState("cancelled")
    },
    [cleanup, notifyState],
  )

  const onLostPointerCapture = useCallback(() => {
    //capture is released normally on up/cancel, which already cleaned up — so only
    //an unexpected loss mid-press matters. once a long-press has fired the consumer
    //owns the pointer and ends it via up/cancel, so leave that case alone and only
    //rescue a wedged tap (also the path a sibling swipe uses to veto this tap)
    if (!active.current || longPressFired.current) return
    suppressClick.current = true
    cleanup()
    notifyState("cancelled")
  }, [cleanup, notifyState])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return
      if (e.key !== "Enter" && e.key !== " ") return
      if (e.repeat) return

      cleanup()
      active.current = true
      inside.current = true
      isKeyboard.current = true
      //no data-pressed: keyboard activation must not animate (motion contract)
      notifyState("pressing")
      onPressDown?.(e)

      startLongPressTimer(e)
    },
    [cleanup, notifyState, onPressDown, startLongPressTimer, disabled],
  )

  const onKeyUp = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return
      if (e.key !== "Enter" && e.key !== " ") return
      if (!active.current || !isKeyboard.current) return

      const wasLongPress = longPressFired.current

      cleanup()
      notifyState("idle")

      if (wasLongPress) {
        onLongPressUp?.(e)
        return
      }
      onPressUp?.(e)
    },
    [cleanup, notifyState, onPressUp, onLongPressUp, disabled],
  )

  //capture phase runs ancestor-first, so this fires before any descendant's
  //onClick. only swallow when armed (moved off / cancel / long-press); a clean
  //tap is left alone so a nested control still activates on a real tap
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!suppressClick.current) return
    suppressClick.current = false
    e.preventDefault()
    e.stopPropagation()
  }, [])

  //this element owns activation via onPressUp, so a stray native click on it (a
  //synthetic touch click, or a label's implicit input toggle) is always
  //swallowed — the engine, not the browser, decides when activation fires
  const onClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  //cancel an in-flight gesture if the control is disabled mid-press, so it can't
  //get stuck active with a live timer / lit visual
  useEffect(() => {
    if (!disabled || !active.current) return
    suppressClick.current = true
    cleanup()
    notifyState("cancelled")
  }, [disabled, cleanup, notifyState])

  //tear down a gesture left in flight when the component unmounts
  useEffect(() => {
    return () => {
      cleanup()
      //`cleanup` may have left a hide PENDING to honour the minimum press duration.
      //There is nothing left to look at after unmount, so drop it rather than fire a
      //timer against a detached node.
      clearPressTimers()
    }
  }, [cleanup, clearPressTimers])

  return {
    //`""`, not `true`: React stringifies a boolean data-* value to "true", and this
    //is a presence attribute (§3.1) — the same shape as data-pressed above.
    "data-press-engine": "",
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    onKeyDown,
    onKeyUp,
    onClickCapture,
    onClick,
  }
}

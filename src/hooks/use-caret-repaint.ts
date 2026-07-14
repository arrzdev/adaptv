import { useEffect } from "react"
import { willOpenVirtualKeyboard } from "#nativ/hooks/use-keyboard"

/*
 * App-wide iOS caret-repaint patch.
 *
 * On iOS WebKit the text caret is painted by the system on a separate overlay layer that does
 * NOT track CSS `transform` / JS-driven movement in real time — it only re-syncs on a layout /
 * selection / scroll event. So a focused field that is translated (drawer slide, keyboard lift,
 * scroll, page transition) leaves a detached "ghost" caret blinking at the old spot. We mute the
 * caret while the field moves, then force a repaint once it settles.
 *
 * Reliability notes (the hard cases are momentum scrolling):
 * - **Muting is proactive where possible, reactive as fallback.** The rect poll can only mute a
 *   frame or two AFTER movement starts — and the mute itself needs a paint + an IPC round-trip
 *   to reach the UI-process caret view — so purely reactive detection always leaks a few ghost
 *   frames at motion start. Known movers (drawer tweens, keyboard lift, programmatic scrolls)
 *   therefore announce themselves via {@link beginCaretHold} BEFORE their first moved frame,
 *   and a document `touchstart` pre-mutes for the one mover with no advance signal: a user
 *   scroll (the finger lands before the first scrolled frame).
 * - **Settle is a debounced quiet-window, not a frame count.** A momentum scroll's deceleration
 *   tail jitters around the move threshold; restoring on "2 still frames" then re-muting on the
 *   next jittery frame makes the caret flicker on/off. Instead every detected movement pushes the
 *   restore deadline out, so the caret comes back exactly once, after the field is truly still.
 * - **Scroll + visualViewport feed the settle directly.** iOS throttles rAF during momentum
 *   scrolling, so the per-frame rect poll can stall; scroll/viewport events keep movement tracked.
 * - **Restore PERTURBS the selection (when the field actually moved).** Removing `caret-color`
 *   and re-asserting the SAME range is a no-op WebKit ignores, so the caret stays at its stale
 *   pre-scroll offset — fine for an empty field (offset 0) but it never re-syncs once there's
 *   text. So we briefly move the selection to a different offset, reflow, then restore it: a real
 *   selection change forces WebKit to recompute the caret rect. Gated to real translations so it
 *   never pokes the caret on a plain focus / while typing.
 * - **After restore, re-seed the movement baseline.** The perturbation can nudge the field's
 *   internal scroll a hair; re-seeding stops the next frame reading that as fresh movement and
 *   re-muting (restore → re-mute → restore is a visible blink).
 *
 * KNOWN LIMITATION: the caret is the only iOS text overlay we can control (via `caret-color`).
 * The autocorrect / spellcheck suggestion popover, misspelled-word underline, selection handles,
 * magnifier loupe, and Cut/Copy/Paste callout are all system-rendered with NO web hook to
 * reposition, mute, or repaint — they visibly detach on scroll exactly like the caret did, and
 * there is no fix. The only mitigation is to stop them appearing: set `autocorrect="off"` +
 * `spellcheck={false}` STATICALLY per field (a product tradeoff — you lose inline corrections;
 * toggling them dynamically does NOT dismiss an already-shown overlay).
 */

//movement (px) between observations that counts as motion; below this is sub-pixel layout
//jitter, not a real translation
const CARET_MOVE_THRESHOLD_PX = 0.5
//quiet window after the last detected movement before the caret is restored. Long enough to ride
//out a momentum-scroll deceleration tail without flicker, short enough to feel immediate on stop.
const CARET_SETTLE_MS = 120

//---- movement holds ----------------

//module-level so non-React movers (drawer motion helpers, scroll utilities) can announce
//without a hook dependency; the single app-wide controller registers itself here
let caretHoldCount = 0
let onCaretHoldsChange: ((count: number) => void) | null = null

/**
 * Announce an imminent translation of the focused text field (drawer tween, keyboard lift,
 * programmatic smooth scroll) so the caret is muted BEFORE the first moved frame instead of a
 * few ghost frames after. Returns a release; while any hold is active the caret stays muted.
 * Releasing starts the normal settle/restore cycle, so it is safe to release immediately after
 * kicking off a fire-and-forget scroll — observed movement keeps extending the quiet window.
 * No-ops when no text field is focused.
 */
export function beginCaretHold(): () => void {
  caretHoldCount++
  onCaretHoldsChange?.(caretHoldCount)
  let released = false
  return function releaseCaretHold() {
    if (released) return
    released = true
    caretHoldCount--
    onCaretHoldsChange?.(caretHoldCount)
  }
}

function isTextEntry(
  el: HTMLElement,
): el is HTMLInputElement | HTMLTextAreaElement {
  return (
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
  )
}

export function useCaretRepaint({
  enabled = true,
}: {
  enabled?: boolean
} = {}) {
  useEffect(() => {
    if (!enabled) return
    if (typeof document === "undefined") return

    let field: HTMLElement | null = null
    let rafId: number | null = null
    let settleTimer: ReturnType<typeof setTimeout> | null = null
    let lastTop = 0
    let lastLeft = 0
    let muted = false
    let composing = false
    //true once the field actually translated during this mute session (scroll / drawer / keyboard),
    //vs a plain focus mute. Only a real translation desyncs the caret position, so only then do we
    //pay the selection-perturbation re-sync (which we don't want poking the caret on every focus).
    let movedWhileMuted = false

    function mute() {
      if (!field || muted) return
      field.setAttribute("data-caret-muted", "true")
      muted = true
    }

    function repaintCaret(el: HTMLElement) {
      //force a layout flush so WebKit recomputes the detached caret overlay. Both reads matter
      //empirically — offsetHeight forces the reflow, and the rect read nudges the caret-overlay
      //update (dropping it lets the caret stay invisible after a scroll-away/back). Don't "simplify".
      void el.offsetHeight
      el.getBoundingClientRect()
      //Only re-sync the caret POSITION after a real translation, and only for text fields. The
      //reflow above is enough for an empty field / a plain focus (caret at offset 0), but once
      //there's text the caret sits at offset N and stays stale until a genuine selection change.
      if (!movedWhileMuted || composing || !isTextEntry(el)) return
      try {
        const { selectionStart, selectionEnd, selectionDirection } = el
        if (selectionStart === null || selectionEnd === null) return
        //Re-asserting the SAME range is a no-op, so WebKit leaves the caret where it was (stale).
        //Perturb to a DIFFERENT collapsed offset, force a reflow, then restore the real selection:
        //that genuine change makes WebKit recompute the caret rect at the right spot. The probe
        //offset never paints — it's all synchronous before the next frame.
        const probe = selectionStart > 0 ? 0 : Math.min(1, el.value.length)
        el.setSelectionRange(probe, probe)
        void el.offsetHeight
        el.setSelectionRange(
          selectionStart,
          selectionEnd,
          selectionDirection ?? undefined,
        )
      } catch {
        //input types that don't support selection throw on access/set — nothing to repaint
      }
    }

    function restore() {
      if (!field || !muted) return
      field.removeAttribute("data-caret-muted")
      muted = false
      repaintCaret(field)
      //Re-seed the movement baseline to the POST-perturbation position. repaintCaret's
      //setSelectionRange can nudge the field's internal scroll a hair; without this re-seed the
      //next frame compares against the pre-perturbation baseline, reads that nudge as fresh
      //movement, and re-mutes → restore → re-mute. That round-trip is a visible blink. Real
      //continued scrolling is still caught (only this one frame's delta is absorbed).
      observeMovement()
      movedWhileMuted = false
    }

    function clearSettleTimer() {
      if (settleTimer === null) return
      clearTimeout(settleTimer)
      settleTimer = null
    }

    //read the current rect, returning whether it moved past the threshold since the last
    //observation, and update the baseline either way
    function observeMovement() {
      if (!field) return false
      const rect = field.getBoundingClientRect()
      const moved =
        Math.abs(rect.top - lastTop) > CARET_MOVE_THRESHOLD_PX ||
        Math.abs(rect.left - lastLeft) > CARET_MOVE_THRESHOLD_PX
      lastTop = rect.top
      lastLeft = rect.left
      return moved
    }

    //(re)start the quiet-window countdown. Each movement pushes restore further out, so the
    //caret only returns once the field has fully stopped — no on/off toggling during decel.
    function markMoving() {
      mute()
      clearSettleTimer()
      settleTimer = setTimeout(attemptRestore, CARET_SETTLE_MS)
    }

    //single detect-and-mark step, shared by the rAF poll and the scroll/viewport listeners
    function pump() {
      if (!field) return
      if (!observeMovement()) return
      movedWhileMuted = true
      markMoving()
    }

    function attemptRestore() {
      settleTimer = null
      if (!field || !muted) return
      //a known mover still holds the caret — stay muted; its release restarts the settle
      if (caretHoldCount > 0) return
      //a sparse momentum tick can fire this mid-scroll — re-measure and reschedule rather than
      //un-muting over a field that's still moving
      if (observeMovement()) {
        movedWhileMuted = true
        markMoving()
        return
      }
      restore()
    }

    function track(target: HTMLElement) {
      restore() //repaint whatever we were tracking before re-pointing
      field = target
      movedWhileMuted = false
      observeMovement() //seed the baseline
      //mute on every focus so even a stationary focus-switch gets a forced repaint cycle —
      //WebKit otherwise leaves the new field's caret unpainted until a second tap
      markMoving()
      if (rafId === null) rafId = requestAnimationFrame(watch)
    }

    function detach() {
      restore()
      clearSettleTimer()
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      field = null
    }

    function watch() {
      rafId = null
      if (!field) return
      if (document.activeElement !== field) {
        detach()
        return
      }
      //transform-driven movement (drawer slide, keyboard lift, page transition) emits no DOM
      //events, so poll the rect each frame; scroll/viewport movement is caught here too
      pump()
      rafId = requestAnimationFrame(watch)
    }

    function handleFocusIn(event: FocusEvent) {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      if (!willOpenVirtualKeyboard(target)) return
      track(target)
    }

    function handleFocusOut(event: FocusEvent) {
      if (event.target !== field) return
      detach()
    }

    function handleCompositionStart() {
      composing = true
    }

    function handleCompositionEnd() {
      composing = false
    }

    //user scrolls are the one mover with no advance signal, but the finger always lands before
    //the first scrolled frame — pre-mute on touchstart so the ghost never paints. A touch that
    //moves nothing just restores through the quiet window; touches on the system keyboard never
    //reach the page, so typing is unaffected.
    function handleTouchStart() {
      if (!field) return
      markMoving()
    }

    function handleHoldsChange(count: number) {
      if (!field) return
      if (count > 0) {
        mute()
        clearSettleTimer()
        return
      }
      //last mover released — run the normal settle so the caret restores once truly still
      markMoving()
    }

    document.addEventListener("focusin", handleFocusIn, true)
    document.addEventListener("focusout", handleFocusOut, true)
    //scroll events don't bubble — capture catches them from any inner scroller. Keeps the settle
    //alive when iOS throttles rAF during momentum scrolling.
    document.addEventListener("scroll", pump, {
      capture: true,
      passive: true,
    })
    document.addEventListener(
      "compositionstart",
      handleCompositionStart,
      true,
    )
    document.addEventListener("compositionend", handleCompositionEnd, true)
    document.addEventListener("touchstart", handleTouchStart, {
      capture: true,
      passive: true,
    })
    window.visualViewport?.addEventListener("resize", pump)
    window.visualViewport?.addEventListener("scroll", pump)
    //single app-wide controller (mounted once by the shell) — last registration wins
    onCaretHoldsChange = handleHoldsChange

    return () => {
      if (onCaretHoldsChange === handleHoldsChange) {
        onCaretHoldsChange = null
      }
      document.removeEventListener("focusin", handleFocusIn, true)
      document.removeEventListener("focusout", handleFocusOut, true)
      document.removeEventListener("scroll", pump, true)
      document.removeEventListener(
        "compositionstart",
        handleCompositionStart,
        true,
      )
      document.removeEventListener(
        "compositionend",
        handleCompositionEnd,
        true,
      )
      document.removeEventListener("touchstart", handleTouchStart, true)
      window.visualViewport?.removeEventListener("resize", pump)
      window.visualViewport?.removeEventListener("scroll", pump)
      detach()
    }
  }, [enabled])
}

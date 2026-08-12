import { useEffect } from "react"
import { willOpenVirtualKeyboard } from "#adaptv/hooks/use-keyboard"

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
 * - **The poll only runs while something might be moving.** Sampling the rect forces style +
 *   layout, so polling for as long as a field merely HAS focus keeps the page off idle for the
 *   whole time someone is filling in a form — on the timeline, a FunctionCall and a Commit every
 *   frame, indefinitely, with nothing on screen moving. See {@link shouldWatch}.
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
//how long the rect poll keeps looking after a scroll / viewport event, in frames. The event says
//something is moving NOW, but the field's own rect may not have crossed the threshold yet on the
//frame the event arrives — and that event can be the last one of the burst. Frames, not ms,
//because this is a budget for the poll itself: iOS throttles rAF hard during a momentum scroll,
//and a wall-clock window would expire while the poll had barely looked. It is only a floor on
//looking, never on restoring — a movement it finds pushes out the quiet window as usual.
const CARET_WATCH_TAIL_FRAMES = 15

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
    let watchFrames = 0
    let lastTop = 0
    let lastLeft = 0
    let muted = false
    let composing = false
    //true once the field actually translated during this mute session (scroll / drawer / keyboard),
    //vs a plain focus mute. Only a real translation desyncs the caret position, so only then do we
    //pay the selection-perturbation re-sync (which we don't want poking the caret on every focus).
    let movedWhileMuted = false

    //The attribute is the public styling hook (§3); the INLINE `!important` is what
    //actually enforces the mute. adaptv's own `[data-caret-muted]` rule lives in
    //`@layer adaptv.patches` and would lose to any `caret-*` utility the field carries
    //(`utilities` is a later layer), and §6.0.1 bans the `!important` inside the layer
    //that used to cover for that. An inline important declaration sits above every
    //layer, which is exactly the "must win" semantics this needs.
    function mute() {
      if (!field || muted) return
      field.setAttribute("data-caret-muted", "true")
      field.style.setProperty("caret-color", "transparent", "important")
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
      field.style.removeProperty("caret-color")
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
      startWatching()
    }

    /*
     * Whether the poll has anything left to look for. Three things say "something might be
     * moving", and they are the three shapes of mover this patch knows about:
     *
     * - a declared mover holds the caret (a drawer tween, a keyboard lift) — its translation is
     *   pure transform, which emits no DOM event, so the rect is the only way to see it;
     * - the quiet window is still counting down, i.e. we saw movement within the last
     *   {@link CARET_SETTLE_MS} and it may not be over;
     * - a scroll / viewport event just fired, and the field may be about to move with it.
     *
     * Outside those, nothing can move the field without telling us first, and a frame spent
     * measuring is a forced layout bought for nothing. That makes {@link beginCaretHold} a
     * contract rather than an optimisation: a translation that declares no hold, and rides no
     * scroll, is one this patch can no longer see.
     */
    function shouldWatch() {
      return caretHoldCount > 0 || settleTimer !== null || watchFrames > 0
    }

    //Every path back into the poll goes through here, and the `rafId` guard is what keeps it ONE
    //loop. A frame that finds movement re-arms the quiet window from inside `watch`, which asks
    //for a frame; without the guard `watch`'s own tail would ask for a second one, `rafId` would
    //remember only the later, and every moved frame would fork the loop in two.
    function startWatching() {
      if (rafId !== null || !field) return
      rafId = requestAnimationFrame(watch)
    }

    /*
     * The poll used to be what noticed a field that stopped being focused without a `focusout`:
     * a closing drawer takes its input out of the DOM, and the browser moves focus to `<body>`
     * in silence. Now that the poll stops, every entry point re-checks instead — reading
     * `activeElement` is free, unlike the rect read the poll was paying for.
     */
    function fieldIsLive() {
      if (!field) return false
      if (document.activeElement === field) return true
      detach()
      return false
    }

    //single detect-and-mark step, shared by the rAF poll and the scroll/viewport listeners
    function pump() {
      if (!fieldIsLive()) return
      if (!observeMovement()) return
      movedWhileMuted = true
      markMoving()
    }

    //scroll and viewport events are the reactive half of the patch: they say something is moving
    //without saying whether the FIELD has moved yet. Arm the poll's tail so the frames right
    //after the event are watched, then let it fall quiet again if nothing came of it.
    function handleViewportMovement() {
      if (!fieldIsLive()) return
      watchFrames = CARET_WATCH_TAIL_FRAMES
      pump()
      startWatching()
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
      markMoving() //also starts the poll: the mute opens a quiet window to watch out
    }

    function detach() {
      restore()
      clearSettleTimer()
      watchFrames = 0
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      field = null
    }

    function watch() {
      rafId = null
      if (!fieldIsLive()) return
      if (watchFrames > 0) watchFrames--
      //transform-driven movement (drawer slide, keyboard lift, page transition) emits no DOM
      //events, so poll the rect each frame; scroll/viewport movement is caught here too
      pump()
      //spend the next frame only if something is still expected to move. `pump` re-arms the
      //quiet window whenever it finds movement, so a live translation keeps this true by itself
      //(and may already have booked the frame — hence going through `startWatching`).
      if (shouldWatch()) startWatching()
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
      if (!fieldIsLive()) return
      markMoving()
    }

    function handleHoldsChange(count: number) {
      if (!fieldIsLive()) return
      if (count > 0) {
        mute()
        clearSettleTimer()
        //a bracketed tween moves the field by transform and says nothing more until it releases,
        //so the poll is the only witness to where the field actually is meanwhile
        startWatching()
        return
      }
      //last mover released — run the normal settle so the caret restores once truly still
      markMoving()
    }

    document.addEventListener("focusin", handleFocusIn, true)
    document.addEventListener("focusout", handleFocusOut, true)
    //scroll events don't bubble — capture catches them from any inner scroller. Keeps the settle
    //alive when iOS throttles rAF during momentum scrolling.
    document.addEventListener("scroll", handleViewportMovement, {
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
    //`visualViewport` is optional chained because not every webview has it, and without this
    //`window` fallback such a webview would get NO viewport signal at all — the one platform
    //shape where the keyboard resizes the frame instead of the visual viewport.
    window.addEventListener("resize", handleViewportMovement)
    window.visualViewport?.addEventListener(
      "resize",
      handleViewportMovement,
    )
    window.visualViewport?.addEventListener(
      "scroll",
      handleViewportMovement,
    )
    //single app-wide controller (mounted once by the shell) — last registration wins
    onCaretHoldsChange = handleHoldsChange

    return () => {
      if (onCaretHoldsChange === handleHoldsChange) {
        onCaretHoldsChange = null
      }
      document.removeEventListener("focusin", handleFocusIn, true)
      document.removeEventListener("focusout", handleFocusOut, true)
      document.removeEventListener("scroll", handleViewportMovement, true)
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
      window.removeEventListener("resize", handleViewportMovement)
      window.visualViewport?.removeEventListener(
        "resize",
        handleViewportMovement,
      )
      window.visualViewport?.removeEventListener(
        "scroll",
        handleViewportMovement,
      )
      detach()
    }
  }, [enabled])
}

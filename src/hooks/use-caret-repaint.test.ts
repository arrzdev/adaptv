import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  beginCaretHold,
  preMuteCaret,
  useCaretRepaint,
} from "#adaptv/hooks/use-caret-repaint"

/*
 * When the caret comes back.
 *
 * The mute is easy and was never wrong. WHEN it un-mutes is the whole cost of this patch, and
 * it is paid where nobody was looking: restoring re-asserts the field's style and perturbs the
 * selection, which on a promoted sheet re-rasterises every glyph in it. On the timeline that
 * repaint was landing 120ms after a drawer had already stopped — the sheet arrived, and then it
 * shimmered.
 *
 * So the two shapes have to stay distinguishable. A BRACKET (`beginCaretHold`) is a mover that
 * knows when it ends: its release is the end, and the caret comes back on that frame. A PRE-MUTE
 * is a mover that does not — a smooth scroll, a finger — and only there is the quiet window
 * worth its latency.
 */

function focusedField(): HTMLInputElement {
  const field = document.createElement("input")
  field.type = "text"
  document.body.appendChild(field)
  field.focus()
  //the tracker attaches on focusin, and .focus() in happy-dom does not always bubble one
  field.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
  return field
}

const isMuted = (field: HTMLElement) =>
  field.hasAttribute("data-caret-muted")

describe("useCaretRepaint holds", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ""
  })

  it("mutes for a bracket and restores the moment it is released", () => {
    renderHook(() => useCaretRepaint())
    const field = focusedField()

    const release = beginCaretHold()
    expect(isMuted(field)).toBe(true)

    release()
    //no timer advanced: a drawer tween's release IS the end of the movement, and waiting a
    //quiet window here is what put the repaint on a settled sheet
    expect(isMuted(field)).toBe(false)
  })

  it("keeps the caret muted while any bracket is still open", () => {
    renderHook(() => useCaretRepaint())
    const field = focusedField()

    const first = beginCaretHold()
    const second = beginCaretHold()
    first()
    expect(isMuted(field)).toBe(true)

    second()
    expect(isMuted(field)).toBe(false)
  })

  it("makes a pre-mute wait out the quiet window instead", () => {
    renderHook(() => useCaretRepaint())
    const field = focusedField()

    preMuteCaret()
    expect(isMuted(field)).toBe(true)

    //a smooth scroll cannot say when it stopped, so this one has to be timed out
    vi.advanceTimersByTime(60)
    expect(isMuted(field)).toBe(true)

    vi.advanceTimersByTime(80)
    expect(isMuted(field)).toBe(false)
  })

  it("does nothing at all when no field is focused", () => {
    renderHook(() => useCaretRepaint())
    const release = beginCaretHold()
    expect(() => release()).not.toThrow()
    expect(document.querySelector("[data-caret-muted]")).toBeNull()
  })

  it("stays out of the way when the patch is switched off", () => {
    renderHook(() => useCaretRepaint({ enabled: false }))
    const field = focusedField()

    const release = beginCaretHold()
    expect(isMuted(field)).toBe(false)
    //the count lives on the module, not on the hook, so a hold left open here is one every
    //later test inherits — and "a mover is still holding the caret" is a state the patch acts on
    release()
  })

  it("leaves a field inside data-adaptv-no-caret-repaint alone", () => {
    renderHook(() => useCaretRepaint())
    const host = document.createElement("div")
    host.setAttribute("data-adaptv-no-caret-repaint", "")
    document.body.appendChild(host)
    const field = document.createElement("input")
    host.appendChild(field)
    field.focus()
    field.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))

    const release = beginCaretHold()
    expect(isMuted(field)).toBe(false)
    release()
  })
})

/*
 * When the poll stops.
 *
 * Sampling the rect is how transform-driven movement is seen at all, and it costs a forced
 * style + layout every frame it happens. Polling for as long as a field HAS focus therefore
 * prices a whole form-filling session at one layout per frame — on the timeline, a FunctionCall
 * and a Commit per frame, indefinitely, with the sheet long since arrived and nothing moving.
 *
 * These drive the frames by hand rather than letting the clock run them: a queued frame that is
 * never executed looks exactly like a poll that stopped, and a test that cannot tell those apart
 * would pass just as happily against the always-on loop it is here to rule out.
 */
function frameRunner() {
  const queue: FrameRequestCallback[] = []
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
    (cb) => {
      queue.push(cb)
      return queue.length
    },
  )
  return {
    pending: () => queue.length,
    //run up to `steps` of the frames currently queued; each may queue the next
    flush(steps: number) {
      for (let i = 0; i < steps; i++) {
        const next = queue.shift()
        if (!next) return i
        next(0)
      }
      return steps
    },
  }
}

//a field that keeps sliding, one observation at a time — the shape of a drawer tween, which
//moves by transform and so is invisible to everything except this rect read
function keepMoving(field: HTMLElement) {
  let top = 0
  field.getBoundingClientRect = () => {
    top += 10
    return {
      top,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect
  }
}

describe("useCaretRepaint polling", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    document.body.innerHTML = ""
  })

  //focus mutes and opens a quiet window, so the frames right after it are owed. Ride that out.
  function settle(frames: ReturnType<typeof frameRunner>) {
    vi.advanceTimersByTime(200)
    frames.flush(30)
  }

  it("stops polling once the field has settled", () => {
    const frames = frameRunner()
    renderHook(() => useCaretRepaint())
    const field = focusedField()

    settle(frames)
    expect(isMuted(field)).toBe(false)
    //nothing is moving and nothing has said it is about to: the next frame is not owed
    expect(frames.pending()).toBe(0)
  })

  it("keeps polling for as long as a bracket is open", () => {
    const frames = frameRunner()
    renderHook(() => useCaretRepaint())
    const field = focusedField()
    settle(frames)

    const release = beginCaretHold()
    //a bracketed tween moves the field by transform and says nothing until it releases, so the
    //poll is the only witness to where the field is meanwhile — and to whether it moved at all,
    //which is what decides if the restore re-syncs the caret POSITION or just repaints it
    expect(frames.pending()).toBe(1)
    frames.flush(30)
    expect(frames.pending()).toBe(1)
    expect(isMuted(field)).toBe(true)

    release()
    frames.flush(30)
    expect(isMuted(field)).toBe(false)
    expect(frames.pending()).toBe(0)
  })

  it("wakes on a scroll, then falls quiet again if the field never moved", () => {
    const frames = frameRunner()
    renderHook(() => useCaretRepaint())
    focusedField()
    settle(frames)

    //the reactive half: the event says SOMETHING is moving, not that the field is
    document.dispatchEvent(new Event("scroll"))
    expect(frames.pending()).toBe(1)

    //bounded — a scroll that never reaches the field must not leave the poll running
    const ran = frames.flush(60)
    expect(ran).toBeLessThan(60)
    expect(frames.pending()).toBe(0)
  })

  it("stays one loop when a frame finds movement", () => {
    const frames = frameRunner()
    renderHook(() => useCaretRepaint())
    const field = focusedField()
    settle(frames)
    keepMoving(field)

    /*
     * A frame that finds movement re-arms the quiet window from inside the poll, and re-arming
     * asks for a frame. If the poll's own tail asks for a second one, the single `rafId` remembers
     * only the later of the two and every moved frame forks the loop in half again — measured in
     * the playground as 5,494 frames scheduled across one drawer open, against 56 for one loop.
     */
    document.dispatchEvent(new Event("scroll"))
    for (let i = 0; i < 20; i++) {
      expect(frames.pending()).toBe(1)
      frames.flush(1)
    }
    expect(isMuted(field)).toBe(true)
  })
})

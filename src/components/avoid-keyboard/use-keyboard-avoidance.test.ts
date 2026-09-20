import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  computeScrollIntoViewTop,
  resolveAvoidanceSpace,
  resolveReservedSpace,
  useKeyboardAvoidance,
} from "#adaptv/components/avoid-keyboard/use-keyboard-avoidance"

describe("resolveAvoidanceSpace", () => {
  const viewportHeight = 800

  it("reserves nothing when the keyboard is closed", () => {
    expect(
      resolveAvoidanceSpace({
        containerBottom: 800,
        viewportHeight,
        keyboardHeight: 0,
      }),
    ).toBe(0)
  })

  it("reserves the overlap when the wrapper sits behind the keyboard", () => {
    //keyboard top = 800 - 300 = 500; wrapper bottom 800 → 300px hidden
    expect(
      resolveAvoidanceSpace({
        containerBottom: 800,
        viewportHeight,
        keyboardHeight: 300,
      }),
    ).toBe(300)
  })

  it("reserves only the hidden slice when the wrapper ends above the viewport bottom", () => {
    //keyboard top = 500; wrapper bottom 620 → 120px hidden
    expect(
      resolveAvoidanceSpace({
        containerBottom: 620,
        viewportHeight,
        keyboardHeight: 300,
      }),
    ).toBe(120)
  })

  it("reserves nothing when the wrapper ends above the keyboard line", () => {
    //keyboard top = 500; wrapper bottom 480 → no overlap
    expect(
      resolveAvoidanceSpace({
        containerBottom: 480,
        viewportHeight,
        keyboardHeight: 300,
      }),
    ).toBe(0)
  })
})

describe("computeScrollIntoViewTop", () => {
  //keyboardTop well below the 500px scroller bottom → line falls on the scroller bottom
  const base = {
    scrollTop: 0,
    scrollerTop: 0,
    scrollerBottom: 500,
    keyboardTop: 1000,
    topInset: 0,
    buffer: 24,
  }

  it("leaves scrollTop unchanged when the input already clears the keyboard line", () => {
    expect(
      computeScrollIntoViewTop({
        ...base,
        inputTop: 300,
        inputBottom: 340,
      }),
    ).toBe(0)
  })

  it("scrolls just enough to clear the keyboard line plus buffer", () => {
    //keyboard line = 500 - 24 = 476; input bottom 520 → delta 44
    expect(
      computeScrollIntoViewTop({
        ...base,
        inputTop: 480,
        inputBottom: 520,
      }),
    ).toBe(44)
  })

  it("adds the delta onto the current scrollTop", () => {
    expect(
      computeScrollIntoViewTop({
        ...base,
        scrollTop: 100,
        inputTop: 480,
        inputBottom: 520,
      }),
    ).toBe(144)
  })

  it("never lifts the input's top above the scroller's top", () => {
    //delta would be 44, but the input top is only 10px below the scroller top → capped at 10
    expect(
      computeScrollIntoViewTop({
        ...base,
        scrollerTop: 0,
        inputTop: 10,
        inputBottom: 520,
      }),
    ).toBe(10)
  })

  it("uses the keyboard top, not the scroller bottom, when the scroller runs behind the keyboard", () => {
    //full-height scroller (bottom 800) behind a keyboard whose top is 500.
    //line = min(800, 500) - 24 = 476; input bottom 560 → delta 84 (the scroller
    //bottom alone would put the line at 776 and barely scroll at all).
    expect(
      computeScrollIntoViewTop({
        scrollTop: 0,
        scrollerTop: 0,
        scrollerBottom: 800,
        keyboardTop: 500,
        topInset: 0,
        inputTop: 520,
        inputBottom: 560,
        buffer: 24,
      }),
    ).toBe(84)
  })

  it("scrolls down to reveal a field that sits above the visible top", () => {
    //field scrolled off the top (top -100, bottom -40) → scroll down by 100 so its
    //top lands at the scroller top. scrollTop 200 → 100.
    expect(
      computeScrollIntoViewTop({
        ...base,
        scrollTop: 200,
        inputTop: -100,
        inputBottom: -40,
      }),
    ).toBe(100)
  })

  it("does not push a tall above-field's bottom past the keyboard line", () => {
    //tall field (top -100, bottom 470) above the top; bringing its top to 0 would
    //push the bottom (570) past the line (476). Capped at maxDelta = 476 - 470 = 6.
    expect(
      computeScrollIntoViewTop({
        ...base,
        scrollTop: 200,
        inputTop: -100,
        inputBottom: 470,
      }),
    ).toBe(194)
  })

  it("lands a revealed above-field below the safe-area top inset", () => {
    //topInset 60 → safe top line at 60. field top -100 → scroll down by 160 so it
    //lands at 60 (clear of the notch), not at the literal top (0). scrollTop 200 → 40.
    expect(
      computeScrollIntoViewTop({
        ...base,
        scrollTop: 200,
        topInset: 60,
        inputTop: -100,
        inputBottom: -40,
      }),
    ).toBe(40)
  })
})

describe("resolveReservedSpace", () => {
  it("reserves the safe-area inset (plus gap) when the keyboard is closed", () => {
    expect(
      resolveReservedSpace({
        restingInset: 8,
        safeInsetBottom: 34,
        overlap: 0,
      }),
    ).toBe(42)
  })

  it("lets the keyboard subsume the safe inset — they never stack", () => {
    //overlap 290 > safe 34, so the safe inset is not added on top: 8 + max(34, 290)
    expect(
      resolveReservedSpace({
        restingInset: 8,
        safeInsetBottom: 34,
        overlap: 290,
      }),
    ).toBe(298)
  })

  it("keeps the safe inset when it is larger than a small overlap", () => {
    expect(
      resolveReservedSpace({
        restingInset: 8,
        safeInsetBottom: 34,
        overlap: 20,
      }),
    ).toBe(42)
  })

  it("returns 0 with no obstruction, so the element's own padding/margin applies", () => {
    expect(
      resolveReservedSpace({
        restingInset: 8,
        safeInsetBottom: 0,
        overlap: 0,
      }),
    ).toBe(0)
  })
})

/* =============================================================================
 * THE AIM AND ITS ONE SECOND LOOK
 *
 * happy-dom lays nothing out, so the rig states the geometry it means: a 300px
 * scroller at the top of the viewport and a 40px field whose top sits `fieldOffset`
 * px down its content. Nothing scrolls by itself either — `scrollTo` only records the
 * aim, and a test moves `scrollTop` and fires `scroll`/`scrollend` where a real smooth
 * scroll would. With the 24px buffer the keyboard line is 276, so a field at 500 is
 * aimed at 264, and 100px inserted above it mid-flight needs 364.
 * ============================================================================= */

type Aim = { top: number; behavior: ScrollBehavior | undefined }

function rigAvoidance() {
  const container = document.createElement("div")
  const field = document.createElement("input")
  field.type = "text"
  container.append(field)
  const elsewhere = document.createElement("input")
  elsewhere.type = "text"
  document.body.append(container, elsewhere)

  const state = { scrollTop: 0, fieldOffset: 500 }
  const aims: Aim[] = []
  Object.defineProperty(container, "scrollTop", {
    configurable: true,
    get: () => state.scrollTop,
    set: (value: number) => {
      state.scrollTop = value
    },
  })
  const rect = (top: number, height: number) =>
    ({
      top,
      bottom: top + height,
      left: 0,
      right: 390,
      width: 390,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect
  container.getBoundingClientRect = () => rect(0, 300)
  field.getBoundingClientRect = () =>
    rect(state.fieldOffset - state.scrollTop, 40)
  container.scrollTo = ((options: ScrollToOptions) => {
    aims.push({ top: options.top ?? 0, behavior: options.behavior })
  }) as typeof container.scrollTo

  const hook = renderHook(() =>
    useKeyboardAvoidance({ containerRef: { current: container } }),
  )

  return {
    container,
    field,
    elsewhere,
    state,
    aims,
    tops: () => aims.map((aim) => aim.top),
    unmount: () => hook.unmount(),
    /** focus the field and let the hook's two frames run its first aim */
    focusAndAim() {
      act(() => field.focus())
      act(() => {
        vi.advanceTimersByTime(40)
      })
    },
    /** the smooth scroll moving: scrollTop changes and a `scroll` event fires */
    scrollTo(top: number) {
      state.scrollTop = top
      container.dispatchEvent(new Event("scroll"))
    },
    /** content lands above the field: it moves down, the destination does not */
    insertAbove(px: number) {
      state.fieldOffset += px
    },
    scrollEnd() {
      act(() => {
        container.dispatchEvent(new Event("scrollend"))
      })
    },
  }
}

/** the whole failing window: aim, fly partway, insert 100px, land where aimed, end */
function flyWithInsertion(rig: ReturnType<typeof rigAvoidance>) {
  rig.focusAndAim()
  rig.scrollTo(80)
  rig.insertAbove(100)
  rig.scrollTo(264)
}

describe("useKeyboardAvoidance — a second look when the smooth scroll ends", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    //rAF on the fake clock, so a test says when the hook's two frames have passed
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 16),
    )
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id))
    //the keyboard line from innerHeight (768), well below the 300px scroller
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: undefined,
    })
    //the keyboard seam: no keyboard, and no visualViewport heuristics running
    ;(
      window as unknown as { __adaptvKeyboardMock?: unknown }
    ).__adaptvKeyboardMock = { isOpen: false, height: 0 }
    //Chromium and current WebKit have `scrollend`; the fallback suite deletes it
    ;(window as unknown as { onscrollend: unknown }).onscrollend = null
  })

  afterEach(() => {
    delete (window as unknown as { onscrollend?: unknown }).onscrollend
    delete (window as unknown as { __adaptvKeyboardMock?: unknown })
      .__adaptvKeyboardMock
    delete (window as unknown as { visualViewport?: unknown })
      .visualViewport
    vi.unstubAllGlobals()
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it("re-aims once from fresh geometry when content lands above the field mid-scroll", () => {
    const rig = rigAvoidance()
    flyWithInsertion(rig)
    expect(rig.tops(), "the first aim, from the focus frame").toEqual([
      264,
    ])

    rig.scrollEnd()

    expect(rig.tops()).toEqual([264, 364])
    expect(rig.aims[1].behavior).toBe("smooth")
  })

  it("makes the first aim a smooth scroll, the flight the second look exists for", () => {
    const rig = rigAvoidance()
    rig.focusAndAim()
    expect(rig.aims).toEqual([{ top: 264, behavior: "smooth" }])
  })

  it("does not aim again when the scroll landed the field clear", () => {
    const rig = rigAvoidance()
    rig.focusAndAim()
    rig.scrollTo(264)
    rig.scrollEnd()
    expect(rig.tops()).toEqual([264])
  })

  it("keeps the second look for scrollend once the scroll has started, however long it flies", () => {
    //Chromium's smooth scroll runs 450ms and more. The quiet window counted from the aim
    //is only for a scroll that never starts; left running past the first scroll event it
    //settles 120ms in, mid-flight, and spends the one extra aim before the insertion
    const rig = rigAvoidance()
    rig.focusAndAim()
    rig.scrollTo(80)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    rig.insertAbove(100)
    rig.scrollEnd()
    expect(rig.tops()).toEqual([264, 364])
  })

  it("re-aims on scrollend itself, without waiting out a quiet window", () => {
    const rig = rigAvoidance()
    flyWithInsertion(rig)
    rig.scrollEnd()
    //no timer advanced since the scroll's last frame: only the event can have done this
    expect(rig.tops()).toEqual([264, 364])
  })

  it("hands the scroller to the user: a touch, a click or a wheel mid-scroll cancels the re-aim", () => {
    //control first, so this cannot pass on a hook that never re-aims at all
    const control = rigAvoidance()
    flyWithInsertion(control)
    control.scrollEnd()
    expect(control.tops(), "control: no user input").toEqual([264, 364])
    control.unmount()
    document.body.replaceChildren()

    for (const type of ["touchstart", "pointerdown", "wheel"]) {
      const rig = rigAvoidance()
      rig.focusAndAim()
      rig.scrollTo(80)
      rig.container.dispatchEvent(new Event(type, { bubbles: true }))
      rig.insertAbove(100)
      rig.scrollTo(264)
      rig.scrollEnd()
      expect(rig.tops(), `after ${type}`).toEqual([264])
      rig.unmount()
      document.body.replaceChildren()
    }
  })

  it("does not re-aim once focus has left the field", () => {
    const control = rigAvoidance()
    flyWithInsertion(control)
    control.scrollEnd()
    expect(control.tops(), "control: focus stayed").toEqual([264, 364])
    control.unmount()
    document.body.replaceChildren()

    const moved = rigAvoidance()
    flyWithInsertion(moved)
    act(() => moved.elsewhere.focus())
    moved.scrollEnd()
    expect(moved.tops(), "focus moved outside").toEqual([264])
    moved.unmount()
    document.body.replaceChildren()

    const blurred = rigAvoidance()
    flyWithInsertion(blurred)
    act(() => blurred.field.blur())
    blurred.scrollEnd()
    expect(blurred.tops(), "blurred to the body").toEqual([264])
  })

  it("does not re-aim at a field removed mid-scroll, even when no focusout fires", () => {
    //WebKit removes a focused field without a blur or focusout (Chromium fires both), so
    //the focus check at the end of the scroll is the only thing that sees it gone
    const rig = rigAvoidance()
    flyWithInsertion(rig)
    let focusouts = 0
    rig.field.addEventListener("focusout", () => {
      focusouts += 1
    })
    const swallow = (event: Event) => event.stopPropagation()
    document.addEventListener("focusout", swallow, { capture: true })
    act(() => rig.field.remove())
    document.removeEventListener("focusout", swallow, { capture: true })

    expect(focusouts, "the premise: the field saw no focusout").toBe(0)
    expect(rig.field.isConnected).toBe(false)
    rig.scrollEnd()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(rig.tops(), "nothing aimed at the detached field").toEqual([
      264,
    ])
  })

  it("settles a scroll that never starts on the quiet window, so a later scrollend aims nothing", () => {
    //an aim past the end of a scroller already clamped there fires neither scroll nor
    //scrollend. The rig stands in for it: the aim lands the field clear without a single
    //scroll event, and the next scrollend is an unrelated one, 2s later, after content
    //has pushed the field back under the line
    const rig = rigAvoidance()
    rig.focusAndAim()
    rig.state.scrollTop = 264
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    rig.insertAbove(100)
    rig.scrollEnd()
    expect(rig.tops()).toEqual([264])
  })

  it("aims at most once more per aim, however many scrolls end after it", () => {
    const rig = rigAvoidance()
    flyWithInsertion(rig)
    rig.scrollEnd()
    expect(rig.tops()).toEqual([264, 364])

    //the re-aim's own flight gets overtaken too; it is not chased
    rig.insertAbove(100)
    rig.scrollTo(364)
    rig.scrollEnd()
    rig.scrollTo(300)
    rig.scrollEnd()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(rig.tops()).toEqual([264, 364])
  })

  it("cancels a pending re-aim on unmount", () => {
    const rig = rigAvoidance()
    flyWithInsertion(rig)
    rig.unmount()
    rig.container.dispatchEvent(new Event("scrollend"))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(rig.tops()).toEqual([264])
  })

  it("aims instantly under reduced motion and arms no second look", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
    const rig = rigAvoidance()
    rig.focusAndAim()
    expect(rig.aims).toEqual([{ top: 264, behavior: "auto" }])
    rig.insertAbove(100)
    rig.scrollTo(264)
    rig.scrollEnd()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(rig.tops()).toEqual([264])
  })

  describe("without scrollend (older WebKit)", () => {
    beforeEach(() => {
      delete (window as unknown as { onscrollend?: unknown }).onscrollend
    })

    it("re-aims once the scroll has been quiet for the caret's settle window", () => {
      const rig = rigAvoidance()
      rig.focusAndAim()
      //a flight whose frames keep arriving inside the window never settles early
      for (const top of [40, 120, 200]) {
        act(() => {
          vi.advanceTimersByTime(100)
        })
        rig.scrollTo(top)
      }
      rig.insertAbove(100)
      act(() => {
        vi.advanceTimersByTime(100)
      })
      rig.scrollTo(264)
      expect(rig.tops(), "still flying").toEqual([264])

      act(() => {
        vi.advanceTimersByTime(119)
      })
      expect(rig.tops(), "one ms short of the window").toEqual([264])
      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(rig.tops()).toEqual([264, 364])
    })

    it("still re-aims when the scroll never started", () => {
      const rig = rigAvoidance()
      rig.focusAndAim()
      rig.insertAbove(100)
      act(() => {
        vi.advanceTimersByTime(120)
      })
      //nothing moved, so from fresh geometry the destination is the whole 364
      expect(rig.tops()).toEqual([264, 364])
    })
  })
})

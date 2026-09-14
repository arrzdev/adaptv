import { act, cleanup, render, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest"
import { __resetKeyboardHeightCacheForTests } from "#adaptv/capabilities/keyboard-height-cache"
import type { AvoidKeyboardProps } from "#adaptv/components/avoid-keyboard/avoid-keyboard"
import { AvoidKeyboard } from "#adaptv/components/avoid-keyboard/avoid-keyboard"
import { useKeyboardAvoidance } from "#adaptv/components/avoid-keyboard/use-keyboard-avoidance"

/*
 * AvoidKeyboard end to end, through the REAL useKeyboard: what a consumer's form
 * actually gets — the inline reservation below the wrapper and the scroll that
 * lifts the focused field — for a given keyboard height and a given layout.
 *
 * happy-dom has no layout engine, so geometry is authored: every element that
 * matters carries a `data-geo` name and `getBoundingClientRect` answers from the
 * table below. Everything else is real — computed style, the safe-area probe,
 * focus events, the keyboard observer's branches.
 *
 * The keyboard is driven three ways. Most tests use the harness seam
 * (`window.__adaptvKeyboardMock`), the same one the playground e2e uses, because
 * the avoidance hook is platform-agnostic by design (docs/design/architecture.md
 * §4): it sees `{ isOpen, height }` and nothing else. The "per keyboard source"
 * block then drives the three real observer branches — visualViewport (iOS
 * Safari, VK-less Chromium), the VirtualKeyboard API (secure Chromium) and the
 * native bridge (a Capacitor build) — to prove each one lands in the same
 * reservation.
 */

const nativeBridge = vi.hoisted(() => {
  const listeners = new Set<
    (info: { isOpen: boolean; height: number }) => void
  >()
  return {
    enabled: false,
    listeners,
    emit(info: { isOpen: boolean; height: number }) {
      for (const listener of [...listeners]) listener(info)
    },
  }
})

vi.mock("#adaptv/capabilities/keyboard", () => ({
  hasNativeKeyboard: () => nativeBridge.enabled,
  initNativeKeyboard: () => {},
  subscribeNativeKeyboard: (
    cb: (info: { isOpen: boolean; height: number }) => void,
  ) => {
    nativeBridge.listeners.add(cb)
    return () => nativeBridge.listeners.delete(cb)
  },
}))

//the caret mute is iOS WebKit's business; here it is only an ordering witness
const caret = vi.hoisted(() => ({ preMuteCaret: vi.fn() }))
vi.mock("#adaptv/hooks/use-caret-repaint", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  preMuteCaret: caret.preMuteCaret,
}))

const MOCK_KEY = "__adaptvKeyboardMock"
const MOCK_EVENT = "adaptv:keyboard-mock"
const FRAME_MS = 16
const RESTING_GAP = 8

type MockHost = { [MOCK_KEY]?: { isOpen: boolean; height: number } }

/* -------------------------------------------------------------------------- */
/* geometry                                                                   */
/* -------------------------------------------------------------------------- */

const geometry = new Map<string, { top: number; bottom: number }>()

function place(name: string, top: number, bottom: number) {
  geometry.set(name, { top, bottom })
}

function setInnerHeight(height: number) {
  Object.defineProperty(window, "innerHeight", {
    value: height,
    configurable: true,
    writable: true,
  })
}

type ViewportStub = {
  height: number
  offsetTop: number
  addEventListener: (type: string, listener: EventListener) => void
  removeEventListener: (type: string, listener: EventListener) => void
  fire: (type: string) => void
}

function stubVisualViewport(height: number, offsetTop = 0): ViewportStub {
  const listeners = new Map<string, Set<EventListener>>()
  const viewport: ViewportStub = {
    height,
    offsetTop,
    addEventListener: (type, listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)?.add(listener)
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener)
    },
    fire: (type) => {
      for (const listener of [...(listeners.get(type) ?? [])]) {
        listener(new Event(type))
      }
    },
  }
  Object.defineProperty(window, "visualViewport", {
    value: viewport,
    configurable: true,
    writable: true,
  })
  return viewport
}

function removeVisualViewport() {
  Object.defineProperty(window, "visualViewport", {
    value: undefined,
    configurable: true,
    writable: true,
  })
}

/** Give `el` a `scrollTop` and a spy `scrollTo`; the spy does not move anything. */
function makeScroller(el: Element, scrollTop = 0) {
  Object.defineProperty(el, "scrollTop", {
    value: scrollTop,
    configurable: true,
    writable: true,
  })
  const scrollTo = vi.fn()
  el.scrollTo = scrollTo as unknown as typeof el.scrollTo
  return scrollTo
}

/** Make `el` overflow its box, so the scroll-parent walk treats it as a scroller. */
function makeOverflowing(
  el: Element,
  axis: "vertical" | "horizontal" = "vertical",
) {
  const define = (key: string, value: number) =>
    Object.defineProperty(el, key, { value, configurable: true })
  define("clientHeight", 300)
  define("clientWidth", 300)
  define("scrollHeight", axis === "vertical" ? 1000 : 300)
  define("scrollWidth", axis === "horizontal" ? 1000 : 300)
}

/* -------------------------------------------------------------------------- */
/* keyboard drivers                                                           */
/* -------------------------------------------------------------------------- */

function installKeyboardMock() {
  ;(window as unknown as MockHost)[MOCK_KEY] = { isOpen: false, height: 0 }
}

/** Raise (height > 0) or dismiss (0) the keyboard through the harness seam. */
function setKeyboard(height: number) {
  act(() => {
    ;(window as unknown as MockHost)[MOCK_KEY] = {
      isOpen: height > 0,
      height,
    }
    window.dispatchEvent(new Event(MOCK_EVENT))
  })
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function focus(el: HTMLElement) {
  act(() => {
    el.focus()
  })
}

/* -------------------------------------------------------------------------- */
/* rendering                                                                  */
/* -------------------------------------------------------------------------- */

function renderForm(
  props: Partial<AvoidKeyboardProps> = {},
  children: ReactNode = (
    <>
      <input data-geo="upper" aria-label="upper" />
      <input data-geo="lower" aria-label="lower" />
    </>
  ),
) {
  const view = render(
    <AvoidKeyboard data-geo="form" data-testid="form" {...props}>
      {children}
    </AvoidKeyboard>,
  )
  const form = view.getByTestId("form")
  return {
    ...view,
    form,
    upper: view.getByLabelText("upper") as HTMLInputElement,
    lower: view.getByLabelText("lower") as HTMLInputElement,
  }
}

let restingStyle: HTMLStyleElement
let originalInnerHeight: number

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  })
  originalInnerHeight = window.innerHeight
  setInnerHeight(800)
  geometry.clear()
  vi.spyOn(
    HTMLElement.prototype,
    "getBoundingClientRect",
  ).mockImplementation(function (this: HTMLElement) {
    const box = geometry.get(this.getAttribute("data-geo") ?? "") ?? {
      top: 0,
      bottom: 0,
    }
    return {
      top: box.top,
      bottom: box.bottom,
      left: 0,
      right: 0,
      x: 0,
      y: box.top,
      width: 0,
      height: box.bottom - box.top,
      toJSON: () => ({}),
    } as DOMRect
  })
  //the wrapper's resting design gap comes from a CLASS-tier rule, as it would in an app —
  //so "no inline override" really does leave a padding behind to apply
  restingStyle = document.createElement("style")
  restingStyle.textContent = `[data-geo="form"] { padding-bottom: ${RESTING_GAP}px; }`
  document.head.appendChild(restingStyle)
  caret.preMuteCaret.mockClear()
})

afterEach(() => {
  //unmount while the fakes are still installed, so pending frames are cancelled by them
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  restingStyle.remove()
  delete (window as unknown as MockHost)[MOCK_KEY]
  document.documentElement.style.removeProperty("--adaptv-inset-bottom")
  setInnerHeight(originalInnerHeight)
  removeVisualViewport()
  nativeBridge.enabled = false
  nativeBridge.listeners.clear()
  __resetKeyboardHeightCacheForTests()
  localStorage.clear()
})

/* ========================================================================== */

describe("AvoidKeyboard — the reservation below the wrapper", () => {
  beforeEach(() => {
    installKeyboardMock()
    stubVisualViewport(800)
  })

  it("puts no inline inset on the wrapper at rest, so its own padding applies", () => {
    place("form", 0, 800)
    const { form } = renderForm()

    expect(form.style.paddingBottom).toBe("")
    expect(getComputedStyle(form).paddingBottom).toBe(`${RESTING_GAP}px`)
    expect(form.hasAttribute("data-keyboard-open")).toBe(false)
    expect(form.style.getPropertyValue("--adaptv-keyboard-height")).toBe(
      "0px",
    )
  })

  it("lifts a full-height scroller by the whole keyboard, on top of its resting gap", () => {
    place("form", 0, 800)
    const { form } = renderForm()

    setKeyboard(300)

    expect(form.style.paddingBottom).toBe(`${300 + RESTING_GAP}px`)
    expect(form.getAttribute("data-keyboard-open")).toBe("")
    expect(form.style.getPropertyValue("--adaptv-keyboard-height")).toBe(
      "300px",
    )
  })

  it("reserves only the slice the keyboard hides when the wrapper ends mid-screen", () => {
    //keyboard top 800 - 300 = 500; wrapper bottom 620 → 120px behind it
    place("form", 100, 620)
    const { form } = renderForm()

    setKeyboard(300)

    expect(form.style.paddingBottom).toBe(`${120 + RESTING_GAP}px`)
  })

  it("reserves nothing for a wrapper that ends above the keyboard, but still reports it open", () => {
    place("form", 0, 480)
    const { form } = renderForm()

    setKeyboard(300)

    expect(form.style.paddingBottom).toBe("")
    expect(form.getAttribute("data-keyboard-open")).toBe("")
  })

  it("gives the room back the moment the keyboard dismisses", () => {
    place("form", 0, 800)
    const { form } = renderForm()

    setKeyboard(300)
    setKeyboard(0)

    expect(form.style.paddingBottom).toBe("")
    expect(form.hasAttribute("data-keyboard-open")).toBe(false)
    expect(form.style.getPropertyValue("--adaptv-keyboard-height")).toBe(
      "0px",
    )
  })

  //The resting gap is read once, where no override is in the DOM. Re-reading it while the
  //inline reservation is applied would take the reservation itself as the "resting" gap, and
  //every grow — the QuickType bar appearing, an AutoFill accessory — would stack another
  //keyboard on top.
  it("tracks a keyboard that grows and shrinks while open without compounding the gap", () => {
    place("form", 0, 800)
    const { form } = renderForm()

    setKeyboard(300)
    setKeyboard(345)
    expect(form.style.paddingBottom).toBe(`${345 + RESTING_GAP}px`)

    setKeyboard(300)
    expect(form.style.paddingBottom).toBe(`${300 + RESTING_GAP}px`)

    for (let cycle = 0; cycle < 3; cycle++) {
      setKeyboard(0)
      setKeyboard(300)
    }
    expect(form.style.paddingBottom).toBe(`${300 + RESTING_GAP}px`)
  })

  it("reserves on the margin with behavior='margin', stacking on the resting margin", () => {
    restingStyle.textContent = `[data-geo="form"] { margin-bottom: 12px; padding-bottom: ${RESTING_GAP}px; }`
    place("form", 0, 800)
    const { form } = renderForm({ behavior: "margin" })

    setKeyboard(300)

    expect(form.style.marginBottom).toBe(`${300 + 12}px`)
    expect(form.style.paddingBottom).toBe("")
  })

  it("reserves nothing and reports closed when disabled, keyboard or not", () => {
    place("form", 0, 800)
    const { form } = renderForm({ isEnabled: false })

    setKeyboard(300)

    expect(form.style.paddingBottom).toBe("")
    expect(form.hasAttribute("data-keyboard-open")).toBe(false)
    expect(form.style.getPropertyValue("--adaptv-keyboard-height")).toBe(
      "0px",
    )
  })

  it("drops a live reservation when it is disabled mid-keyboard", () => {
    place("form", 0, 800)
    const { form, rerender } = renderForm()
    setKeyboard(300)
    expect(form.style.paddingBottom).toBe(`${300 + RESTING_GAP}px`)

    rerender(
      <AvoidKeyboard data-geo="form" data-testid="form" isEnabled={false}>
        <input aria-label="upper" />
      </AvoidKeyboard>,
    )

    expect(form.style.paddingBottom).toBe("")
  })

  it("re-derives the keyboard line from the viewport of the moment when a rotation changes the keyboard", () => {
    place("form", 0, 800)
    const { form } = renderForm()
    setKeyboard(300)
    expect(form.style.paddingBottom).toBe(`${300 + RESTING_GAP}px`)

    //landscape: a much shorter viewport and a shorter keyboard. Measured against the
    //portrait 800 the keyboard top would sit at 600, below this wrapper, and reserve nothing.
    setInnerHeight(400)
    place("form", 0, 400)
    setKeyboard(200)

    expect(form.style.paddingBottom).toBe(`${200 + RESTING_GAP}px`)
  })
})

describe("AvoidKeyboard — the home-indicator inset", () => {
  beforeEach(() => {
    installKeyboardMock()
    stubVisualViewport(800)
    document.documentElement.style.setProperty(
      "--adaptv-inset-bottom",
      "34px",
    )
  })

  it("reserves the inset at rest when the wrapper reaches the screen bottom", () => {
    place("form", 0, 800)
    const { form } = renderForm()

    expect(form.style.paddingBottom).toBe(`${34 + RESTING_GAP}px`)
  })

  it("lets the keyboard subsume the inset rather than stack on it, and hands it back on dismiss", () => {
    place("form", 0, 800)
    const { form } = renderForm()

    setKeyboard(300)
    expect(form.style.paddingBottom).toBe(`${300 + RESTING_GAP}px`)

    setKeyboard(0)
    expect(form.style.paddingBottom).toBe(`${34 + RESTING_GAP}px`)
  })

  it("reserves no inset either when disabled — a disabled wrapper is a plain div", () => {
    place("form", 0, 800)
    const { form } = renderForm({ isEnabled: false })

    expect(form.style.paddingBottom).toBe("")
  })

  it("ignores the inset for a wrapper with other content below it", () => {
    place("form", 0, 700)
    const { form } = renderForm()

    expect(form.style.paddingBottom).toBe("")
  })

  it("treats a bottom a sub-pixel short of the screen edge as reaching it", () => {
    //fractional layout (iOS reports 799.5-style heights) must not lose the inset
    place("form", 0, 799.5)
    const { form } = renderForm()

    expect(form.style.paddingBottom).toBe(`${34 + RESTING_GAP}px`)
  })

  it("picks up an inset written onto <html> after mount, with no event (Capacitor SystemBars)", async () => {
    document.documentElement.style.removeProperty("--adaptv-inset-bottom")
    place("form", 0, 800)
    const { form } = renderForm()
    expect(form.style.paddingBottom).toBe("")

    await act(async () => {
      document.documentElement.style.setProperty(
        "--adaptv-inset-bottom",
        "24px",
      )
      await Promise.resolve()
    })

    expect(form.style.paddingBottom).toBe(`${24 + RESTING_GAP}px`)
  })
})

describe("AvoidKeyboard — the same reservation from every keyboard source", () => {
  it("visualViewport (iOS Safari, VK-less Chromium): the viewport shrinks by the keyboard", () => {
    const viewport = stubVisualViewport(800)
    place("form", 0, 800)
    const { form, lower } = renderForm()

    //tapped: nothing has slid in yet, so the settled read is still closed
    focus(lower)
    advance(60) //the observer's debounce
    expect(form.style.paddingBottom).toBe("")

    //the keyboard arrives as a viewport resize some frames later
    viewport.height = 800 - 340
    act(() => viewport.fire("resize"))
    advance(60)

    expect(form.style.paddingBottom).toBe(`${340 + RESTING_GAP}px`)
  })

  it("VirtualKeyboard API (secure Chromium, overlaysContent): the viewport holds, boundingRect carries the height", () => {
    stubVisualViewport(800)
    const geometryListeners = new Set<EventListener>()
    const virtualKeyboard = {
      overlaysContent: true,
      boundingRect: { height: 0 },
      addEventListener: (_: string, listener: EventListener) =>
        geometryListeners.add(listener),
      removeEventListener: (_: string, listener: EventListener) =>
        geometryListeners.delete(listener),
    }
    Object.defineProperty(navigator, "virtualKeyboard", {
      value: virtualKeyboard,
      configurable: true,
    })
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    })
    try {
      place("form", 0, 800)
      const { form, lower } = renderForm()

      focus(lower)
      virtualKeyboard.boundingRect.height = 300
      act(() => {
        for (const listener of geometryListeners) {
          listener(new Event("geometrychange"))
        }
      })

      expect(form.style.paddingBottom).toBe(`${300 + RESTING_GAP}px`)
    } finally {
      Reflect.deleteProperty(navigator, "virtualKeyboard")
      Reflect.deleteProperty(window, "isSecureContext")
    }
  })

  it("native bridge (iOS, KeyboardResize.None): the OS height lands as reported", () => {
    nativeBridge.enabled = true
    stubVisualViewport(800)
    place("form", 0, 800)
    const { form, lower } = renderForm()

    focus(lower)
    act(() => nativeBridge.emit({ isOpen: true, height: 336 }))
    expect(form.style.paddingBottom).toBe(`${336 + RESTING_GAP}px`)

    act(() => nativeBridge.emit({ isOpen: false, height: 0 }))
    expect(form.style.paddingBottom).toBe("")
  })
})

describe("AvoidKeyboard — scrolling the focused field clear", () => {
  let viewport: ViewportStub

  beforeEach(() => {
    installKeyboardMock()
    viewport = stubVisualViewport(800)
  })

  /** A full-screen form whose keyboard (300px) is already up in the live viewport. */
  function renderFullScreenForm(props: Partial<AvoidKeyboardProps> = {}) {
    place("form", 0, 800)
    place("upper", 100, 140)
    place("lower", 600, 640)
    viewport.height = 500
    const view = renderForm(props)
    const scrollTo = makeScroller(view.form)
    return { ...view, scrollTo }
  }

  it("scrolls the field above the keyboard line plus the buffer, two frames after focus", () => {
    const { lower, scrollTo } = renderFullScreenForm()

    focus(lower)
    //one frame is too early on iOS: WebKit's own focus layout runs first and drops the scroll
    advance(FRAME_MS)
    expect(scrollTo).not.toHaveBeenCalled()

    advance(FRAME_MS)
    //line = 500 - 24 = 476; field bottom 640 → up by 164
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 164, behavior: "smooth" })
    //the caret is muted before the scroll's first frame, not after
    expect(caret.preMuteCaret).toHaveBeenCalledTimes(1)
    expect(caret.preMuteCaret.mock.invocationCallOrder[0]).toBeLessThan(
      scrollTo.mock.invocationCallOrder[0],
    )
  })

  it("reads the keyboard line from the viewport at scroll time, not at focus time", () => {
    const { lower, scrollTo } = renderFullScreenForm()
    viewport.height = 800 //nothing up yet when the field is tapped

    focus(lower)
    advance(FRAME_MS)
    viewport.height = 500 //the keyboard slides in before the second frame
    advance(FRAME_MS)

    expect(scrollTo).toHaveBeenCalledWith({ top: 164, behavior: "smooth" })
  })

  it("counts the visual viewport's own offset into the keyboard line (iOS pans the visual viewport)", () => {
    const { lower, scrollTo } = renderFullScreenForm()
    viewport.offsetTop = 100 //visible band 100..600

    focus(lower)
    advance(FRAME_MS * 2)

    //line = 600 - 24 = 576; field bottom 640 → 64
    expect(scrollTo).toHaveBeenCalledWith({ top: 64, behavior: "smooth" })
  })

  it("falls back to the layout viewport where there is no visualViewport", () => {
    removeVisualViewport()
    place("form", 0, 500)
    place("upper", 100, 140)
    place("lower", 480, 520)
    const { form, lower } = renderForm()
    const scrollTo = makeScroller(form)

    focus(lower)
    advance(FRAME_MS * 2)

    //line = min(scroller 500, innerHeight 800) - 24 = 476; field bottom 520 → 44
    expect(scrollTo).toHaveBeenCalledWith({ top: 44, behavior: "smooth" })
  })

  it("adds onto the scroller's current position", () => {
    const { form, lower } = renderFullScreenForm()
    const scrollTo = makeScroller(form, 50)

    focus(lower)
    advance(FRAME_MS * 2)

    expect(scrollTo).toHaveBeenCalledWith({ top: 214, behavior: "smooth" })
  })

  it("honours a custom scrollBuffer", () => {
    const { lower, scrollTo } = renderFullScreenForm({ scrollBuffer: 40 })

    focus(lower)
    advance(FRAME_MS * 2)

    //line = 500 - 40 = 460; field bottom 640 → 180
    expect(scrollTo).toHaveBeenCalledWith({ top: 180, behavior: "smooth" })
  })

  it("leaves a field that already clears the keyboard alone — no scroll, no caret mute", () => {
    const { upper, scrollTo } = renderFullScreenForm()

    focus(upper)
    advance(FRAME_MS * 2)

    expect(scrollTo).not.toHaveBeenCalled()
    expect(caret.preMuteCaret).not.toHaveBeenCalled()
  })

  it("scrolls DOWN to reveal a field above the top, landing below the scroller's top padding (the notch)", () => {
    place("form", 0, 800)
    place("upper", -100, -60)
    place("lower", 600, 640)
    viewport.height = 500
    const { form, upper } = renderForm({ style: { paddingTop: 60 } })
    const scrollTo = makeScroller(form, 200)

    focus(upper)
    advance(FRAME_MS * 2)

    //safe top = 0 + 60; field top -100 → down by 160 → 200 - 160 = 40
    expect(scrollTo).toHaveBeenCalledWith({ top: 40, behavior: "smooth" })
  })

  it("jumps instead of easing under prefers-reduced-motion", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query === "(prefers-reduced-motion: reduce)",
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    )
    const { lower, scrollTo } = renderFullScreenForm()

    focus(lower)
    advance(FRAME_MS * 2)

    expect(scrollTo).toHaveBeenCalledWith({ top: 164, behavior: "auto" })
  })

  it("ignores a focused control that raises no keyboard", () => {
    place("form", 0, 800)
    place("upper", 600, 640)
    place("lower", 600, 640)
    viewport.height = 500
    const { form, upper } = renderForm(
      {},
      <>
        <input data-geo="upper" aria-label="upper" type="checkbox" />
        <input data-geo="lower" aria-label="lower" />
      </>,
    )
    const scrollTo = makeScroller(form)

    focus(upper)
    advance(FRAME_MS * 2)

    expect(scrollTo).not.toHaveBeenCalled()
  })

  it("scrolls a contenteditable like a text field", () => {
    place("form", 0, 800)
    place("upper", 100, 140)
    place("lower", 600, 640)
    viewport.height = 500
    const { form, lower } = renderForm()
    const scrollTo = makeScroller(form)
    const editable = document.createElement("div")
    editable.setAttribute("data-geo", "lower")
    editable.contentEditable = "true"
    Object.defineProperty(editable, "isContentEditable", { value: true })
    editable.tabIndex = 0
    lower.after(editable)

    focus(editable)
    advance(FRAME_MS * 2)

    expect(scrollTo).toHaveBeenCalledWith({ top: 164, behavior: "smooth" })
  })

  it("reserves but never scrolls with scrollIntoView={false}", () => {
    const { form, lower, scrollTo } = renderFullScreenForm({
      scrollIntoView: false,
    })

    focus(lower)
    setKeyboard(300)
    advance(FRAME_MS * 4)

    expect(form.style.paddingBottom).toBe(`${300 + RESTING_GAP}px`)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it("neither scrolls nor reserves when disabled", () => {
    const { form, lower, scrollTo } = renderFullScreenForm({
      isEnabled: false,
    })

    focus(lower)
    setKeyboard(300)
    advance(FRAME_MS * 4)

    expect(form.style.paddingBottom).toBe("")
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it("scrolls the already-focused field again when the keyboard finishes opening", () => {
    const { lower, scrollTo } = renderFullScreenForm()
    viewport.height = 800

    //tapped with nothing up: in view against the full viewport, so nothing to do
    focus(lower)
    advance(FRAME_MS * 2)
    expect(scrollTo).not.toHaveBeenCalled()

    //the keyboard's open report arrives with the field still focused
    viewport.height = 500
    setKeyboard(300)
    advance(FRAME_MS * 2)

    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 164, behavior: "smooth" })
  })

  it("scrolls only for the field that holds focus when a switch lands mid-wait", () => {
    const { upper, lower, scrollTo } = renderFullScreenForm()
    place("upper", 700, 740)

    focus(upper)
    advance(FRAME_MS)
    focus(lower)
    advance(FRAME_MS * 3)

    //one scroll, aimed at `lower` (bottom 640 → 164), never at `upper` (740 → 264)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ top: 164, behavior: "smooth" })
  })

  it("never scrolls after the wrapper unmounts mid-wait", () => {
    const { lower, scrollTo, unmount } = renderFullScreenForm()

    focus(lower)
    advance(FRAME_MS)
    unmount()
    advance(FRAME_MS * 3)

    expect(scrollTo).not.toHaveBeenCalled()
  })

  it("scrolls the nearest ancestor that actually overflows, skipping one that merely could", () => {
    place("form", 0, 800)
    place("inner", 0, 800)
    place("lower", 600, 640)
    viewport.height = 500
    const { form, lower, getByTestId } = renderForm(
      {},
      <div
        data-testid="inner"
        data-geo="inner"
        style={{ overflowY: "auto" }}
      >
        <div data-testid="fits" style={{ overflowY: "auto" }}>
          <input data-geo="upper" aria-label="upper" />
          <input data-geo="lower" aria-label="lower" />
        </div>
      </div>,
    )
    const inner = getByTestId("inner")
    const fits = getByTestId("fits")
    makeOverflowing(inner)
    const innerScroll = makeScroller(inner)
    const fitsScroll = makeScroller(fits)
    const formScroll = makeScroller(form)

    focus(lower)
    advance(FRAME_MS * 2)

    expect(innerScroll).toHaveBeenCalledWith({
      top: 164,
      behavior: "smooth",
    })
    expect(fitsScroll).not.toHaveBeenCalled()
    expect(formScroll).not.toHaveBeenCalled()
  })

  it("treats horizontal overflow as a scroller too", () => {
    place("form", 0, 800)
    place("inner", 0, 800)
    place("lower", 600, 640)
    viewport.height = 500
    const { form, lower, getByTestId } = renderForm(
      {},
      <div
        data-testid="inner"
        data-geo="inner"
        style={{ overflowX: "auto" }}
      >
        <input data-geo="upper" aria-label="upper" />
        <input data-geo="lower" aria-label="lower" />
      </div>,
    )
    const inner = getByTestId("inner")
    makeOverflowing(inner, "horizontal")
    const innerScroll = makeScroller(inner)
    const formScroll = makeScroller(form)

    focus(lower)
    advance(FRAME_MS * 2)

    expect(innerScroll).toHaveBeenCalled()
    expect(formScroll).not.toHaveBeenCalled()
  })

  it("never reaches past the wrapper to a scroller outside it", () => {
    place("form", 0, 800)
    place("upper", 100, 140)
    place("lower", 600, 640)
    viewport.height = 500
    const view = render(
      <div data-testid="outer" style={{ overflowY: "auto" }}>
        <AvoidKeyboard data-geo="form" data-testid="form">
          <input data-geo="lower" aria-label="lower" />
        </AvoidKeyboard>
      </div>,
    )
    const outer = view.getByTestId("outer")
    const form = view.getByTestId("form")
    makeOverflowing(outer)
    const outerScroll = makeScroller(outer)
    const formScroll = makeScroller(form)

    focus(view.getByLabelText("lower"))
    advance(FRAME_MS * 2)

    expect(formScroll).toHaveBeenCalledWith({
      top: 164,
      behavior: "smooth",
    })
    expect(outerScroll).not.toHaveBeenCalled()
  })
})

describe("useKeyboardAvoidance — headless", () => {
  let viewport: ViewportStub

  beforeEach(() => {
    installKeyboardMock()
    viewport = stubVisualViewport(800)
  })

  it("hands a custom wrapper the applyable state: the reservation, the height and the strategy", () => {
    const container = document.createElement("div")
    container.setAttribute("data-geo", "form")
    container.style.marginBottom = "4px"
    document.body.appendChild(container)
    onTestFinished(() => container.remove())
    place("form", 0, 800)

    const { result } = renderHook(() =>
      useKeyboardAvoidance({
        containerRef: { current: container },
        behavior: "margin",
      }),
    )
    expect(result.current).toEqual({
      isKeyboardOpen: false,
      keyboardHeight: 0,
      space: 0,
      behavior: "margin",
    })

    setKeyboard(300)

    expect(result.current).toEqual({
      isKeyboardOpen: true,
      keyboardHeight: 300,
      space: 304,
      behavior: "margin",
    })
  })

  it("reports the keyboard but reserves nothing while its ref is not attached yet", () => {
    const { result } = renderHook(() =>
      useKeyboardAvoidance({ containerRef: { current: null } }),
    )

    setKeyboard(300)

    expect(result.current).toEqual({
      isKeyboardOpen: true,
      keyboardHeight: 300,
      space: 0,
      behavior: "padding",
    })
  })

  //An inline <svg> is not a scroll container even when a stylesheet gives it overflow, so the
  //walk must pass through it (and its foreignObject) to the wrapper rather than aim the
  //scroll at a box that cannot move.
  it("never picks an SVG ancestor as the scroller, even one styled to overflow", () => {
    place("form", 0, 800)
    place("lower", 600, 640)
    viewport.height = 500
    const { form, lower, getByTestId } = renderForm(
      {},
      <svg
        aria-hidden="true"
        data-testid="svg"
        style={{ overflowY: "auto" }}
      >
        <foreignObject>
          <input data-geo="upper" aria-label="upper" />
          <input data-geo="lower" aria-label="lower" />
        </foreignObject>
      </svg>,
    )
    const svg = getByTestId("svg")
    makeOverflowing(svg)
    const svgScroll = makeScroller(svg)
    const formScroll = makeScroller(form)

    focus(lower)
    advance(FRAME_MS * 2)

    expect(formScroll).toHaveBeenCalledWith({
      top: 164,
      behavior: "smooth",
    })
    expect(svgScroll).not.toHaveBeenCalled()
  })
})

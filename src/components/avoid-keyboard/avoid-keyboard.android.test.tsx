import { act, cleanup, render } from "@testing-library/react"
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
import type { AvoidKeyboardProps } from "#adaptv/components/avoid-keyboard/avoid-keyboard"

/*
 * AvoidKeyboard on Android native, through the REAL keyboard signal: the capability's app-wide
 * rest height and unpaid part, `useKeyboard`, and the avoidance hook, with only the Capacitor
 * plugin and the geometry authored.
 *
 * Capacitor 8's SystemBars pads the WebView by the IME inset, so the layout viewport itself
 * shrinks by the keyboard (measured on a Pixel 10 emulator: `innerHeight` 923 → 587 under a 336px
 * keyboard) while the plugin still reports 336. The wrapper must answer only the part the
 * viewport has not paid for. The plugin event and the WebView resize land in either order, so
 * both are played.
 *
 * Each test boots a fresh module graph (`vi.resetModules`), because the rest height is app-wide
 * and lives from `initNativeKeyboard` on, exactly as the shell's boot runs it.
 *
 * Not modelled: a split-screen window growing while the keyboard is up. The rest is only learned
 * with the keyboard down (or raised by a taller viewport), so a window that grows by less than
 * the keyboard under it leaves a band until the keyboard closes — see keyboard-signal.md §3.
 */

const plugin = vi.hoisted(() => ({
  listeners: new Map<string, (info?: unknown) => void>(),
}))

vi.mock("@capacitor/keyboard", () => ({
  Keyboard: {
    addListener: (event: string, listener: (info?: unknown) => void) => {
      plugin.listeners.set(event, listener)
      return Promise.resolve({ remove: () => Promise.resolve() })
    },
    setResizeMode: () => Promise.resolve(),
  },
  KeyboardResize: { None: "none", Body: "body", Native: "native" },
}))

const REST = 923
const KEYBOARD = 336
const SHRUNK = REST - KEYBOARD
const PORTRAIT_WIDTH = 412
const FRAME_MS = 16
const RESTING_GAP = 8

/* -------------------------------------------------------------------------- */
/* geometry                                                                   */
/* -------------------------------------------------------------------------- */

const geometry = new Map<string, { top: number; bottom: number }>()

function place(name: string, top: number, bottom: number) {
  geometry.set(name, { top, bottom })
}

function setWindowSize(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    value: width,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(window, "innerHeight", {
    value: height,
    configurable: true,
    writable: true,
  })
}

type ViewportStub = { height: number; offsetTop: number }
let viewport: ViewportStub

function stubVisualViewport(height: number) {
  viewport = {
    height,
    offsetTop: 0,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as ViewportStub
  Object.defineProperty(window, "visualViewport", {
    value: viewport,
    configurable: true,
    writable: true,
  })
}

/** The WebView resizing: the layout viewport, and with it every box pinned to its bottom. */
function resizeWebView(
  height: number,
  boxes: Record<string, number> = {},
  width = window.innerWidth,
) {
  act(() => {
    setWindowSize(width, height)
    viewport.height = height
    for (const [name, bottom] of Object.entries(boxes)) {
      place(name, geometry.get(name)?.top ?? 0, bottom)
    }
    window.dispatchEvent(new Event("resize"))
  })
}

function makeScroller(el: Element) {
  Object.defineProperty(el, "scrollTop", {
    value: 0,
    configurable: true,
    writable: true,
  })
  const scrollTo = vi.fn()
  el.scrollTo = scrollTo as unknown as typeof el.scrollTo
  return scrollTo
}

/* -------------------------------------------------------------------------- */
/* the plugin                                                                 */
/* -------------------------------------------------------------------------- */

function raise(height = KEYBOARD) {
  act(() => {
    plugin.listeners.get("keyboardWillShow")?.({ keyboardHeight: height })
  })
}

function dismiss() {
  act(() => {
    plugin.listeners.get("keyboardWillHide")?.()
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
/* boot + render                                                              */
/* -------------------------------------------------------------------------- */

let AvoidKeyboard: typeof import("#adaptv/components/avoid-keyboard/avoid-keyboard").AvoidKeyboard

/** A cold launch on `platform`: the window at its size, then the shell's `initNativeKeyboard`. */
async function boot({
  platform = "android",
  width = PORTRAIT_WIDTH,
  height = REST,
}: {
  platform?: "android" | "ios"
  width?: number
  height?: number
} = {}) {
  vi.resetModules()
  plugin.listeners.clear()
  vi.stubGlobal("Capacitor", {
    isNativePlatform: () => true,
    getPlatform: () => platform,
  })
  setWindowSize(width, height)
  stubVisualViewport(height)
  const keyboard = await import("#adaptv/capabilities/keyboard")
  keyboard.initNativeKeyboard()
  AvoidKeyboard = (
    await import("#adaptv/components/avoid-keyboard/avoid-keyboard")
  ).AvoidKeyboard
}

function renderForm(
  props: Partial<AvoidKeyboardProps> = {},
  extra: ReactNode = null,
) {
  const view = render(
    <AvoidKeyboard data-geo="form" data-testid="form" {...props}>
      <input data-geo="upper" aria-label="upper" />
      <input data-geo="lower" aria-label="lower" />
      {extra}
    </AvoidKeyboard>,
  )
  return {
    ...view,
    form: view.getByTestId("form"),
    lower: view.getByLabelText("lower") as HTMLInputElement,
  }
}

let restingStyle: HTMLStyleElement
const originalSize = {
  width: window.innerWidth,
  height: window.innerHeight,
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  })
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
  restingStyle = document.createElement("style")
  restingStyle.textContent = `[data-geo="form"] { padding-bottom: ${RESTING_GAP}px; }`
  document.head.appendChild(restingStyle)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  restingStyle.remove()
  document.body.replaceChildren()
  setWindowSize(originalSize.width, originalSize.height)
  Object.defineProperty(window, "visualViewport", {
    value: undefined,
    configurable: true,
    writable: true,
  })
  localStorage.clear()
})

/* ========================================================================== */

describe("AvoidKeyboard — Android native, the reservation below the wrapper", () => {
  it("reserves only the resting gap once the WebView has paid, when the plugin event lands first", async () => {
    await boot()
    place("form", 0, REST)
    const { form, lower } = renderForm()

    focus(lower)
    raise()
    //nothing has resized yet, so the keyboard really does cover the bottom 336px
    expect(form.style.paddingBottom).toBe(`${KEYBOARD + RESTING_GAP}px`)

    resizeWebView(SHRUNK, { form: SHRUNK })

    expect(form.style.paddingBottom).toBe("")
    expect(getComputedStyle(form).paddingBottom).toBe(`${RESTING_GAP}px`)
    expect(form.getAttribute("data-keyboard-open")).toBe("")
    expect(form.style.getPropertyValue("--adaptv-keyboard-height")).toBe(
      `${KEYBOARD}px`,
    )
  })

  it("reserves only the resting gap when the WebView resize lands first, raise after raise", async () => {
    await boot()
    place("form", 0, REST)
    const { form, lower } = renderForm()

    for (let cycle = 0; cycle < 3; cycle++) {
      focus(lower)
      resizeWebView(SHRUNK, { form: SHRUNK })
      raise()
      expect(form.style.paddingBottom).toBe("")

      dismiss()
      resizeWebView(REST, { form: REST })
      act(() => lower.blur())
      expect(form.style.paddingBottom).toBe("")
    }
  })

  it("reserves nothing for a mid-screen wrapper the shrunk viewport already lifted clear", async () => {
    await boot()
    //a 223px tab bar below the wrapper rides the viewport's bottom edge
    place("form", 0, REST - 223)
    const { form, lower } = renderForm()

    focus(lower)
    raise()
    //before the resize the keyboard top is 587, so 113px of the wrapper is behind it
    expect(form.style.paddingBottom).toBe(`${113 + RESTING_GAP}px`)

    resizeWebView(SHRUNK, { form: SHRUNK - 223 })
    expect(form.style.paddingBottom).toBe("")
  })

  it("reserves the unpaid slice while the WebView has paid for only part of the keyboard", async () => {
    await boot()
    place("form", 0, REST)
    const { form, lower } = renderForm()

    focus(lower)
    raise()
    //200 of the 336px paid: the keyboard top is still at 587, 136px above this bottom
    resizeWebView(REST - 200, { form: REST - 200 })
    expect(form.style.paddingBottom).toBe(`${136 + RESTING_GAP}px`)

    resizeWebView(SHRUNK, { form: SHRUNK })
    expect(form.style.paddingBottom).toBe("")
  })

  it("reserves nothing when it mounts under a keyboard that is already up", async () => {
    await boot()
    //a field elsewhere in the app raised the keyboard before this wrapper existed
    const elsewhere = document.createElement("input")
    document.body.appendChild(elsewhere)
    focus(elsewhere)
    resizeWebView(SHRUNK)
    raise()

    place("form", 0, SHRUNK)
    const { form, lower } = renderForm()
    focus(lower)

    expect(form.getAttribute("data-keyboard-open")).toBe("")
    expect(form.style.paddingBottom).toBe("")
  })

  it("reserves nothing after rotating to portrait under a keyboard raised in landscape", async () => {
    await boot()
    resizeWebView(380, {}, 915) //turned to landscape before the form opened
    place("form", 0, 380)
    const { form, lower } = renderForm()

    focus(lower)
    resizeWebView(150, { form: 150 })
    raise(230)
    expect(form.style.paddingBottom).toBe("")

    //turned back with the keyboard still up: portrait's own rest, not landscape's, is what paid
    resizeWebView(SHRUNK, { form: SHRUNK }, PORTRAIT_WIDTH)
    raise()
    expect(form.style.paddingBottom).toBe("")
  })

  //`document.activeElement` stops at a shadow host, so the focused field inside a web component
  //is found through `shadowRoot.activeElement` — or the resize that lands first passes for a rest
  it("reserves nothing when the resize lands first under a field inside a shadow root", async () => {
    await boot()
    place("form", 0, REST)
    const { form, getByTestId } = renderForm(
      {},
      <div data-testid="host" />,
    )
    const field = document.createElement("input")
    getByTestId("host").attachShadow({ mode: "open" }).appendChild(field)

    focus(field)
    expect(document.activeElement).toBe(getByTestId("host"))
    resizeWebView(SHRUNK, { form: SHRUNK })
    raise()

    expect(form.style.paddingBottom).toBe("")
  })

  it("lets a resize under a focused field raise the rest a short launch left behind", async () => {
    await boot({ height: SHRUNK })
    place("form", 0, SHRUNK)
    const { form, lower } = renderForm()

    focus(lower)
    resizeWebView(REST, { form: REST })
    resizeWebView(SHRUNK, { form: SHRUNK })
    raise()

    expect(form.style.paddingBottom).toBe("")
  })

  it("keeps the whole keyboard on a native WebView that does not shrink (iOS), whatever innerHeight does", async () => {
    await boot({ platform: "ios" })
    place("form", 0, REST)
    const { form, lower } = renderForm()

    focus(lower)
    resizeWebView(SHRUNK, { form: SHRUNK })
    raise()

    expect(form.style.paddingBottom).toBe(`${KEYBOARD + RESTING_GAP}px`)
  })
})

describe("AvoidKeyboard — Android native, scrolling the focused field clear", () => {
  //The keyboard line is the unpaid keyboard's top edge in layout coordinates. Two tempting
  //shortcuts read it off the viewport instead, and both double-count here:
  //`virtualKeyboard.overlaysContent` reads true on this WebView with `boundingRect` carrying the
  //whole keyboard (587 - 336 = 251), and `visualViewport.height` passes through 250.67 while the
  //IME animates with `innerHeight` already at 587 (both measured on a Pixel 10 emulator).
  it("derives the keyboard line from the unpaid keyboard, never from the VirtualKeyboard rect or the visual viewport", async () => {
    await boot()
    Object.defineProperty(navigator, "virtualKeyboard", {
      value: {
        overlaysContent: true,
        boundingRect: { height: KEYBOARD },
        addEventListener: () => {},
        removeEventListener: () => {},
      },
      configurable: true,
    })
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    })
    onTestFinished(() => {
      Reflect.deleteProperty(navigator, "virtualKeyboard")
      Reflect.deleteProperty(window, "isSecureContext")
    })
    place("form", 0, REST)
    place("upper", 100, 140)
    place("lower", 560, 600)
    const { form, lower } = renderForm()
    const scrollTo = makeScroller(form)

    focus(lower)
    resizeWebView(SHRUNK, { form: SHRUNK })
    viewport.height = 250.67
    raise()
    advance(FRAME_MS * 2)

    expect(form.style.paddingBottom).toBe("")
    //line = min(scroller 587, keyboard top 587) - 24 = 563; field bottom 600 → 37
    expect(scrollTo).toHaveBeenLastCalledWith({
      top: 37,
      behavior: "smooth",
    })
  })

  it("scrolls against the unpaid keyboard before the WebView has resized", async () => {
    await boot()
    place("form", 0, REST)
    place("upper", 100, 140)
    place("lower", 700, 740)
    const { form, lower } = renderForm()
    const scrollTo = makeScroller(form)

    focus(lower)
    raise()
    advance(FRAME_MS * 2)

    //the viewport is still whole, so the keyboard top is 923 - 336 = 587; line 563 → 177
    expect(scrollTo).toHaveBeenLastCalledWith({
      top: 177,
      behavior: "smooth",
    })
  })

  it("finishes a focus scroll when the resize lands inside its two frames, keyboard still closed", async () => {
    await boot()
    place("form", 0, REST)
    place("upper", 100, 140)
    place("lower", 700, 740)
    const { form, lower } = renderForm()
    const scrollTo = makeScroller(form)

    focus(lower)
    //the WebView's resize lands before the plugin's event, and before the scroll's second frame
    resizeWebView(SHRUNK, { form: SHRUNK })
    advance(FRAME_MS * 2)

    //no keyboard reported yet, so the line is the shrunk viewport: 587 - 24 = 563; 740 → 177
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenLastCalledWith({
      top: 177,
      behavior: "smooth",
    })
  })

  it("does not scroll again when the resize pays for a keyboard it already scrolled against", async () => {
    await boot()
    place("form", 0, REST)
    place("upper", 100, 140)
    place("lower", 700, 740)
    const { form, lower } = renderForm()
    const scrollTo = makeScroller(form)

    focus(lower)
    raise()
    advance(FRAME_MS * 2)
    const scrolls = scrollTo.mock.calls.length

    resizeWebView(SHRUNK, { form: SHRUNK })
    advance(FRAME_MS * 2)

    expect(scrollTo).toHaveBeenCalledTimes(scrolls)
  })
})

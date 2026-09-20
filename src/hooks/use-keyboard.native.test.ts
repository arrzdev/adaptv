import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

/*
 * useKeyboard's native branch over the REAL keyboard capability, per platform: only the Capacitor
 * plugin is authored. Where the Android WebView pays for the keyboard, layer 1 also hears every
 * window resize; none of that may stand in for, or swallow, a report the OS actually made — the OS
 * repeats a height (a field switch under the same keyboard) and hides during a prediction, and
 * both must reach the prediction and the height cache exactly as they do on iOS.
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
const originalSize = {
  width: window.innerWidth,
  height: window.innerHeight,
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

/** A cold launch on `platform`, then the shell's `initNativeKeyboard`. */
async function boot(platform: "ios" | "android") {
  vi.resetModules()
  plugin.listeners.clear()
  vi.stubGlobal("Capacitor", {
    isNativePlatform: () => true,
    getPlatform: () => platform,
  })
  setWindowSize(412, REST)
  const keyboard = await import("#adaptv/capabilities/keyboard")
  keyboard.initNativeKeyboard()
  const { useKeyboard } = await import("#adaptv/hooks/use-keyboard")
  const cache = await import("#adaptv/capabilities/keyboard-height-cache")
  cache.__resetKeyboardHeightCacheForTests()
  return { useKeyboard, cache }
}

function field(type = "text") {
  const el = document.createElement("input")
  el.type = type
  document.body.appendChild(el)
  return el
}

function focus(el: HTMLElement) {
  act(() => {
    el.focus()
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }))
  })
}

function show(height: number) {
  act(() => {
    plugin.listeners.get("keyboardWillShow")?.({ keyboardHeight: height })
  })
}

function hide() {
  act(() => {
    plugin.listeners.get("keyboardWillHide")?.()
  })
}

function resize(height: number) {
  act(() => {
    setWindowSize(window.innerWidth, height)
    window.dispatchEvent(new Event("resize"))
  })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
  setWindowSize(originalSize.width, originalSize.height)
  delete (window as unknown as Record<string, unknown>)
    .__adaptvKeyboardMock
  localStorage.clear()
})

describe.each(["ios", "android"] as const)(
  "useKeyboard — native OS reports (%s)",
  (platform) => {
    it("learns a field switched to under the same keyboard height", async () => {
      const { useKeyboard, cache } = await boot(platform)
      renderHook(() => useKeyboard({ predictFromCache: true }))
      const text = field("text")
      const tel = field("tel")

      focus(text)
      show(KEYBOARD)
      if (platform === "android") resize(REST - KEYBOARD)
      //the digit pad happens to be as tall: the OS reports the very same height for the new field
      focus(tel)
      show(KEYBOARD)

      expect(cache.predictKeyboardHeight(tel)).toBe(KEYBOARD)
    })

    it("closes a pending prediction the moment the OS hides the keyboard", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
      const { useKeyboard, cache } = await boot(platform)
      const text = field("text")
      cache.recordKeyboardHeight(text, KEYBOARD)
      const { result } = renderHook(() =>
        useKeyboard({ predictFromCache: true }),
      )

      focus(text)
      expect(result.current.isOpen).toBe(true)
      //a hardware keyboard: the OS says there is none, well inside the prediction's retract window
      hide()

      expect(result.current).toMatchObject({ isOpen: false, height: 0 })
    })
  },
)

describe("useKeyboard — the harness seam on Android native", () => {
  function setSeam(height: number) {
    act(() => {
      ;(
        window as unknown as Record<string, unknown>
      ).__adaptvKeyboardMock = {
        isOpen: height > 0,
        height,
      }
      window.dispatchEvent(new Event("adaptv:keyboard-mock"))
    })
  }

  it("reports the seam's keyboard as wholly unpaid, whatever the WebView did", async () => {
    const { useKeyboard } = await boot("android")
    setSeam(0)
    const { result } = renderHook(() => useKeyboard())
    //a field is focused and the WebView shrinks: layer 1 keeps the 923 rest, so it would pay
    focus(field("text"))
    resize(REST - KEYBOARD)

    setSeam(KEYBOARD)

    expect(result.current).toEqual({
      isOpen: true,
      height: KEYBOARD,
      unpaidHeight: KEYBOARD,
      resizesLayoutViewport: false,
    })
  })
})

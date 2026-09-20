import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@capacitor/keyboard", () => ({
  Keyboard: {
    addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })),
    setResizeMode: vi.fn(() => Promise.resolve()),
  },
  KeyboardResize: { None: "none", Body: "body", Native: "native" },
}))

function forceNative(
  native: boolean,
  platform: "ios" | "android" = "ios",
): void {
  vi.stubGlobal(
    "Capacitor",
    native
      ? { isNativePlatform: () => true, getPlatform: () => platform }
      : undefined,
  )
}

// Every rejection that reaches the process unhandled while `run` executes, collected
// across a macrotask: Node only decides a rejection went unhandled once the microtask
// queue has drained, so awaiting a resolved promise would read the list too early.
async function unhandledRejectionsDuring(
  run: () => void,
): Promise<unknown[]> {
  const seen: unknown[] = []
  const onRejection = (reason: unknown) => seen.push(reason)
  process.on("unhandledRejection", onRejection)
  try {
    run()
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    process.off("unhandledRejection", onRejection)
  }
  return seen
}

// A fresh SUT per test so the app-lifetime `attached` singleton resets; grab the
// same (freshly re-mocked) Keyboard instance the SUT will use.
async function load() {
  vi.resetModules()
  const { Keyboard } = await import("@capacitor/keyboard")
  const sut = await import("#adaptv/capabilities/keyboard")
  const listenerFor = (event: string) =>
    vi
      .mocked(Keyboard.addListener)
      .mock.calls.find((c) => c[0] === event)?.[1] as
      | ((info?: unknown) => void)
      | undefined
  return { ...sut, Keyboard, listenerFor }
}

function setViewport(width: number, height: number): void {
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

function resizeViewport(width: number, height: number): void {
  setViewport(width, height)
  window.dispatchEvent(new Event("resize"))
}

const RESTING_VIEWPORT = {
  width: window.innerWidth,
  height: window.innerHeight,
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  setViewport(RESTING_VIEWPORT.width, RESTING_VIEWPORT.height)
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  document.body.replaceChildren()
})

// A native shell whose binary lists exactly these plugins, the way the native layer
// injects `Capacitor.PluginHeaders` before any app JS runs.
function forceNativeBinary(
  plugins: string[],
  platform: "ios" | "android" = "android",
): void {
  vi.stubGlobal("Capacitor", {
    isNativePlatform: () => true,
    getPlatform: () => platform,
    PluginHeaders: plugins.map((name) => ({ name })),
  })
}

describe("hasNativeKeyboard", () => {
  it("tracks the platform", async () => {
    const { hasNativeKeyboard } = await load()
    forceNative(true)
    expect(hasNativeKeyboard()).toBe(true)
    forceNative(false)
    expect(hasNativeKeyboard()).toBe(false)
  })

  it("is true on a binary that carries the plugin", async () => {
    const { hasNativeKeyboard } = await load()
    forceNativeBinary(["Keyboard", "Haptics"])
    expect(hasNativeKeyboard()).toBe(true)
  })

  // The Android binaries that shipped without adaptv's plugins (register.md, "Root
  // cause — and it is much wider than the status bar") reject every Keyboard call.
  // Answering `true` there sends use-keyboard down the native branch, whose events
  // never arrive, and the drawer never lifts over the keyboard: the web path is the
  // one that still works.
  it.each(["android", "ios"] as const)(
    "is false on a binary without the plugin (%s)",
    async (platform) => {
      const { hasNativeKeyboard } = await load()
      forceNativeBinary(["Haptics", "Device"], platform)
      expect(hasNativeKeyboard()).toBe(false)
    },
  )
})

describe("initNativeKeyboard", () => {
  it("attaches will-show + will-hide once, eagerly (native)", async () => {
    const { initNativeKeyboard, Keyboard } = await load()
    forceNative(true)
    initNativeKeyboard()
    const events = vi
      .mocked(Keyboard.addListener)
      .mock.calls.map((c) => c[0])
    expect(events).toContain("keyboardWillShow")
    expect(events).toContain("keyboardWillHide")

    // idempotent — a second call must not re-register (would double-fire consumers)
    initNativeKeyboard()
    expect(vi.mocked(Keyboard.addListener).mock.calls).toHaveLength(2)
  })

  it("suppresses OS webview resize (mode None) on iOS", async () => {
    const { initNativeKeyboard, Keyboard } = await load()
    forceNative(true, "ios")
    initNativeKeyboard()
    expect(Keyboard.setResizeMode).toHaveBeenCalledWith({ mode: "none" })
  })

  // Resize mode is an iOS concept: the Android plugin answers `setResizeMode` with
  // `call.unimplemented()`, and Android's keyboard behaviour is the WebView's own
  // window resize. Asking there only ever produces a rejection.
  it("does not ask Android for a resize mode it does not have", async () => {
    const { initNativeKeyboard, Keyboard } = await load()
    forceNative(true, "android")
    initNativeKeyboard()
    expect(Keyboard.setResizeMode).not.toHaveBeenCalled()
    const events = vi
      .mocked(Keyboard.addListener)
      .mock.calls.map((c) => c[0])
    expect(events).toEqual(["keyboardWillShow", "keyboardWillHide"])
  })

  // `initNativeKeyboard` runs in the shell's boot effect; a rejection escaping it is
  // an unhandled rejection on every cold launch.
  it.each(["android", "ios"] as const)(
    "lets no rejected resize-mode call escape at boot (%s)",
    async (platform) => {
      const { initNativeKeyboard, Keyboard } = await load()
      forceNative(true, platform)
      // A plain function, not a `vi.fn`: a spy subscribes to every promise its
      // implementation returns (to record `settledResults`), which marks the
      // rejection handled and would let this test pass against the bug. The mocked
      // module object outlives `vi.resetModules`, so the spy is put back after.
      const spy = Keyboard.setResizeMode
      Keyboard.setResizeMode = () =>
        Promise.reject(new Error("not implemented"))
      try {
        const escaped = await unhandledRejectionsDuring(() =>
          initNativeKeyboard(),
        )
        expect(escaped).toEqual([])
      } finally {
        Keyboard.setResizeMode = spy
      }
    },
  )

  // A binary without the plugin, or an OS error: both listener registrations reject,
  // and at boot nothing else would handle them. The accessor stays usable, silent.
  it.each(["android", "ios"] as const)(
    "lets no rejected listener registration escape at boot (%s)",
    async (platform) => {
      const { initNativeKeyboard, subscribeNativeKeyboard, Keyboard } =
        await load()
      forceNative(true, platform)
      // plain functions for the reason given above
      const spies = {
        addListener: Keyboard.addListener,
        setResizeMode: Keyboard.setResizeMode,
      }
      Keyboard.addListener = () =>
        Promise.reject(new Error('"Keyboard" plugin is not implemented'))
      Keyboard.setResizeMode = () => Promise.resolve()
      try {
        const escaped = await unhandledRejectionsDuring(() => {
          initNativeKeyboard()
          subscribeNativeKeyboard(() => {})()
        })
        expect(escaped).toEqual([])
      } finally {
        Object.assign(Keyboard, spies)
      }
    },
  )

  it("asks nothing of a binary without the plugin", async () => {
    const { initNativeKeyboard, subscribeNativeKeyboard, Keyboard } =
      await load()
    forceNativeBinary(["Haptics"], "ios")
    initNativeKeyboard()
    subscribeNativeKeyboard(() => {})()
    expect(Keyboard.addListener).not.toHaveBeenCalled()
    expect(Keyboard.setResizeMode).not.toHaveBeenCalled()
  })

  it("is a no-op off native", async () => {
    const { initNativeKeyboard, Keyboard } = await load()
    forceNative(false)
    initNativeKeyboard()
    expect(Keyboard.addListener).not.toHaveBeenCalled()
  })
})

describe("subscribeNativeKeyboard", () => {
  it("is a no-op off native (no listeners registered)", async () => {
    const { subscribeNativeKeyboard, Keyboard } = await load()
    forceNative(false)
    const cb = vi.fn()
    const unsub = subscribeNativeKeyboard(cb)
    expect(Keyboard.addListener).not.toHaveBeenCalled()
    expect(() => unsub()).not.toThrow()
  })

  it("reports exact height on will-show and 0 on will-hide", async () => {
    const { subscribeNativeKeyboard, listenerFor } = await load()
    forceNative(true)
    const cb = vi.fn()
    subscribeNativeKeyboard(cb)

    listenerFor("keyboardWillShow")?.({ keyboardHeight: 336 })
    expect(cb).toHaveBeenCalledWith({
      isOpen: true,
      height: 336,
      unpaidHeight: 336,
      resizesLayoutViewport: false,
    })

    listenerFor("keyboardWillHide")?.()
    expect(cb).toHaveBeenCalledWith({
      isOpen: false,
      height: 0,
      unpaidHeight: 0,
      resizesLayoutViewport: false,
    })
  })

  it("delivers the current state synchronously when already open", async () => {
    const { subscribeNativeKeyboard, listenerFor } = await load()
    forceNative(true)
    // keyboard already up (e.g. a drawer reopening under a raised keyboard)
    subscribeNativeKeyboard(vi.fn())
    listenerFor("keyboardWillShow")?.({ keyboardHeight: 300 })

    const late = vi.fn()
    subscribeNativeKeyboard(late)
    expect(late).toHaveBeenCalledWith({
      isOpen: true,
      height: 300,
      unpaidHeight: 300,
      resizesLayoutViewport: false,
    })
  })

  it("does not re-register OS listeners per subscriber (shares the app-wide set)", async () => {
    const { subscribeNativeKeyboard, Keyboard } = await load()
    forceNative(true)
    subscribeNativeKeyboard(vi.fn())
    subscribeNativeKeyboard(vi.fn())
    // exactly the two app-lifetime listeners, not two-per-subscriber
    expect(vi.mocked(Keyboard.addListener).mock.calls).toHaveLength(2)
  })

  // The OS listeners are app-lifetime on purpose (a lazy re-bind per consumer loses
  // the autofocus race), so the last subscriber leaving before the handles resolve —
  // StrictMode's dev double-mount — must neither remove them nor force a re-bind.
  it("keeps the OS listeners when the last subscriber leaves before they resolve", async () => {
    const { subscribeNativeKeyboard, Keyboard, listenerFor } = await load()
    forceNative(true)
    const removes: Array<() => Promise<void>> = []
    vi.mocked(Keyboard.addListener).mockImplementation(() => {
      const remove = vi.fn(() => Promise.resolve())
      removes.push(remove)
      return Promise.resolve({ remove })
    })
    subscribeNativeKeyboard(vi.fn())()
    await new Promise((resolve) => setTimeout(resolve, 0))
    for (const remove of removes) expect(remove).not.toHaveBeenCalled()

    const later = vi.fn()
    subscribeNativeKeyboard(later)
    expect(vi.mocked(Keyboard.addListener).mock.calls).toHaveLength(2)
    listenerFor("keyboardWillShow")?.({ keyboardHeight: 310 })
    expect(later).toHaveBeenCalledWith({
      isOpen: true,
      height: 310,
      unpaidHeight: 310,
      resizesLayoutViewport: false,
    })
  })

  it("unsubscribing stops delivery to that consumer only", async () => {
    const { subscribeNativeKeyboard, listenerFor } = await load()
    forceNative(true)
    const a = vi.fn()
    const b = vi.fn()
    const unsubA = subscribeNativeKeyboard(a)
    subscribeNativeKeyboard(b)
    unsubA()
    listenerFor("keyboardWillShow")?.({ keyboardHeight: 320 })
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledWith({
      isOpen: true,
      height: 320,
      unpaidHeight: 320,
      resizesLayoutViewport: false,
    })
  })
})

/* =============================================================================
 * The unpaid part: what the layout viewport has not already given up for the keyboard.
 * Pixel 10 emulator numbers: `innerHeight` 923 at rest, 587 under a 336px keyboard.
 * ============================================================================= */

describe("unpaidHeight", () => {
  function resizeListenerCount(spy: ReturnType<typeof vi.spyOn>): number {
    return spy.mock.calls.filter((call: unknown[]) => call[0] === "resize")
      .length
  }

  function focusTextField(): HTMLInputElement {
    const field = document.createElement("input")
    document.body.appendChild(field)
    field.focus()
    return field
  }

  it.each([
    ["iOS native", true],
    ["web", false],
  ] as const)(
    "equals height and watches no resize off Android native (%s)",
    async (_, native) => {
      const addListener = vi.spyOn(window, "addEventListener")
      const {
        initNativeKeyboard,
        measureKeyboardPayment,
        subscribeNativeKeyboard,
        listenerFor,
      } = await load()
      forceNative(native, "ios")
      setViewport(390, 844)
      initNativeKeyboard()
      const cb = vi.fn()
      subscribeNativeKeyboard(cb)
      expect(resizeListenerCount(addListener)).toBe(0)

      setViewport(390, 508) //even a viewport that did shrink pays nothing here
      expect(measureKeyboardPayment(336)).toEqual({
        unpaidHeight: 336,
        resizesLayoutViewport: false,
      })
      listenerFor("keyboardWillShow")?.({ keyboardHeight: 336 })
      if (native) {
        expect(cb).toHaveBeenLastCalledWith({
          isOpen: true,
          height: 336,
          unpaidHeight: 336,
          resizesLayoutViewport: false,
        })
      }
    },
  )

  //An Android binary without the plugin takes `useKeyboard`'s web path (`hasNativeKeyboard`),
  //where the visual viewport is the keyboard measure. Reporting that the layout viewport
  //resizes for the keyboard there would hand AvoidKeyboard a line it never reads, and an
  //`unpaidHeight` of 0 for a keyboard the web path measured in full.
  it("pays for nothing on an Android binary without the plugin", async () => {
    const addListener = vi.spyOn(window, "addEventListener")
    const { initNativeKeyboard, measureKeyboardPayment } = await load()
    forceNativeBinary(["Haptics", "Device"], "android")
    setViewport(412, 923)
    initNativeKeyboard()
    expect(resizeListenerCount(addListener)).toBe(0)
    setViewport(412, 587) //the WebView did shrink, but nobody here measures it
    expect(measureKeyboardPayment(336)).toEqual({
      unpaidHeight: 336,
      resizesLayoutViewport: false,
    })
  })

  describe("Android native", () => {
    async function boot(width: number, height: number) {
      const loaded = await load()
      forceNative(true, "android")
      setViewport(width, height)
      loaded.initNativeKeyboard()
      const cb = vi.fn()
      loaded.subscribeNativeKeyboard(cb)
      const show = (keyboardHeight: number) =>
        loaded.listenerFor("keyboardWillShow")?.({ keyboardHeight })
      const hide = () => loaded.listenerFor("keyboardWillHide")?.()
      return { ...loaded, cb, show, hide }
    }

    it("seeds the rest at boot, so a keyboard before any resize is wholly unpaid", async () => {
      const { cb, show } = await boot(412, 923)
      show(336)
      expect(cb).toHaveBeenLastCalledWith({
        isOpen: true,
        height: 336,
        unpaidHeight: 336,
        resizesLayoutViewport: true,
      })
    })

    it("re-emits on the resize that pays for the keyboard", async () => {
      const { cb, show } = await boot(412, 923)
      show(336)
      resizeViewport(412, 587)
      expect(cb).toHaveBeenLastCalledWith({
        isOpen: true,
        height: 336,
        unpaidHeight: 0,
        resizesLayoutViewport: true,
      })
    })

    it("keeps the rest when the resize lands first, under a focused field", async () => {
      const { cb, show, measureKeyboardPayment } = await boot(412, 923)
      focusTextField()
      resizeViewport(412, 587)
      expect(cb).toHaveBeenLastCalledWith(
        expect.objectContaining({ isOpen: false, height: 0 }),
      )
      expect(measureKeyboardPayment(336).unpaidHeight).toBe(0)
      show(336)
      expect(cb).toHaveBeenLastCalledWith(
        expect.objectContaining({ unpaidHeight: 0 }),
      )
    })

    it("keeps the rest for a resize while the keyboard is open, focus or not", async () => {
      const { cb, show } = await boot(412, 923)
      show(336)
      resizeViewport(412, 587)
      resizeViewport(412, 580) //the suggestion strip grows under a keyboard nobody focused
      show(343)
      expect(cb).toHaveBeenLastCalledWith(
        expect.objectContaining({ height: 343, unpaidHeight: 0 }),
      )
    })

    it.each([
      ["a textarea", () => document.createElement("textarea")],
      [
        "a contenteditable",
        () => {
          const editable = document.createElement("div")
          editable.contentEditable = "true"
          return editable
        },
      ],
    ])(
      "keeps the rest when the resize lands first, under %s",
      async (_, make) => {
        const { measureKeyboardPayment } = await boot(412, 923)
        const editor = make()
        document.body.appendChild(editor)
        editor.focus()
        expect(document.activeElement).toBe(editor)

        resizeViewport(412, 587)
        expect(measureKeyboardPayment(336).unpaidHeight).toBe(0)
      },
    )

    it("tells OS reports and resizes apart, a repeated report included", async () => {
      const { listenNativeKeyboard, show, hide } = await boot(412, 923)
      const onReport = vi.fn()
      const onPaymentChange = vi.fn()
      listenNativeKeyboard({ onReport, onPaymentChange })

      show(336)
      resizeViewport(412, 587)
      show(336) //the same keyboard, reported again for the next field
      hide()

      expect(onReport.mock.calls.map(([info]) => info)).toEqual([
        {
          isOpen: true,
          height: 336,
          unpaidHeight: 336,
          resizesLayoutViewport: true,
        },
        {
          isOpen: true,
          height: 336,
          unpaidHeight: 0,
          resizesLayoutViewport: true,
        },
        {
          isOpen: false,
          height: 0,
          unpaidHeight: 0,
          resizesLayoutViewport: true,
        },
      ])
      expect(onPaymentChange).toHaveBeenCalledTimes(1)
    })

    it("finds the focused field inside an open shadow root", async () => {
      const { show, measureKeyboardPayment } = await boot(412, 923)
      const host = document.createElement("div")
      document.body.appendChild(host)
      const field = document.createElement("input")
      host.attachShadow({ mode: "open" }).appendChild(field)
      field.focus()
      expect(document.activeElement).toBe(host)

      resizeViewport(412, 587)
      show(336)
      expect(measureKeyboardPayment(336).unpaidHeight).toBe(0)
    })

    it("takes a resize with no keyboard-raising focus as the new rest", async () => {
      const { measureKeyboardPayment } = await boot(412, 923)
      const checkbox = document.createElement("input")
      checkbox.type = "checkbox"
      document.body.appendChild(checkbox)
      checkbox.focus()
      resizeViewport(412, 700) //split-screen, say: a real rest change
      expect(measureKeyboardPayment(336)).toEqual({
        unpaidHeight: 336,
        resizesLayoutViewport: true,
      })
    })

    it("lets a resize under a focused field only RAISE the rest", async () => {
      //booted short (a transient inset at launch); the field is focused before the viewport grows
      const { measureKeyboardPayment } = await boot(412, 587)
      focusTextField()
      resizeViewport(412, 923)
      resizeViewport(412, 587) //the keyboard's resize, first
      expect(measureKeyboardPayment(336).unpaidHeight).toBe(0)
    })

    it("keeps one rest per width, so a rotation under the keyboard reads its own", async () => {
      const { cb, show } = await boot(412, 923)
      resizeViewport(915, 380) //landscape, keyboard down
      focusTextField()
      resizeViewport(915, 150)
      show(230)
      expect(cb).toHaveBeenLastCalledWith(
        expect.objectContaining({ height: 230, unpaidHeight: 0 }),
      )
      //rotated back with the keyboard still up
      resizeViewport(412, 587)
      show(336)
      expect(cb).toHaveBeenLastCalledWith(
        expect.objectContaining({ height: 336, unpaidHeight: 0 }),
      )
    })

    it("counts a width first reached under the keyboard as already paid", async () => {
      const { cb, show } = await boot(412, 923)
      focusTextField()
      show(336)
      resizeViewport(600, 500) //a window resize to a width never seen at rest
      expect(cb).toHaveBeenLastCalledWith(
        expect.objectContaining({ height: 336, unpaidHeight: 0 }),
      )
    })
  })
})

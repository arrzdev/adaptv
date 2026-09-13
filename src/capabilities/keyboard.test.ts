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

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("hasNativeKeyboard", () => {
  it("tracks the platform", async () => {
    const { hasNativeKeyboard } = await load()
    forceNative(true)
    expect(hasNativeKeyboard()).toBe(true)
    forceNative(false)
    expect(hasNativeKeyboard()).toBe(false)
  })
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
    expect(cb).toHaveBeenCalledWith({ isOpen: true, height: 336 })

    listenerFor("keyboardWillHide")?.()
    expect(cb).toHaveBeenCalledWith({ isOpen: false, height: 0 })
  })

  it("delivers the current state synchronously when already open", async () => {
    const { subscribeNativeKeyboard, listenerFor } = await load()
    forceNative(true)
    // keyboard already up (e.g. a drawer reopening under a raised keyboard)
    subscribeNativeKeyboard(vi.fn())
    listenerFor("keyboardWillShow")?.({ keyboardHeight: 300 })

    const late = vi.fn()
    subscribeNativeKeyboard(late)
    expect(late).toHaveBeenCalledWith({ isOpen: true, height: 300 })
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
    expect(later).toHaveBeenCalledWith({ isOpen: true, height: 310 })
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
    expect(b).toHaveBeenCalledWith({ isOpen: true, height: 320 })
  })
})

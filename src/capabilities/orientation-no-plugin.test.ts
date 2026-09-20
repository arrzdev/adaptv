import { afterEach, describe, expect, it, vi } from "vitest"

//→ docs/design/ota.md §5.6. An OTA bundle can run on a binary that predates the
//ScreenOrientation plugin. There the bridge rejects every call, while the
//WebView's own screen.orientation still reads and still fires, so the read and
//the subscription belong on the web path exactly as the lock already is. The
//binary is described the way the device describes it, through
//`Capacitor.PluginHeaders`, which is what `hasNativePlugin` reads.

const restores: Array<() => void> = []

afterEach(() => {
  for (const r of restores.splice(0)) r()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** A native shell whose binary carries exactly `plugins` and nothing else. */
function forceNativeBinary(plugins: string[]): void {
  vi.stubGlobal("Capacitor", {
    isNativePlatform: () => true,
    PluginHeaders: plugins.map((name) => ({ name })),
  })
}

function stubScreenOrientation(value: object | undefined): void {
  const prev = Object.getOwnPropertyDescriptor(
    window.screen,
    "orientation",
  )
  Object.defineProperty(window.screen, "orientation", {
    value,
    configurable: true,
  })
  restores.push(() => {
    if (prev) Object.defineProperty(window.screen, "orientation", prev)
    else
      delete (window.screen as unknown as Record<string, unknown>)
        .orientation
  })
}

/** A `screen.orientation` that can rotate and fire its own `change` event. */
function rotatableOrientation(type: string) {
  return Object.assign(new EventTarget(), { type })
}

/**
 * A fresh accessor on a binary carrying `plugins`, over a stand-in
 * `@capacitor/screen-orientation` that counts its calls. Both bindings are
 * process singletons, so each test gets its own module. The stand-in behaves
 * like the real bridge proxy: it rejects every call when the binary lacks the
 * plugin, and otherwise answers "landscape-primary", which no web stub here
 * reports, so a read that went through it shows.
 */
async function accessorOnBinary(plugins: string[]) {
  const calls = { orientation: 0, addListener: 0 }
  const present = plugins.includes("ScreenOrientation")
  const missing = () =>
    Promise.reject(new Error("ScreenOrientation is not implemented"))
  let onChange: (result: { type: string }) => void = () => {}
  vi.resetModules()
  vi.doMock("@capacitor/screen-orientation", () => ({
    ScreenOrientation: {
      orientation: () => {
        calls.orientation += 1
        if (!present) return missing()
        return Promise.resolve({ type: "landscape-primary" })
      },
      addListener: (
        _event: string,
        listener: (result: { type: string }) => void,
      ) => {
        calls.addListener += 1
        if (!present) return missing()
        onChange = listener
        return Promise.resolve({ remove: () => Promise.resolve() })
      },
    },
  }))
  restores.push(() => {
    vi.doUnmock("@capacitor/screen-orientation")
    vi.resetModules()
  })
  forceNativeBinary(plugins)
  const accessor = await import("#adaptv/capabilities/orientation")
  return {
    ...accessor,
    calls,
    rotateNative: (type: string) => onChange({ type }),
  }
}

/** Leave the turn so every settled bridge promise has run its handlers. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("orientation — a binary without the plugin reads the WebView", () => {
  it("reads screen.orientation.type rather than a plugin that is not there", async () => {
    stubScreenOrientation({ type: "landscape-secondary" })
    const { getScreenOrientation, calls } = await accessorOnBinary([])
    expect(getScreenOrientation()).toBe("landscape-secondary")
    expect(calls.orientation).toBe(0)
  })

  it("falls back to the media query when the WebView has no screen.orientation", async () => {
    stubScreenOrientation(undefined)
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query === "(orientation: landscape)",
        }) as MediaQueryList,
    )
    //another plugin compiled in is not this one
    const { getScreenOrientation } = await accessorOnBinary(["Share"])
    expect(getScreenOrientation()).toBe("landscape-primary")
  })

  it("tells a subscriber about screen.orientation's change event, and never binds the bridge", async () => {
    const orientation = rotatableOrientation("portrait-primary")
    stubScreenOrientation(orientation)
    const { getScreenOrientation, subscribeScreenOrientation, calls } =
      await accessorOnBinary(["Share"])
    //a subscriber reads the snapshot when told, as useSyncExternalStore does
    const seen: string[] = []
    const unsub = subscribeScreenOrientation(() =>
      seen.push(getScreenOrientation()),
    )
    await settle()
    expect(seen).toEqual([])

    orientation.type = "landscape-secondary"
    orientation.dispatchEvent(new Event("change"))
    expect(seen).toEqual(["landscape-secondary"])
    expect(calls).toEqual({ orientation: 0, addListener: 0 })
    unsub()
  })

  it("tells a subscriber about orientationchange, and stops after unsubscribe", async () => {
    const orientation = rotatableOrientation("portrait-primary")
    stubScreenOrientation(orientation)
    const { getScreenOrientation, subscribeScreenOrientation } =
      await accessorOnBinary([])
    const seen: string[] = []
    const unsub = subscribeScreenOrientation(() =>
      seen.push(getScreenOrientation()),
    )

    orientation.type = "portrait-secondary"
    window.dispatchEvent(new Event("orientationchange"))
    expect(seen).toEqual(["portrait-secondary"])

    unsub()
    window.dispatchEvent(new Event("orientationchange"))
    expect(seen).toEqual(["portrait-secondary"])
  })
})

describe("orientation — a binary with the plugin still goes through it", () => {
  it("reads and subscribes through the plugin, not the WebView", async () => {
    const orientation = rotatableOrientation("portrait-secondary")
    stubScreenOrientation(orientation)
    const {
      getScreenOrientation,
      subscribeScreenOrientation,
      calls,
      rotateNative,
    } = await accessorOnBinary(["Share", "ScreenOrientation"])
    //before the plugin has answered, the read is the default, not the WebView's
    expect(getScreenOrientation()).toBe("portrait-primary")

    const seen: string[] = []
    const unsub = subscribeScreenOrientation(() =>
      seen.push(getScreenOrientation()),
    )
    await settle()
    expect(calls).toEqual({ orientation: 1, addListener: 1 })
    expect(seen).toEqual(["landscape-primary"])

    rotateNative("landscape-secondary")
    expect(seen).toEqual(["landscape-primary", "landscape-secondary"])

    //the WebView's own signals are not bound on this path
    orientation.dispatchEvent(new Event("change"))
    window.dispatchEvent(new Event("orientationchange"))
    expect(seen).toEqual(["landscape-primary", "landscape-secondary"])
    unsub()
  })
})

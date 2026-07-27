import { SystemBars, SystemBarsStyle } from "@capacitor/core"
import { StatusBar } from "@capacitor/status-bar"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  applyStatusBar,
  enableEdgeToEdge,
} from "#adaptv/capabilities/status-bar"

vi.mock("@capacitor/core", () => ({
  SystemBars: {
    setStyle: vi.fn(() => Promise.resolve()),
  },
  SystemBarsStyle: { Dark: "DARK", Light: "LIGHT", Default: "DEFAULT" },
}))

vi.mock("@capacitor/status-bar", () => ({
  StatusBar: {
    //kept only to prove applyStatusBar never touches the dead colour call
    setBackgroundColor: vi.fn(() => Promise.resolve()),
    setOverlaysWebView: vi.fn(() => Promise.resolve()),
  },
}))

function forceNative(native: boolean): void {
  vi.stubGlobal(
    "Capacitor",
    native ? { isNativePlatform: () => true } : undefined,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("applyStatusBar", () => {
  it("is a no-op on web (browser owns the bars)", () => {
    forceNative(false)
    applyStatusBar("dark")
    expect(SystemBars.setStyle).not.toHaveBeenCalled()
  })

  it("maps appearance → SystemBarsStyle (Dark = light content for a dark bg)", () => {
    forceNative(true)
    applyStatusBar("dark")
    expect(SystemBars.setStyle).toHaveBeenCalledWith({
      style: SystemBarsStyle.Dark,
    })
    applyStatusBar("light")
    expect(SystemBars.setStyle).toHaveBeenCalledWith({
      style: SystemBarsStyle.Light,
    })
  })

  it("never calls the dead StatusBar.setBackgroundColor (bar bg is CSS-driven)", () => {
    forceNative(true)
    applyStatusBar("light")
    expect(StatusBar.setBackgroundColor).not.toHaveBeenCalled()
  })
})

describe("enableEdgeToEdge", () => {
  it("overlays the webview on native, no-ops on web", () => {
    forceNative(true)
    enableEdgeToEdge()
    expect(StatusBar.setOverlaysWebView).toHaveBeenCalledWith({
      overlay: true,
    })

    vi.clearAllMocks()
    forceNative(false)
    enableEdgeToEdge()
    expect(StatusBar.setOverlaysWebView).not.toHaveBeenCalled()
  })

  //the grey-status-bar bug: SystemBars' viewport-fit=cover probe is one-shot at
  //DOMContentLoaded and loses a race with the app's boot, leaving it on the inset-padding
  //fallback forever. Re-running it until a pass actually lands is the whole fix.
  it("re-probes the Android SystemBars bridge until insets land", () => {
    const onDOMReady = vi.fn()
    vi.stubGlobal("CapacitorSystemBarsAndroidInterface", { onDOMReady })
    const frames: Array<() => void> = []
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb)
      return frames.length
    })
    forceNative(true)

    enableEdgeToEdge()
    expect(onDOMReady).toHaveBeenCalledTimes(1)

    //no injected var yet → every watched frame pays for another probe
    frames.shift()?.()
    frames.shift()?.()
    expect(onDOMReady).toHaveBeenCalledTimes(3)

    //SystemBars' pass lands (this is exactly what the plugin writes) → the watch idles
    document.documentElement.style.setProperty(
      "--safe-area-inset-top",
      "54px",
    )
    frames.shift()?.()
    expect(onDOMReady).toHaveBeenCalledTimes(3)

    //…and picks straight back up if the document reconcile wipes it again
    document.documentElement.style.removeProperty("--safe-area-inset-top")
    frames.shift()?.()
    expect(onDOMReady).toHaveBeenCalledTimes(4)
  })

  it("stops watching once the boot window is up", () => {
    const onDOMReady = vi.fn()
    vi.stubGlobal("CapacitorSystemBarsAndroidInterface", { onDOMReady })
    const frames: Array<() => void> = []
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      frames.push(cb)
      return frames.length
    })
    vi.useFakeTimers()
    forceNative(true)

    enableEdgeToEdge()
    vi.advanceTimersByTime(3000)
    frames.shift()?.()
    expect(frames).toHaveLength(0)
    vi.useRealTimers()
  })

  it("does not touch the Android bridge on web", () => {
    const onDOMReady = vi.fn()
    vi.stubGlobal("CapacitorSystemBarsAndroidInterface", { onDOMReady })
    forceNative(false)
    enableEdgeToEdge()
    expect(onDOMReady).not.toHaveBeenCalled()
  })

  //iOS: the bridge object only exists on Android, so the re-probe must stay silent
  it("survives a native platform with no SystemBars bridge (iOS)", () => {
    forceNative(true)
    expect(() => enableEdgeToEdge()).not.toThrow()
    expect(StatusBar.setOverlaysWebView).toHaveBeenCalledWith({
      overlay: true,
    })
  })
})

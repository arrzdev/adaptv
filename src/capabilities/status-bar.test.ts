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
})

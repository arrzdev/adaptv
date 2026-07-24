import { StatusBar, Style } from "@capacitor/status-bar"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  applyStatusBar,
  enableEdgeToEdge,
} from "#adaptv/capabilities/status-bar"

vi.mock("@capacitor/status-bar", () => ({
  StatusBar: {
    setStyle: vi.fn(() => Promise.resolve()),
    setBackgroundColor: vi.fn(() => Promise.resolve()),
    setOverlaysWebView: vi.fn(() => Promise.resolve()),
  },
  Style: { Dark: "DARK", Light: "LIGHT", Default: "DEFAULT" },
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
  it("is a no-op on web (browser owns the bar)", () => {
    forceNative(false)
    applyStatusBar("dark", "#000000")
    expect(StatusBar.setStyle).not.toHaveBeenCalled()
  })

  it("maps appearance → Style (Dark = light content for a dark bg)", () => {
    forceNative(true)
    applyStatusBar("dark")
    expect(StatusBar.setStyle).toHaveBeenCalledWith({ style: Style.Dark })
    applyStatusBar("light")
    expect(StatusBar.setStyle).toHaveBeenCalledWith({ style: Style.Light })
  })

  it("applies a background color when given", () => {
    forceNative(true)
    applyStatusBar("light", "#eeeeec")
    expect(StatusBar.setBackgroundColor).toHaveBeenCalledWith({
      color: "#eeeeec",
    })
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

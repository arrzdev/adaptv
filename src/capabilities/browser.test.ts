import { Browser } from "@capacitor/browser"
import { afterEach, describe, expect, it, vi } from "vitest"
import { isExternalUrl, openExternal } from "#nativ/capabilities/browser"

vi.mock("@capacitor/browser", () => ({
  Browser: { open: vi.fn(() => Promise.resolve()) },
}))

function forceNative(native: boolean): void {
  vi.stubGlobal(
    "Capacitor",
    native ? { isNativePlatform: () => true } : undefined,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe("isExternalUrl", () => {
  it("treats scheme + protocol-relative URLs as external", () => {
    for (const href of [
      "http://x.com",
      "https://x.com/a?b=1",
      "mailto:a@b.com",
      "tel:+15551234",
      "//cdn.example.com/x",
    ]) {
      expect(isExternalUrl(href)).toBe(true)
    }
  })

  it("treats route paths as internal", () => {
    for (const href of ["/settings", "settings", "/decks/1", ""]) {
      expect(isExternalUrl(href)).toBe(false)
    }
  })
})

describe("openExternal", () => {
  it("opens the native in-app browser on a native build", async () => {
    forceNative(true)
    const win = vi.spyOn(window, "open").mockReturnValue(null)
    await openExternal("https://x.com")
    expect(Browser.open).toHaveBeenCalledWith({ url: "https://x.com" })
    expect(win).not.toHaveBeenCalled()
  })

  it("opens a new tab on web", async () => {
    forceNative(false)
    const win = vi.spyOn(window, "open").mockReturnValue(null)
    await openExternal("https://x.com")
    expect(win).toHaveBeenCalledWith(
      "https://x.com",
      "_blank",
      "noopener,noreferrer",
    )
    expect(Browser.open).not.toHaveBeenCalled()
  })
})

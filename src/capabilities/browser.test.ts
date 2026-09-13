import { Browser } from "@capacitor/browser"
import { afterEach, describe, expect, it, vi } from "vitest"
import { isExternalUrl, openExternal } from "#adaptv/capabilities/browser"

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

/**
 * Enough of a `Window` for the accessor: an `opener` to sever and an empty
 * document to navigate from. `clicks` records each anchor clicked inside it, since
 * that click, not `window.open`, is what carries the tab to the URL.
 */
function blankTab() {
  const clicks: { href: string; rel: string; inDocument: boolean }[] = []
  const doc = document.implementation.createHTMLDocument("")
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      clicks.push({
        href: this.getAttribute("href") ?? "",
        rel: this.rel,
        inDocument: this.ownerDocument === doc && this.isConnected,
      })
    },
  )
  const tab = { opener: window, document: doc } as unknown as Window
  return { tab, clicks }
}

/** Capture what the accessor hands to the page's own location. */
function captureLocation() {
  const assigned: string[] = []
  vi.spyOn(window.location, "href", "set").mockImplementation((href) => {
    assigned.push(href)
  })
  return assigned
}

const pluginMissing = () =>
  Promise.reject(new Error('"Browser" plugin is not implemented'))

describe("openExternal", () => {
  it("opens the native in-app browser on a native build", async () => {
    forceNative(true)
    const win = vi.spyOn(window, "open").mockReturnValue(null)
    await expect(openExternal("https://x.com/a?b=1")).resolves.toBe(
      "opened",
    )
    expect(Browser.open).toHaveBeenCalledWith({
      url: "https://x.com/a?b=1",
    })
    expect(win).not.toHaveBeenCalled()
  })

  it("opens a blank tab on web, then navigates it from inside with no Referer", async () => {
    forceNative(false)
    const { tab, clicks } = blankTab()
    const win = vi.spyOn(window, "open").mockReturnValue(tab)
    await expect(openExternal("https://x.com/a?b=1")).resolves.toBe(
      "opened",
    )
    expect(win).toHaveBeenCalledWith("about:blank", "_blank")
    expect(clicks).toEqual([
      { href: "https://x.com/a?b=1", rel: "noreferrer", inDocument: true },
    ])
    expect(Browser.open).not.toHaveBeenCalled()
  })

  it("severs the new tab's opener before it navigates", async () => {
    forceNative(false)
    const { tab } = blankTab()
    let openerAtClick: unknown = "not clicked"
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementation(() => {
      openerAtClick = tab.opener
    })
    vi.spyOn(window, "open").mockReturnValue(tab)
    await openExternal("https://x.com")
    expect(openerAtClick).toBeNull()
  })

  it("never asks window.open for noopener or noreferrer — either makes an opened tab return null", async () => {
    forceNative(false)
    const win = vi.spyOn(window, "open").mockReturnValue(blankTab().tab)
    await openExternal("https://x.com")
    for (const call of win.mock.calls) {
      expect(String(call[2] ?? "")).not.toMatch(/noopener|noreferrer/)
    }
  })

  it("resolves a protocol-relative URL against the page", async () => {
    forceNative(false)
    const { tab, clicks } = blankTab()
    vi.spyOn(window, "open").mockReturnValue(tab)
    await openExternal("//cdn.example.com/x")
    expect(clicks[0]?.href).toBe(
      `${window.location.protocol}//cdn.example.com/x`,
    )
  })

  it("gives a protocol-relative URL https when the page is not served over http", async () => {
    forceNative(true)
    vi.stubGlobal("location", { protocol: "capacitor:" })
    await openExternal("//cdn.example.com/x")
    expect(Browser.open).toHaveBeenCalledWith({
      url: "https://cdn.example.com/x",
    })
  })

  it("hands the URL to the system through location when the native plugin rejects", async () => {
    forceNative(true)
    vi.mocked(Browser.open).mockImplementationOnce(pluginMissing)
    const win = vi.spyOn(window, "open").mockReturnValue(null)
    const assigned = captureLocation()
    await expect(openExternal("https://x.com/a?b=1")).resolves.toBe(
      "opened",
    )
    //a tab would hand iOS its own about:blank, and Android has no second window
    expect(win).not.toHaveBeenCalled()
    expect(assigned).toEqual(["https://x.com/a?b=1"])
  })

  it("reports a popup the browser blocked as blocked, not opened", async () => {
    forceNative(false)
    vi.spyOn(window, "open").mockReturnValue(null)
    await expect(openExternal("https://x.com")).resolves.toBe("blocked")
  })

  it("reports a URL that does not parse as invalid, without opening or throwing", async () => {
    for (const native of [false, true]) {
      forceNative(native)
      const win = vi.spyOn(window, "open").mockReturnValue(null)
      const assigned = captureLocation()
      await expect(openExternal("https://")).resolves.toBe("invalid")
      await expect(openExternal("http://[::1")).resolves.toBe("invalid")
      expect(win).not.toHaveBeenCalled()
      expect(assigned).toEqual([])
      expect(Browser.open).not.toHaveBeenCalled()
      vi.restoreAllMocks()
    }
  })

  it("refuses a scheme that would run in or replace the app as invalid", async () => {
    forceNative(false)
    const win = vi.spyOn(window, "open").mockReturnValue(null)
    const assigned = captureLocation()
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<p>x",
      "blob:https://x.com/0f0e",
      "about:blank",
      "file:///etc/hosts",
    ]) {
      await expect(openExternal(url)).resolves.toBe("invalid")
    }
    expect(win).not.toHaveBeenCalled()
    expect(assigned).toEqual([])
  })

  it("hands mailto:, tel: and app schemes to the system through location on web", async () => {
    forceNative(false)
    const win = vi.spyOn(window, "open").mockReturnValue(null)
    const assigned = captureLocation()
    for (const url of [
      "mailto:a@b.com",
      "tel:+15551234",
      "spotify:track:1",
    ]) {
      await expect(openExternal(url)).resolves.toBe("opened")
    }
    expect(assigned).toEqual([
      "mailto:a@b.com",
      "tel:+15551234",
      "spotify:track:1",
    ])
    expect(win).not.toHaveBeenCalled()
  })

  it("hands mailto: to the system on native too — the in-app browser only takes http(s)", async () => {
    forceNative(true)
    const win = vi.spyOn(window, "open").mockReturnValue(null)
    const assigned = captureLocation()
    await expect(openExternal("mailto:a@b.com")).resolves.toBe("opened")
    expect(assigned).toEqual(["mailto:a@b.com"])
    expect(Browser.open).not.toHaveBeenCalled()
    expect(win).not.toHaveBeenCalled()
  })

  it("reports unsupported where there is no window to open a tab in", async () => {
    forceNative(false)
    vi.stubGlobal("window", undefined)
    await expect(openExternal("https://x.com")).resolves.toBe(
      "unsupported",
    )
  })
})

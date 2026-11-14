import { afterEach, describe, expect, it, vi } from "vitest"
import { standaloneMemoryHistory } from "#adaptv/shell/standalone-history"

function stubStandalone(matches: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: /display-mode:\s*standalone/.test(query)
          ? matches
          : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.history.replaceState(null, "", "/")
})

describe("standaloneMemoryHistory", () => {
  it("is undefined in a browser tab, so the router keeps browser history", () => {
    stubStandalone(false)
    expect(standaloneMemoryHistory()).toBeUndefined()
  })

  it("starts an installed PWA at the current path and search", () => {
    stubStandalone(true)
    window.history.replaceState(null, "", "/inbox?tab=unread")
    const history = standaloneMemoryHistory()
    expect(history?.location.pathname).toBe("/inbox")
    expect(history?.location.search).toBe("?tab=unread")
  })

  it("is in memory inside a native shell: navigating does not touch the page URL", () => {
    stubStandalone(false)
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true })
    window.history.replaceState(null, "", "/home")
    const history = standaloneMemoryHistory()
    history?.push("/settings")
    expect(history?.location.pathname).toBe("/settings")
    expect(window.location.pathname).toBe("/home")
  })
})

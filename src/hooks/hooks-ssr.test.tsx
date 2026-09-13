// @vitest-environment node
import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

//The server render of a TanStack Start app runs every hook a route calls. These
//are the ones whose own docs promise something about that pass, rendered with no
//DOM at all — `window` and `document` genuinely absent, not stubbed away.

describe("hooks under SSR", () => {
  it("import and render with no DOM, and fire nothing that belongs to a mount", async () => {
    expect(typeof window).toBe("undefined")
    expect(typeof document).toBe("undefined")

    const [{ useChromeTint }, { useFreezeViewport }, lifecycle, sw] =
      await Promise.all([
        import("#adaptv/hooks/use-chrome-tint"),
        import("#adaptv/hooks/use-freeze-viewport"),
        import("#adaptv/hooks/use-screen-lifecycle"),
        import("#adaptv/hooks/use-service-worker-message"),
      ])

    const onEnter = vi.fn()
    const onLeave = vi.fn()
    const onMessage = vi.fn()
    function Screen() {
      const chrome = useChromeTint()
      useFreezeViewport()
      lifecycle.useScreenLifecycle({ onEnter, onLeave })
      sw.useServiceWorkerMessage(onMessage)
      return createElement(
        "output",
        null,
        `${chrome.supported}:${String(chrome.base)}:${String(chrome.read())}`,
      )
    }

    //no tag exists on the server, so the honest answer is "unsupported"
    expect(renderToString(createElement(Screen))).toBe(
      "<output>false:null:null</output>",
    )
    //a server render is not a mount: entering there would run twice per visit
    expect(onEnter).not.toHaveBeenCalled()
    expect(onLeave).not.toHaveBeenCalled()
    expect(() => sw.sendToServiceWorker({ type: "x" })).not.toThrow()
  })
})

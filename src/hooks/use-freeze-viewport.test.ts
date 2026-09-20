import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useFreezeViewport } from "#adaptv/hooks/use-freeze-viewport"

//`patches.viewportFreeze` (docs/decisions/register.md §1.3): a scroll pin plus the
//virtualKeyboard overlay, both REFCOUNTED so a globally frozen viewport and an
//opening drawer stack instead of the first release unfreezing the other.

const restores: Array<() => void> = []

function stubProp(target: object, key: string, value: unknown): void {
  const prev = Object.getOwnPropertyDescriptor(target, key)
  Object.defineProperty(target, key, { value, configurable: true })
  restores.push(() => {
    if (prev) Object.defineProperty(target, key, prev)
    else delete (target as Record<string, unknown>)[key]
  })
}

/** A Chromium with the VirtualKeyboard API, in a secure context. */
function stubVirtualKeyboard(overlaysContent = false) {
  const vk = { overlaysContent }
  stubProp(window, "isSecureContext", true)
  stubProp(navigator, "virtualKeyboard", vk)
  return vk
}

const html = () => document.documentElement

beforeEach(() => {
  vi.stubGlobal("Capacitor", undefined)
  stubProp(navigator, "userAgent", "Mozilla/5.0 (Linux; Android 15)")
  vi.spyOn(window, "scrollTo").mockImplementation(() => {})
})

afterEach(() => {
  for (const restore of restores.splice(0).reverse()) restore()
  html().style.removeProperty("overflow")
  html().style.removeProperty("padding-right")
  document.body.style.removeProperty("margin-top")
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("useFreezeViewport — refcount", () => {
  it("stays frozen until the LAST user releases, then restores both layers", () => {
    const vk = stubVirtualKeyboard(false)
    const app = renderHook(() => useFreezeViewport())
    const drawer = renderHook(() => useFreezeViewport())

    expect(html().style.overflow).toBe("hidden")
    expect(vk.overlaysContent).toBe(true)

    drawer.unmount()
    expect(html().style.overflow).toBe("hidden")
    expect(vk.overlaysContent).toBe(true)

    app.unmount()
    expect(html().style.overflow).toBe("")
    expect(vk.overlaysContent).toBe(false)
  })

  it("puts back the page's own values, not blanks, when the last user releases", () => {
    //the overlay flag and the inline style both belonged to the app before the
    //freeze — the release restores them rather than assuming a default
    const vk = stubVirtualKeyboard(true)
    html().style.setProperty("overflow", "clip")
    const { unmount } = renderHook(() => useFreezeViewport())
    expect(html().style.overflow).toBe("hidden")

    unmount()
    expect(html().style.overflow).toBe("clip")
    expect(vk.overlaysContent).toBe(true)
  })

  it("does nothing while disabled, and releases when isEnabled flips off", () => {
    const vk = stubVirtualKeyboard(false)
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useFreezeViewport(enabled),
      { initialProps: { enabled: false } },
    )
    expect(html().style.overflow).toBe("")
    expect(vk.overlaysContent).toBe(false)

    rerender({ enabled: true })
    expect(html().style.overflow).toBe("hidden")
    expect(vk.overlaysContent).toBe(true)

    rerender({ enabled: false })
    expect(html().style.overflow).toBe("")
    expect(vk.overlaysContent).toBe(false)
  })
})

describe("useFreezeViewport — the iOS scroll pin", () => {
  it("installs its touch, focus and scroll listeners once and removes every one on release", () => {
    stubProp(
      navigator,
      "userAgent",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)",
    )
    const docAdd = vi.spyOn(document, "addEventListener")
    const docRemove = vi.spyOn(document, "removeEventListener")
    const winAdd = vi.spyOn(window, "addEventListener")
    const winRemove = vi.spyOn(window, "removeEventListener")

    const first = renderHook(() => useFreezeViewport())
    const second = renderHook(() => useFreezeViewport())

    const pinEvents = ["touchstart", "touchmove", "touchend", "focus"]
    const added = docAdd.mock.calls.filter(([type]) =>
      pinEvents.includes(type),
    )
    //refcounted: the second user reinforces the same pin, it does not add another
    expect(added.map(([type]) => type).sort()).toEqual(
      [...pinEvents].sort(),
    )
    expect(
      winAdd.mock.calls.filter(([type]) => String(type) === "scroll"),
    ).toHaveLength(1)

    first.unmount()
    expect(docRemove).not.toHaveBeenCalled()

    second.unmount()
    for (const [type, listener] of added) {
      expect(docRemove).toHaveBeenCalledWith(type, listener, true)
    }
    const [, onScroll] =
      winAdd.mock.calls.find(([type]) => String(type) === "scroll") ?? []
    expect(winRemove).toHaveBeenCalledWith("scroll", onScroll)
    expect(html().style.overflow).toBe("")
  })
})

describe("useFreezeViewport — the standard lock", () => {
  it("pads the page by the scrollbar it hides, so nothing shifts sideways", () => {
    stubProp(window, "innerWidth", 1024)
    stubProp(html(), "clientWidth", 1009)
    const { unmount } = renderHook(() => useFreezeViewport())
    expect(html().style.paddingRight).toBe("15px")

    unmount()
    expect(html().style.paddingRight).toBe("")
  })

  it("leaves virtualKeyboard alone outside a secure context, and still pins the page", () => {
    //the API is gated on a secure context: a LAN `http://ip:port` dev build has the
    //object but no right to use it, and the scroll pin must stand alone there
    const vk = { overlaysContent: false }
    stubProp(window, "isSecureContext", false)
    stubProp(navigator, "virtualKeyboard", vk)
    const { unmount } = renderHook(() => useFreezeViewport())
    expect(vk.overlaysContent).toBe(false)
    expect(html().style.overflow).toBe("hidden")
    unmount()
  })

  it("does not cancel touches — the touch pin is iOS-only", () => {
    const content = document.body.appendChild(document.createElement("p"))
    const { unmount } = renderHook(() => useFreezeViewport())
    touch("touchstart", content, 200, 300)
    expect(touch("touchmove", content, 200, 250).defaultPrevented).toBe(
      false,
    )
    unmount()
    content.remove()
  })
})

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)"

function touch(
  type: "touchstart" | "touchmove" | "touchend",
  target: EventTarget,
  clientX: number,
  clientY: number,
): TouchEvent {
  const event = new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    changedTouches: [{ clientX, clientY } as Touch],
  })
  target.dispatchEvent(event)
  return event
}

/** A drag from (x, y) that travels `dy` — returns the move so a test can read whether it was cancelled. */
function drag(target: EventTarget, x: number, y: number, dy = -50) {
  touch("touchstart", target, x, y)
  const move = touch("touchmove", target, x, y + dy)
  touch("touchend", target, x, y + dy)
  return move
}

/** An `overflow-y: auto` box whose content is `contentHeight` tall inside a 300px viewport. */
function scroller(contentHeight: number) {
  const box = document.createElement("div")
  box.style.overflowY = "auto"
  Object.defineProperty(box, "clientHeight", { value: 300 })
  Object.defineProperty(box, "scrollHeight", { value: contentHeight })
  const row = box.appendChild(document.createElement("div"))
  document.body.appendChild(box)
  return { box, row }
}

describe("useFreezeViewport — what the iOS pin does to a touch", () => {
  const frames: FrameRequestCallback[] = []
  const flushFrame = () => {
    for (const frame of frames.splice(0)) frame(0)
  }

  beforeEach(() => {
    stubProp(navigator, "userAgent", IPHONE_UA)
    stubProp(window, "innerWidth", 390)
    stubProp(window, "visualViewport", { height: 664.4 })
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb)
      return frames.length
    })
  })

  afterEach(() => {
    frames.length = 0
    document.body.replaceChildren()
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  })

  it("pins the page at the top while frozen, and puts it back where the user left it", () => {
    stubProp(window, "pageXOffset", 0)
    stubProp(window, "pageYOffset", 480)
    const { unmount } = renderHook(() => useFreezeViewport())
    //the body is shifted up by the offset it had, so the content does not jump
    expect(document.body.style.marginTop).toBe("-480px")
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0)

    unmount()
    expect(window.scrollTo).toHaveBeenLastCalledWith(0, 480)
    expect(document.body.style.marginTop).toBe("")
  })

  it("snaps any window scroll back to the top while frozen, and stops once released", () => {
    const { unmount } = renderHook(() => useFreezeViewport())
    vi.mocked(window.scrollTo).mockClear()
    window.dispatchEvent(new Event("scroll"))
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0)

    unmount()
    vi.mocked(window.scrollTo).mockClear()
    window.dispatchEvent(new Event("scroll"))
    expect(window.scrollTo).not.toHaveBeenCalled()
  })

  it("cancels a drag over content that cannot scroll, so the page never shifts", () => {
    const content = document.body.appendChild(document.createElement("p"))
    const icon = content.appendChild(
      document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    )
    const { unmount } = renderHook(() => useFreezeViewport())
    expect(drag(content, 200, 300).defaultPrevented).toBe(true)
    //an SVG icon is never a scroller of its own, so a drag from it is pinned too
    expect(drag(icon, 200, 300).defaultPrevented).toBe(true)
    unmount()
  })

  it("leaves a drag inside a real inner scroller to scroll natively", () => {
    const { row } = scroller(900)
    //an icon in a row is SVG, not an HTMLElement: the walk has to climb through it
    const icon = row.appendChild(
      document.createElementNS("http://www.w3.org/2000/svg", "svg"),
    )
    const { unmount } = renderHook(() => useFreezeViewport())
    expect(drag(row, 200, 300).defaultPrevented).toBe(false)
    expect(drag(icon, 200, 300).defaultPrevented).toBe(false)
    unmount()
  })

  it("treats an overflow box whose content fits as content that cannot scroll", () => {
    //nothing to scroll means the gesture would chain to the page — pin it
    const { row } = scroller(300)
    const { unmount } = renderHook(() => useFreezeViewport())
    expect(drag(row, 200, 300).defaultPrevented).toBe(true)
    unmount()
  })

  it("never cancels a horizontal OS edge-swipe born within 24px of either edge", () => {
    const content = document.body.appendChild(document.createElement("p"))
    const { unmount } = renderHook(() => useFreezeViewport())
    for (const x of [0, 24, 366, 390]) {
      expect(drag(content, x, 300).defaultPrevented, `x=${x}`).toBe(false)
    }
    for (const x of [25, 365]) {
      expect(drag(content, x, 300).defaultPrevented, `x=${x}`).toBe(true)
    }
    unmount()
  })

  it("stops cancelling touches once the last user releases", () => {
    const content = document.body.appendChild(document.createElement("p"))
    const { unmount } = renderHook(() => useFreezeViewport())
    unmount()
    expect(drag(content, 200, 300).defaultPrevented).toBe(false)
  })

  it("focuses a tapped text field off-screen for one frame, then puts it back", () => {
    const field = document.body.appendChild(
      document.createElement("input"),
    )
    const { unmount } = renderHook(() => useFreezeViewport())
    touch("touchstart", field, 100, 100)
    const end = touch("touchend", field, 100, 100)

    //the tap is taken over: WebKit raises the keyboard for a focus it can see as
    //user-initiated, and the field sits a viewport + 200px above the screen for it
    expect(end.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(field)
    expect(field.style.transform).toBe("translateY(-865px)")

    flushFrame()
    expect(field.style.transform).toBe("")
    unmount()
  })

  it("does not focus a field a SCROLL happens to lift off over — 10px of travel is still a tap", () => {
    const field = document.body.appendChild(
      document.createElement("input"),
    )
    const { unmount } = renderHook(() => useFreezeViewport())

    touch("touchstart", field, 100, 100)
    touch("touchmove", field, 100, 111)
    const scroll = touch("touchend", field, 100, 111)
    expect(scroll.defaultPrevented).toBe(false)
    expect(document.activeElement).not.toBe(field)

    touch("touchstart", field, 100, 100)
    touch("touchmove", field, 110, 90)
    const tap = touch("touchend", field, 110, 90)
    expect(tap.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(field)
    unmount()
  })

  it("leaves a tap alone on a field that already has focus, or on a control that raises no keyboard", () => {
    const field = document.body.appendChild(
      document.createElement("input"),
    )
    const checkbox = document.body.appendChild(
      document.createElement("input"),
    )
    checkbox.type = "checkbox"
    const button = document.body.appendChild(
      document.createElement("button"),
    )
    field.focus()
    const { unmount } = renderHook(() => useFreezeViewport())

    for (const target of [field, checkbox, button]) {
      touch("touchstart", target, 100, 100)
      const end = touch("touchend", target, 100, 100)
      expect(end.defaultPrevented, target.outerHTML).toBe(false)
      expect(target.style.transform, target.outerHTML).toBe("")
    }
    unmount()
  })

  it("nudges a text field focused any other way, sized off the layout height without a visualViewport", () => {
    stubProp(window, "visualViewport", undefined)
    stubProp(window, "innerHeight", 800)
    const field = document.body.appendChild(
      document.createElement("textarea"),
    )
    const button = document.body.appendChild(
      document.createElement("button"),
    )
    const { unmount } = renderHook(() => useFreezeViewport())

    button.focus()
    expect(button.style.transform).toBe("")

    field.focus()
    expect(field.style.transform).toBe("translateY(-1000px)")
    flushFrame()
    expect(field.style.transform).toBe("")
    unmount()
  })
})

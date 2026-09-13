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

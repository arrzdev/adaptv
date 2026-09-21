import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyUiThemePreference, useTheme } from "#adaptv/hooks/use-theme"
import {
  PREFERENCE_ATTR,
  UI_THEME_STORAGE_KEY,
} from "#adaptv/shell/theme-init-script"

/**
 * One `(prefers-color-scheme: dark)` list shared by every `matchMedia` call, as a
 * browser hands back: flipping `matches` is the OS changing appearance, and
 * `emit()` is the `change` event that follows it. They are separate on purpose —
 * a page in the background can come back with the value changed and no event
 * ever delivered, which is the case the resume listeners exist for.
 */
function osScheme() {
  const listeners = new Set<() => void>()
  const list = {
    matches: false,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) =>
      listeners.delete(fn),
  }
  vi.spyOn(window, "matchMedia").mockImplementation(
    () => list as unknown as MediaQueryList,
  )
  return {
    listeners,
    set(dark: boolean) {
      list.matches = dark
    },
    emit() {
      for (const fn of [...listeners]) fn()
    },
  }
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  })
}

const root = document.documentElement
const htmlClass = () => [...root.classList].join(" ")

/** Render `useTheme` and keep every value it returned, first render included. */
function mountTheme() {
  const seen: Array<"light" | "dark"> = []
  const hook = renderHook(() => {
    const value = useTheme()
    seen.push(value[0])
    return value
  })
  return { ...hook, seen }
}

//the MutationObserver delivers on a microtask; leave the turn so it has run
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)))

let os: ReturnType<typeof osScheme>

beforeEach(() => {
  os = osScheme()
  setVisibility("visible")
})

afterEach(() => {
  localStorage.clear()
  root.className = ""
  root.removeAttribute(PREFERENCE_ATTR)
  root.style.colorScheme = ""
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("useTheme before layout", () => {
  it("renders the appearance the pre-paint script stamped, not a guess", () => {
    //The first render is the one hydration compares against the server HTML, and
    //it happens before any effect has read storage. In system mode the only
    //honest answer is the class the blocking <head> script already put on
    //<html>; guessing "light" would flash a dark-mode user's status bar.
    root.classList.add("dark")
    const { seen } = mountTheme()
    expect(seen[0]).toBe("dark")
  })

  it("falls back to light when nothing has been stamped", () => {
    os.set(true)
    const { seen } = mountTheme()
    expect(seen[0]).toBe("light")
  })
})

describe("useTheme and the OS appearance", () => {
  it("follows an OS change in system mode, on <html> and in the hook", () => {
    const { result } = mountTheme()
    expect(result.current[0]).toBe("light")
    expect(htmlClass()).toBe("light")

    act(() => {
      os.set(true)
      os.emit()
    })
    expect(htmlClass()).toBe("dark")
    expect(root.style.colorScheme).toBe("dark")
    expect(result.current[0]).toBe("dark")
  })

  it("ignores an OS change while an explicit preference is stored", () => {
    localStorage.setItem(UI_THEME_STORAGE_KEY, "light")
    const { result } = mountTheme()
    expect(htmlClass()).toBe("light")

    act(() => {
      os.set(true)
      os.emit()
    })
    expect(htmlClass()).toBe("light")
    expect(result.current[0]).toBe("light")
  })

  it("follows the OS again after an explicit preference is switched back to system", async () => {
    //The OS listener only runs in system mode, so an OS change made while the
    //app was explicitly dark goes unseen. Switching back must re-read the OS, or
    //the next change event compares against that stale value and bails out.
    const { result } = mountTheme()
    act(() => applyUiThemePreference("dark"))
    await flush()
    act(() => {
      os.set(true)
      os.emit()
    })
    act(() => applyUiThemePreference("system"))
    await flush()
    expect(result.current[0]).toBe("dark")

    act(() => {
      os.set(false)
      os.emit()
    })
    await flush()
    expect(htmlClass()).toBe("light")
    expect(result.current[0]).toBe("light")
  })
})

describe("useTheme on resume", () => {
  it("restamps system mode when the OS changed while the page was away", async () => {
    mountTheme()
    os.set(true) //no change event: the page was not running to receive one

    act(() => {
      window.dispatchEvent(new Event("pageshow"))
    })
    await flush()
    expect(htmlClass()).toBe("dark")
  })

  it("returns the appearance it restamped, so the next toggle flips the screen", async () => {
    //The restamp alone left the hook on "light" over a dark page: the preference
    //it re-reads is still "system", so React bailed out of the render. The shell
    //hands this value to the native status bar, and the toggle derives its next
    //preference from it, so one tap chose "dark" for a page already dark.
    const { result } = mountTheme()
    os.set(true)

    act(() => {
      window.dispatchEvent(new Event("pageshow"))
    })
    await flush()
    expect(result.current[0]).toBe("dark")

    act(() => result.current[1]())
    await flush()
    expect(htmlClass()).toBe("light")
    expect(result.current[0]).toBe("light")
  })

  it("does not re-render when nothing changed while the page was away", async () => {
    //Every tab switch is a resume, and the shell layout calls this hook, so a
    //render here is a render of the shell. React may render once more to confirm
    //a bail-out, so the bound is one render however many resume events arrive.
    //It assumes no StrictMode, which would render every component twice.
    const { seen } = mountTheme()
    await flush()
    const before = seen.length

    act(() => {
      window.dispatchEvent(new Event("pageshow"))
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await flush()
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await flush()
    expect(seen.length - before).toBeLessThanOrEqual(1)
  })

  it("restamps on visibilitychange too, but only once visible", async () => {
    mountTheme()
    os.set(true)

    setVisibility("hidden")
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await flush()
    expect(htmlClass()).toBe("light")

    setVisibility("visible")
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    await flush()
    expect(htmlClass()).toBe("dark")
  })

  it("leaves an explicit preference alone on resume", async () => {
    localStorage.setItem(UI_THEME_STORAGE_KEY, "light")
    mountTheme()
    os.set(true)

    act(() => {
      window.dispatchEvent(new Event("pageshow"))
    })
    await flush()
    expect(htmlClass()).toBe("light")
  })

  it("picks up a preference another tab stored while the page was away", async () => {
    const { result } = mountTheme()
    expect(result.current[0]).toBe("light")
    localStorage.setItem(UI_THEME_STORAGE_KEY, "dark")

    act(() => {
      window.dispatchEvent(new Event("pageshow"))
    })
    await flush()
    expect(result.current[0]).toBe("dark")
  })
})

describe("useTheme and <html>", () => {
  it("follows a preference another instance wrote to <html>", async () => {
    //the shell mounts one useTheme; a settings screen mounting a second and
    //toggling must move the shell's too, or the status bar keeps the old theme
    const shell = mountTheme()
    const settings = mountTheme()
    expect(shell.result.current[0]).toBe("light")

    act(() => settings.result.current[1]())
    await flush()
    expect(settings.result.current[0]).toBe("dark")
    expect(shell.result.current[0]).toBe("dark")
  })
  it("follows a toggle through <html> alone when storage throws", async () => {
    //Storage can refuse every read and write (a locked-down WebView, a private
    //window with no quota). The preference attribute is then the only place the
    //shell's instance can learn what the settings screen chose.
    const denied = () => {
      throw new DOMException("storage is disabled", "SecurityError")
    }
    vi.spyOn(localStorage, "getItem").mockImplementation(denied)
    vi.spyOn(localStorage, "setItem").mockImplementation(denied)
    const shell = mountTheme()
    const settings = mountTheme()

    act(() => settings.result.current[1]())
    await flush()
    expect(root.getAttribute(PREFERENCE_ATTR)).toBe("dark")
    expect(shell.result.current[0]).toBe("dark")
  })
})

describe("useTheme toggle", () => {
  it("is still the preference on the next load, once <html> has lost it", () => {
    //A reload starts from a bare <html>: the class and preference attribute a
    //toggle stamped are gone, and only storage carries the choice across.
    const first = mountTheme()
    act(() => first.result.current[1]())
    first.unmount()
    root.className = ""
    root.removeAttribute(PREFERENCE_ATTR)

    const { result } = mountTheme()
    expect(result.current[0]).toBe("dark")
    expect(htmlClass()).toBe("dark")
  })
})

describe("useTheme unmount", () => {
  it("stops listening to the OS, the page and <html>", () => {
    //the observer's own callback has nothing to show once the hook is gone, so
    //this counts observers still attached, as the OS list counts its listeners
    const observing = new Set<MutationObserver>()
    vi.stubGlobal(
      "MutationObserver",
      class extends MutationObserver {
        observe(target: Node, options?: MutationObserverInit) {
          observing.add(this)
          super.observe(target, options)
        }
        disconnect() {
          observing.delete(this)
          super.disconnect()
        }
      },
    )
    const { unmount } = mountTheme()
    expect(observing.size).toBe(1)
    unmount()
    expect(os.listeners.size).toBe(0)
    expect(observing.size).toBe(0)

    os.set(true)
    window.dispatchEvent(new Event("pageshow"))
    document.dispatchEvent(new Event("visibilitychange"))
    expect(htmlClass()).toBe("light")
  })
})

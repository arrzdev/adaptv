import { act, renderHook } from "@testing-library/react"
import { createElement, useLayoutEffect, useRef } from "react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { UseThemeResult } from "#adaptv/hooks/use-theme"
import {
  applyUiThemePreference,
  syncUiThemeAppearance,
  useTheme,
} from "#adaptv/hooks/use-theme"
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
  const seen: UseThemeResult[] = []
  const hook = renderHook(() => {
    const value = useTheme()
    seen.push(value)
    return value
  })
  return { ...hook, seen }
}

/** What a two-state switch does with the hook: flip what is painted. */
function flip(theme: UseThemeResult) {
  theme.setPreference(theme.resolved === "dark" ? "light" : "dark")
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
    //A client render that is not a hydration (a SPA or native boot, a screen
    //mounted later) reads the store on its first render, before any effect
    //has run. In system mode the honest answer is the class the blocking <head>
    //script already put on <html>; guessing "light" would hand a dark-mode
    //user's status bar the wrong colour. A hydration answers with the server's
    //values instead — see "useTheme hydration".
    root.classList.add("dark")
    const { seen } = mountTheme()
    expect(seen[0]?.resolved).toBe("dark")
  })

  it("falls back to light when nothing has been stamped", () => {
    os.set(true)
    const { seen } = mountTheme()
    expect(seen[0]?.resolved).toBe("light")
  })
})

describe("useTheme and the OS appearance", () => {
  it("follows an OS change in system mode, on <html> and in the hook", () => {
    const { result } = mountTheme()
    expect(result.current.resolved).toBe("light")
    expect(htmlClass()).toBe("light")

    act(() => {
      os.set(true)
      os.emit()
    })
    expect(htmlClass()).toBe("dark")
    expect(root.style.colorScheme).toBe("dark")
    expect(result.current.resolved).toBe("dark")
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
    expect(result.current.resolved).toBe("light")
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
    expect(result.current.resolved).toBe("dark")

    act(() => {
      os.set(false)
      os.emit()
    })
    await flush()
    expect(htmlClass()).toBe("light")
    expect(result.current.resolved).toBe("light")
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
    expect(result.current.resolved).toBe("dark")

    act(() => flip(result.current))
    await flush()
    expect(htmlClass()).toBe("light")
    expect(result.current.resolved).toBe("light")
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
    expect(result.current.resolved).toBe("light")
    localStorage.setItem(UI_THEME_STORAGE_KEY, "dark")

    act(() => {
      window.dispatchEvent(new Event("pageshow"))
    })
    await flush()
    expect(result.current.resolved).toBe("dark")
  })
})

describe("useTheme and <html>", () => {
  it("follows a preference another instance wrote to <html>", async () => {
    //the shell mounts one useTheme; a settings screen mounting a second and
    //toggling must move the shell's too, or the status bar keeps the old theme
    const shell = mountTheme()
    const settings = mountTheme()
    expect(shell.result.current.resolved).toBe("light")

    act(() => flip(settings.result.current))
    await flush()
    expect(settings.result.current.resolved).toBe("dark")
    expect(shell.result.current.resolved).toBe("dark")
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

    act(() => flip(settings.result.current))
    await flush()
    expect(root.getAttribute(PREFERENCE_ATTR)).toBe("dark")
    expect(shell.result.current.resolved).toBe("dark")
  })
})

describe("useTheme toggle", () => {
  it("is still the preference on the next load, once <html> has lost it", () => {
    //A reload starts from a bare <html>: the class and preference attribute a
    //toggle stamped are gone, and only storage carries the choice across.
    const first = mountTheme()
    act(() => flip(first.result.current))
    first.unmount()
    root.className = ""
    root.removeAttribute(PREFERENCE_ATTR)

    const { result } = mountTheme()
    expect(result.current.resolved).toBe("dark")
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

describe("useTheme preference", () => {
  it.each([
    ["system", "system", "light"],
    ["dark", "dark", "dark"],
    [null, "system", "light"],
  ] as const)(
    "starting from stored %s, returns the preference %s on the first render",
    (stored, preference, resolved) => {
      //a Light / Dark / System control has to show which one is selected, and
      //"system" is not recoverable from the painted appearance
      if (stored) localStorage.setItem(UI_THEME_STORAGE_KEY, stored)
      const { seen, result } = mountTheme()
      expect(seen[0]?.preference).toBe(preference)
      expect(seen[0]?.resolved).toBe(resolved)
      expect(result.current.preference).toBe(preference)
    },
  )

  it("setPreference('system') follows the OS again, live", () => {
    localStorage.setItem(UI_THEME_STORAGE_KEY, "dark")
    const { result } = mountTheme()
    expect(result.current.resolved).toBe("dark")

    act(() => result.current.setPreference("system"))
    expect(result.current.preference).toBe("system")
    expect(result.current.resolved).toBe("light")
    expect(localStorage.getItem(UI_THEME_STORAGE_KEY)).toBe("system")

    act(() => {
      os.set(true)
      os.emit()
    })
    expect(htmlClass()).toBe("dark")
    expect(result.current.resolved).toBe("dark")
  })

  it("setPreference('dark') stops following the OS", () => {
    const { result } = mountTheme()
    act(() => result.current.setPreference("dark"))
    expect(result.current.preference).toBe("dark")
    expect(localStorage.getItem(UI_THEME_STORAGE_KEY)).toBe("dark")

    for (const dark of [true, false]) {
      act(() => {
        os.set(dark)
        os.emit()
      })
      expect(htmlClass()).toBe("dark")
      expect(root.style.colorScheme).toBe("dark")
      expect(result.current.resolved).toBe("dark")
    }
  })

  it("moves every mounted instance, without waiting for <html> to be observed", () => {
    //the shell's instance drives the status bar; a settings screen's instance
    //is the one the user taps. The observer would catch up a microtask later,
    //which is a frame of the control and the bars disagreeing.
    const shell = mountTheme()
    const settings = mountTheme()

    act(() => settings.result.current.setPreference("dark"))
    expect(shell.result.current.preference).toBe("dark")
    expect(shell.result.current.resolved).toBe("dark")

    act(() => settings.result.current.setPreference("system"))
    expect(shell.result.current.preference).toBe("system")
    expect(shell.result.current.resolved).toBe("light")
  })

  it("reports the preference <html> shows, not one another tab only stored", () => {
    //Storage is shared with every tab of the app and can change under this
    //page at any time. Until this page restamps (a resume, or a useTheme that
    //mounts), <html> is still painted with the old choice, and a hook that
    //read storage first would hand the status bar "dark" over a light page.
    localStorage.setItem(UI_THEME_STORAGE_KEY, "light")
    const { result, rerender } = mountTheme()
    localStorage.setItem(UI_THEME_STORAGE_KEY, "dark")

    rerender()
    expect(htmlClass()).toBe("light")
    expect(result.current.preference).toBe("light")
    expect(result.current.resolved).toBe("light")
  })

  it("is still the chosen preference on the next load", () => {
    const first = mountTheme()
    act(() => first.result.current.setPreference("system"))
    act(() => first.result.current.setPreference("dark"))
    first.unmount()
    root.className = ""
    root.removeAttribute(PREFERENCE_ATTR)

    const { seen } = mountTheme()
    expect(seen[0]?.preference).toBe("dark")
  })
})

describe("useTheme and a stamp written outside it", () => {
  it("follows <html> when something other than setPreference restamps it", async () => {
    //`syncUiThemeAppearance` is public, and React reconciling the document can
    //rewrite <html> too; neither goes through the store, so only the observer
    //can tell the mounted hooks
    const { result } = mountTheme()
    act(() => syncUiThemeAppearance("dark"))
    await flush()
    expect(result.current.preference).toBe("dark")
    expect(result.current.resolved).toBe("dark")
  })
})

/**
 * Server-render a theme probe, then stamp <html> and storage with "dark" the
 * way the pre-paint script does before the client bundle runs.
 */
function serverHtmlWithDarkStored() {
  const html = renderToString(createElement(ThemeText))
  localStorage.setItem(UI_THEME_STORAGE_KEY, "dark")
  root.classList.add("dark")
  root.setAttribute(PREFERENCE_ATTR, "dark")
  const container = document.createElement("div")
  container.innerHTML = html
  document.body.appendChild(container)
  return { html, container }
}

function ThemeText({ onLayout }: { onLayout?: (text: string) => void }) {
  const theme = useTheme()
  const ref = useRef<HTMLOutputElement>(null)
  useLayoutEffect(() => {
    onLayout?.(ref.current?.textContent ?? "")
  }, [onLayout])
  return createElement(
    "output",
    { ref },
    `${theme.preference}:${theme.resolved}`,
  )
}

describe("useTheme hydration", () => {
  it("is on the stamp before the hydration's passive effects run", async () => {
    //React commits a hydration and runs its passive effects in a later task,
    //after the browser has had the chance to paint. useSyncExternalStore on its
    //own notices the stamp only there, so the server's "system" would be on
    //screen for a frame. The layout effect's re-render lands inside the commit's
    //own task: a microtask queued from the first layout effect runs before that
    //later task, and must already read the stored value.
    //Outside act on purpose — act would flush the passive effects synchronously.
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    const wasActEnvironment = env.IS_REACT_ACT_ENVIRONMENT
    env.IS_REACT_ACT_ENVIRONMENT = false
    const { container } = serverHtmlWithDarkStored()
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const afterCommit: string[] = []
    const onLayout = () =>
      queueMicrotask(() => afterCommit.push(container.textContent ?? ""))
    try {
      const app = hydrateRoot(
        container,
        createElement(ThemeText, { onLayout }),
      )
      await vi.waitFor(() => expect(afterCommit.length).toBeGreaterThan(0))
      expect(afterCommit[0]).toBe("dark:dark")
      expect(errors).not.toHaveBeenCalled()
      app.unmount()
    } finally {
      env.IS_REACT_ACT_ENVIRONMENT = wasActEnvironment
      container.remove()
    }
  })

  it("hydrates on the server's answer, then shows the stored preference", async () => {
    //The server has no storage: it renders "system". The pre-paint script has
    //already stamped the stored "dark" on <html> by the time the client
    //hydrates, so a first render that read it would not match the server HTML.
    function Probe({
      onRender,
    }: {
      onRender: (t: UseThemeResult) => void
    }) {
      const theme = useTheme()
      onRender(theme)
      return createElement(
        "output",
        null,
        `${theme.preference}:${theme.resolved}`,
      )
    }
    const noop = () => {}
    const html = renderToString(createElement(Probe, { onRender: noop }))
    expect(html).toBe("<output>system:light</output>")

    localStorage.setItem(UI_THEME_STORAGE_KEY, "dark")
    root.classList.add("dark")
    root.setAttribute(PREFERENCE_ATTR, "dark")
    const container = document.createElement("div")
    container.innerHTML = html
    document.body.appendChild(container)

    const errors = vi.spyOn(console, "error").mockImplementation(noop)
    const recoverable = vi.fn()
    const seen: UseThemeResult[] = []
    let app: ReturnType<typeof hydrateRoot> | undefined
    await act(async () => {
      app = hydrateRoot(
        container,
        createElement(Probe, { onRender: (t) => seen.push(t) }),
        { onRecoverableError: recoverable },
      )
    })
    expect(recoverable).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
    expect(seen[0]?.preference).toBe("system")
    expect(seen[0]?.resolved).toBe("light")
    expect(container.textContent).toBe("dark:dark")

    act(() => app?.unmount())
    container.remove()
  })
})

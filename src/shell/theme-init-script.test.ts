import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getUiThemeInitScript,
  PREFERENCE_ATTR,
} from "#adaptv/shell/theme-init-script"

//Runs the generated pre-paint script in the happy-dom document and returns the
//`color-scheme` meta it produced. The script is a string (it must run before React,
//at first paint), so evaluating it is the only way to prove what it stamps.
function runInitScript(preference?: string): HTMLMetaElement | null {
  document.head.innerHTML = ""
  document.documentElement.className = ""
  document.documentElement.removeAttribute(PREFERENCE_ATTR)
  try {
    localStorage.removeItem("ui-theme-preference")
  } catch {}
  if (preference) {
    document.documentElement.setAttribute(PREFERENCE_ATTR, preference)
  }
  const script = getUiThemeInitScript({
    themeColorLight: "#eeeeec",
    themeColorDark: "#0a0a0c",
    defaultThemePreference: "system",
  })
  new Function(script)()
  return document.querySelector('meta[name="color-scheme"]')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("getUiThemeInitScript — color-scheme is pinned to the resolved theme", () => {
  //Why this matters: a static `color-scheme: light dark` lets the DEVICE theme drive
  //Chrome's WebAPK system-bar canvas, so an Android standalone PWA forced to dark still
  //shows light (white) / system-dark (Chrome's dark canvas) gutters. Pinning the meta
  //to the app's resolved theme is the lever under test.
  it("pins to a single value when the app forces dark", () => {
    expect(runInitScript("dark")?.content).toBe("dark")
  })

  it("pins to a single value when the app forces light", () => {
    expect(runInitScript("light")?.content).toBe("light")
  })

  it("uses `light dark` only in system-follow mode", () => {
    //system mode reads matchMedia; the value it resolves to is irrelevant here — what
    //matters is that the meta stays `light dark` so the OS may drive it.
    vi.stubGlobal("matchMedia", () => ({ matches: false }))
    expect(runInitScript("system")?.content).toBe("light dark")
  })
})

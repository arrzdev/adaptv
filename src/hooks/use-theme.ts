import { useCallback, useReducer, useState } from "react"
import { persistNativeThemePreference } from "#adaptv/capabilities/native-theme"
import { useIsomorphicLayoutEffect } from "#adaptv/hooks/use-isomorphic-layout-effect"
import {
  PREFERENCE_ATTR,
  UI_THEME_STORAGE_KEY,
} from "#adaptv/shell/theme-init-script"
import tryCatch from "#adaptv/utils/try-catch"

//the pre-paint script lives in a React-free module so the Vite plugin can use it
//at build time; re-exported here so runtime call sites are unchanged
export { getUiThemeInitScript } from "#adaptv/shell/theme-init-script"

export type UiThemePreference = "light" | "dark" | "system"

function readStoredPreference(): UiThemePreference | null {
  if (typeof window === "undefined") return null
  const [stored] = tryCatch(() =>
    localStorage.getItem(UI_THEME_STORAGE_KEY),
  )
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored
  }
  return null
}

function readPreferenceFromDom(): UiThemePreference | null {
  if (typeof document === "undefined") return null
  const attr = document.documentElement.getAttribute(PREFERENCE_ATTR)
  if (attr === "light" || attr === "dark" || attr === "system") {
    return attr
  }
  return null
}

export function readPreference(): UiThemePreference {
  return readStoredPreference() ?? readPreferenceFromDom() ?? "system"
}

function persistPreference(preference: UiThemePreference) {
  if (typeof window === "undefined") return
  tryCatch(() => localStorage.setItem(UI_THEME_STORAGE_KEY, preference))
}

export function getResolvedUiAppearance(
  preference: UiThemePreference,
): "light" | "dark" {
  if (preference === "light") return "light"
  if (preference === "dark") return "dark"
  if (typeof window === "undefined") return "light"
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

function readResolvedFromDom(): "light" | "dark" | null {
  if (typeof document === "undefined") return null
  const root = document.documentElement
  if (root.classList.contains("dark")) return "dark"
  if (root.classList.contains("light")) return "light"
  return null
}

/** Sync resolved appearance on `<html>` — does not write localStorage. */
export function syncUiThemeAppearance(preference: UiThemePreference) {
  const root = document.documentElement
  const resolved = getResolvedUiAppearance(preference)

  root.classList.remove("light", "dark")
  root.classList.add(resolved)
  root.style.colorScheme = resolved
  root.setAttribute(PREFERENCE_ATTR, preference)
}

/** Apply preference, persist it, and sync `<html class="light|dark">`. */
export function applyUiThemePreference(preference: UiThemePreference) {
  syncUiThemeAppearance(preference)
  persistPreference(preference)
  //mirror to native storage so the OS splash colour follows the app theme (native only)
  void persistNativeThemePreference(preference)
}

/**
 * Re-apply the stored preference to `<html>` on the client, without writing it
 * back. Called from `useTheme`'s layout effect so React's reconciliation of
 * `<html>` cannot drop what the pre-paint script already painted.
 *
 * The pre-paint pass itself is {@link getUiThemeInitScript} — the blocking inline
 * `<head>` script that is the single source of truth before hydration: it resolves
 * the preference, paints the class / `color-scheme` / background, and seeds the one
 * `theme-color` meta that `useSyncTheme` keeps in sync afterwards.
 */
export function initUiTheme(
  preference: UiThemePreference = readPreference(),
) {
  syncUiThemeAppearance(preference)
}

function reapplySystemThemeIfNeeded() {
  if (readPreference() !== "system") return
  syncUiThemeAppearance("system")
}

function useResolvedUiAppearance(
  preference: UiThemePreference,
): "light" | "dark" {
  const [, bumpOs] = useReducer((n: number) => n + 1, 0)
  const [layoutDone, setLayoutDone] = useState(false)

  useIsomorphicLayoutEffect(() => {
    setLayoutDone(true)
  }, [])

  useIsomorphicLayoutEffect(() => {
    if (preference !== "system") return
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const onOs = () => bumpOs()
    mq.addEventListener("change", onOs)
    return () => mq.removeEventListener("change", onOs)
  }, [preference])

  if (!layoutDone) {
    if (preference === "light") return "light"
    if (preference === "dark") return "dark"
    return readResolvedFromDom() ?? "light"
  }

  return getResolvedUiAppearance(preference)
}

/**
 * Mount light/dark preference on `<html>` and expose resolved theme + toggle.
 * Call once near the app root (e.g. with `useSyncTheme`).
 */
export function useTheme(): readonly ["light" | "dark", () => void] {
  const [preference, setPreferenceState] =
    useState<UiThemePreference>("system")
  const resolved = useResolvedUiAppearance(preference)

  const setPreference = useCallback((next: UiThemePreference) => {
    applyUiThemePreference(next)
    setPreferenceState(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setPreference(resolved === "dark" ? "light" : "dark")
  }, [resolved, setPreference])

  useIsomorphicLayoutEffect(() => {
    const preference = readPreference()
    initUiTheme(preference)
    setPreferenceState(preference)

    const root = document.documentElement
    const onClass = () => {
      setPreferenceState(readPreference())
    }
    const mo = new MutationObserver(onClass)
    mo.observe(root, {
      attributes: true,
      attributeFilter: ["class", PREFERENCE_ATTR],
    })

    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const onOsAppearanceChange = () => {
      if (readPreference() !== "system") return
      syncUiThemeAppearance("system")
      setPreferenceState("system")
    }
    mq.addEventListener("change", onOsAppearanceChange)

    const onResume = () => {
      if (document.visibilityState !== "visible") return
      reapplySystemThemeIfNeeded()
      setPreferenceState(readPreference())
    }
    document.addEventListener("visibilitychange", onResume)
    window.addEventListener("pageshow", onResume)

    return () => {
      mo.disconnect()
      mq.removeEventListener("change", onOsAppearanceChange)
      document.removeEventListener("visibilitychange", onResume)
      window.removeEventListener("pageshow", onResume)
    }
  }, [])

  return [resolved, toggleTheme] as const
}

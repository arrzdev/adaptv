import { useState, useSyncExternalStore } from "react"
import type { UiThemePreference } from "#adaptv/capabilities/native-theme"
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

export type { UiThemePreference }

type UiAppearance = "light" | "dark"

const DARK_QUERY = "(prefers-color-scheme: dark)"

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
): UiAppearance {
  if (preference === "light") return "light"
  if (preference === "dark") return "dark"
  if (typeof window === "undefined") return "light"
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light"
}

function readResolvedFromDom(): UiAppearance | null {
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

/**
 * Apply preference, persist it, sync `<html class="light|dark">`, and tell every
 * mounted `useTheme` — this is the hook's `setPreference`.
 */
export function applyUiThemePreference(preference: UiThemePreference) {
  syncUiThemeAppearance(preference)
  persistPreference(preference)
  //mirror to native storage so the OS splash colour follows the app theme (native only)
  void persistNativeThemePreference(preference)
  notifyTheme()
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

export type UseThemeResult = {
  /**
   * What the user chose: `"light"`, `"dark"`, or `"system"` to follow the OS.
   * This is the value a Light / Dark / System control shows as selected.
   */
  preference: UiThemePreference
  /**
   * What is painted — the preference with `"system"` resolved against the OS.
   * Follows the OS live while the preference is `"system"`, and only then.
   */
  resolved: UiAppearance
  /** Choose a preference: stamps `<html>`, persists it, mirrors it to native. */
  setPreference: (preference: UiThemePreference) => void
}

/**
 * The preference `<html>` carries. The attribute is what the page is actually
 * showing, so it wins over storage — another tab can write storage at any time,
 * and that choice is only this page's once a resume restamps it.
 */
function readAppliedPreference(): UiThemePreference {
  return readPreferenceFromDom() ?? readStoredPreference() ?? "system"
}

/**
 * The appearance `<html>` carries. In system mode that is the class the
 * pre-paint script (or a listener below) stamped — never a fresh OS read, which
 * would answer differently from the page whenever the stamp is behind.
 */
function readAppliedAppearance(): UiAppearance {
  const preference = readAppliedPreference()
  if (preference !== "system") return preference
  return readResolvedFromDom() ?? "light"
}

//The server has no storage and no <html> stamp, so it can only ever render the
//default. The first client render of a hydration answers the same, and the
//hook corrects it in a layout effect, before the browser paints.
const SERVER_PREFERENCE = (): UiThemePreference => "system"
const SERVER_APPEARANCE = (): UiAppearance => "light"

/**
 * One store for every `useTheme` in the tree. The state already lives outside
 * React, on `<html>` and in storage, so a module-level subscription is the
 * honest shape: a per-instance copy is what let two instances disagree. The
 * listeners are shared too, and only attached while something subscribes.
 */
const themeListeners = new Set<() => void>()
let stopWatchingTheme: (() => void) | null = null

function notifyTheme() {
  for (const listener of [...themeListeners]) listener()
}

function watchTheme(): () => void {
  //a preference written to <html> by anything else — `applyUiThemePreference`
  //called outside a hook, or React reconciling the document
  const observer = new MutationObserver(notifyTheme)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", PREFERENCE_ATTR],
  })

  const scheme = window.matchMedia(DARK_QUERY)
  const onOsAppearanceChange = () => {
    if (readAppliedPreference() !== "system") return
    syncUiThemeAppearance("system")
    notifyTheme()
  }
  scheme.addEventListener("change", onOsAppearanceChange)

  //a page in the background receives no change event, and another tab may have
  //stored a different preference meanwhile: restamp from storage on the way back
  const onResume = () => {
    if (document.visibilityState !== "visible") return
    syncUiThemeAppearance(readPreference())
    notifyTheme()
  }
  document.addEventListener("visibilitychange", onResume)
  window.addEventListener("pageshow", onResume)

  return () => {
    observer.disconnect()
    scheme.removeEventListener("change", onOsAppearanceChange)
    document.removeEventListener("visibilitychange", onResume)
    window.removeEventListener("pageshow", onResume)
  }
}

function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener)
  stopWatchingTheme ??= watchTheme()
  return () => {
    themeListeners.delete(listener)
    if (themeListeners.size > 0 || !stopWatchingTheme) return
    stopWatchingTheme()
    stopWatchingTheme = null
  }
}

/**
 * The theme preference and the appearance it resolves to, plus the one way to
 * change it. Every instance reads the same store, so a settings screen and the
 * shell stay in step.
 *
 * ```tsx
 * const { preference, resolved, setPreference } = useTheme()
 * <button aria-pressed={preference === "system"} onClick={() => setPreference("system")}>System</button>
 * ```
 */
export function useTheme(): UseThemeResult {
  const preference = useSyncExternalStore(
    subscribeTheme,
    readAppliedPreference,
    SERVER_PREFERENCE,
  )
  const resolved = useSyncExternalStore(
    subscribeTheme,
    readAppliedAppearance,
    SERVER_APPEARANCE,
  )
  const [, setMounted] = useState(false)

  useIsomorphicLayoutEffect(() => {
    //React's reconciliation of <html> can drop what the pre-paint script painted
    initUiTheme(readPreference())
    //a hydrating render answered with the server's values; this re-render reads
    //the store, and happens before paint
    setMounted(true)
  }, [])

  return { preference, resolved, setPreference: applyUiThemePreference }
}

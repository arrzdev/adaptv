import { useIsomorphicLayoutEffect } from "#nativ/hooks/use-isomorphic-layout-effect"

const THEME_COLOR_CLASS_OVERRIDE_ID = "theme-color-class-override"

export type UseSyncThemeOptions = {
  themeColorLight: string
  themeColorDark: string
  /** When false, remove the theme-color override (e.g. no resolved light/dark class). */
  enabled?: boolean
}

/**
 * Keep the single `theme-color` meta and `html`/`body` background in sync with
 * `<html class="light|dark">`. The pre-paint head script
 * ({@link getUiThemeInitScript}) seeds both; this hook maintains them reactively
 * across theme toggles and OS appearance changes — it is the only runtime owner
 * of the `theme-color` meta (no static media metas, no head observer).
 */
export function useSyncTheme({
  themeColorLight,
  themeColorDark,
  enabled = true,
}: UseSyncThemeOptions) {
  useIsomorphicLayoutEffect(() => {
    const root = document.documentElement

    function clearShellBackground() {
      root.style.removeProperty("background-color")
      document.body?.style.removeProperty("background-color")
    }

    function resolveShellColor(isDark: boolean) {
      return isDark ? themeColorDark : themeColorLight
    }

    function paintShellBackground(isDark: boolean) {
      const color = resolveShellColor(isDark)
      root.style.setProperty("background-color", color, "important")
      document.body?.style.setProperty(
        "background-color",
        color,
        "important",
      )
    }

    function syncTheme() {
      const isDark = root.classList.contains("dark")
      const isLight = root.classList.contains("light")

      if (!enabled || (!isDark && !isLight)) {
        document.getElementById(THEME_COLOR_CLASS_OVERRIDE_ID)?.remove()
        clearShellBackground()
        return
      }

      let el = document.getElementById(
        THEME_COLOR_CLASS_OVERRIDE_ID,
      ) as HTMLMetaElement | null
      if (!el) {
        el = document.createElement("meta")
        el.id = THEME_COLOR_CLASS_OVERRIDE_ID
        el.name = "theme-color"
        document.head.appendChild(el)
      }

      el.content = resolveShellColor(isDark)
      el.removeAttribute("media")
      paintShellBackground(isDark)
    }

    syncTheme()
    const rootMo = new MutationObserver(syncTheme)
    rootMo.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => {
      rootMo.disconnect()
      document.getElementById(THEME_COLOR_CLASS_OVERRIDE_ID)?.remove()
      clearShellBackground()
    }
  }, [enabled, themeColorDark, themeColorLight])
}

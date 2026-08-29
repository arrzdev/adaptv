import { setThemeColorBase } from "#adaptv/capabilities/theme-color"
import { useIsomorphicLayoutEffect } from "#adaptv/hooks/use-isomorphic-layout-effect"
import { THEME_COLOR_META_ID } from "#adaptv/shell/theme-init-script"

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
 *
 * ⚠︎ The two outputs are NOT redundant, and the meta is the weaker one.
 *
 * `theme-color` is inert on iOS 26.0–26.5 — caniuse records it as *"supported, but
 * does not actually use the color anywhere"*, and WebKit now derives the top-bar
 * tint from the **rendered `html`/`body` background near the viewport edge**
 * instead (confirmed by an Apple WebKit engineer on bug 301756). Firefox has never
 * supported it at all.
 * @see https://bugs.webkit.org/show_bug.cgi?id=301756
 *
 * So the background paint below is **load-bearing on iOS, not merely anti-flash**,
 * and `theme-color` is now the Android/Chrome + iOS ≤ 18 path only. Keep both;
 * neither covers the whole matrix. `use-sync-theme.test.ts` guards the paint,
 * because next to the meta tag it reads like duplication.
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
        setThemeColorBase(null)
        document.getElementById(THEME_COLOR_META_ID)?.remove()
        clearShellBackground()
        return
      }

      let el = document.getElementById(
        THEME_COLOR_META_ID,
      ) as HTMLMetaElement | null
      if (!el) {
        el = document.createElement("meta")
        el.id = THEME_COLOR_META_ID
        el.name = "theme-color"
        document.head.appendChild(el)
      }

      el.removeAttribute("media")
      //NOT `el.content = …`: the tag can be on loan to a transition
      //(`capabilities/theme-color.ts`), and this is a theme change, not a
      //reason to yank it back. The base updates either way, so whatever holds
      //the tint restores into the theme that is current when it lets go.
      setThemeColorBase(resolveShellColor(isDark))
      paintShellBackground(isDark)
    }

    syncTheme()
    const rootMo = new MutationObserver(syncTheme)
    rootMo.observe(root, { attributes: true, attributeFilter: ["class"] })
    return () => {
      rootMo.disconnect()
      setThemeColorBase(null)
      document.getElementById(THEME_COLOR_META_ID)?.remove()
      clearShellBackground()
    }
  }, [enabled, themeColorDark, themeColorLight])
}

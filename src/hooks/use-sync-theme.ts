import { setThemeColorBase } from "#adaptv/capabilities/theme-color"
import { useIsomorphicLayoutEffect } from "#adaptv/hooks/use-isomorphic-layout-effect"
import { THEME_COLOR_META_ID } from "#adaptv/shell/theme-init-script"
import { getOS, resolvePlatformTag } from "#adaptv/utils/platform"

export type UseSyncThemeOptions = {
  themeColorLight: string
  themeColorDark: string
  /**
   * The current route's declared `chromeTint`, or `null` to follow the theme.
   *
   * **One colour, and it wins in both themes.** A route that pins the chrome
   * wants that chrome; a route that should follow the theme declares nothing and
   * gets `themeColorLight`/`themeColorDark`. There is no inheritance from a
   * parent route either — the fallback is always the app's global colours.
   *
   * The value comes from the build-time table, not from the route object, so it
   * is the same value the pre-paint script already painted. → `shell/route-tints.ts`
   */
  chromeTint?: string | null
  /** When false, remove the theme-color override (e.g. no resolved light/dark class). */
  enabled?: boolean
}

/**
 * The hash the status-bar resample moves the URL to for one call, before it puts the
 * URL back in the same task. The router, `popstate`, `hashchange`, scroll and
 * `:target` never see it; the Navigation API does (`navigate` and
 * `currententrychange` fire for each of the two writes), as does anything that
 * patches `History.prototype`.
 */
export const STATUS_BAR_RESAMPLE_HASH = "#adaptv-status-bar"

/**
 * Make iOS re-derive an installed web app's status-bar strip after an OS appearance
 * change, by moving the URL and putting it straight back.
 *
 * WebKit/UIKit bug, iOS 26.1 standalone web app: the web view starts BELOW the status
 * bar (`env(safe-area-inset-top)` is 0), so the strip is a native fill the system
 * derives from the page, which no CSS can reach. On a light→dark OS switch it takes
 * that fill from the light page of the moment and latches a ~90% black scrim over it,
 * measured on a simulator (iOS 26.1 `23B86`): `#010101` over a `#0a0a0c` page until
 * the next same-document navigation, `#171717` over `#eeeeec` even past one (below),
 * `#0d0019` over `#8000ff`, still there 13 s later. It reproduces on a static page
 * with no script, with every `apple-mobile-web-app-status-bar-style`, and when the
 * switch happens while the app is in the background. Dark→light, cold launches and
 * iOS 18.0 are clean, and a Safari tab never shows it.
 *
 * On a static probe page: repaints, scrolls and a meta write did not clear it, and a
 * same-URL `replaceState` not reliably (2 of 5); a `replaceState` to a new hash
 * followed by one back to the original, in the same task, cleared it 3/3, and run
 * inside the `prefers-color-scheme` change handler it prevented the band in 4/4 live
 * switches and 2/2 background switches (2/2 and 2/2 banded without it). In the
 * installed playground on 26.1, with the theme following the OS: 3/3 live and 3/3
 * background switches clean, against 2/2 and 2/2 banded on main.
 *
 * It does not fix a page that stays light through the switch, as with an explicit
 * light preference: the strip still latches `#171717` over `#eeeeec` (2/2 in the
 * playground). On a light probe page the pair did not clear it synchronously, in a
 * frame, or after 0.5 or 1.5 s, and neither did a `pushState` that changes the URL, a
 * reload, a two-frame `color-scheme` flip, a 600 ms full-page dark paint with no
 * pair, a 4 px dark strip with the pair, or the page painted dark for one frame or
 * 100 ms before the pair. Only the whole page painted dark for 300 ms before the pair
 * cleared it (4/4), which is a 600 ms black flash on a light page and is not done.
 *
 * Through `History.prototype`, not `history.replaceState`: TanStack's browser history
 * wraps the instance method to notify the router, which would see the hash for a
 * tick. The current `history.state` is passed back so the router's key and index
 * survive, and both URLs are built from `location.href`, so a `<base href>` cannot
 * move the path. `replaceState` adds no entry and fires no `popstate` or `hashchange`.
 *
 * Removal: re-run the static probe's live light→dark switch with this handler off on
 * a newer iOS; if the strip stays the page's colour there, delete the workaround.
 */
function resampleStatusBarFill() {
  const { href, hash } = window.location
  const replace = History.prototype.replaceState
  const detour =
    hash === STATUS_BAR_RESAMPLE_HASH
      ? `${STATUS_BAR_RESAMPLE_HASH}-`
      : STATUS_BAR_RESAMPLE_HASH
  replace.call(
    window.history,
    window.history.state,
    "",
    `${href.split("#")[0]}${detour}`,
  )
  replace.call(window.history, window.history.state, "", href)
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
  chromeTint = null,
  enabled = true,
}: UseSyncThemeOptions) {
  useIsomorphicLayoutEffect(() => {
    const root = document.documentElement

    function clearShellBackground() {
      root.style.removeProperty("background-color")
      document.body?.style.removeProperty("background-color")
    }

    function resolveShellColor(isDark: boolean) {
      //the route's tint outranks the theme, for BOTH outputs — see the note on
      //`chromeTint` above, and on why both outputs are needed below
      return chromeTint ?? (isDark ? themeColorDark : themeColorLight)
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
  }, [chromeTint, enabled, themeColorDark, themeColorLight])

  //its own effect: the listener is about the OS switch, not about which colours
  //are current, so a route change must not re-subscribe it
  useIsomorphicLayoutEffect(() => {
    //an installed web app on iOS, the only shell × OS pair the bug was seen on.
    //iOS 18 takes the detour too and is harmless there; native was not measured
    const iosStandalone =
      resolvePlatformTag() === "standalone" && getOS() === "ios"
    if (!iosStandalone || typeof window.matchMedia !== "function") return
    const osDark = window.matchMedia("(prefers-color-scheme: dark)")
    //the OS query's own change event, the task the detour was measured in; with an
    //explicit preference it is two wasted writes (a light page stays latched, see
    //above, and an explicit dark one was not seen to band, one run on main)
    osDark.addEventListener("change", resampleStatusBarFill)
    return () =>
      osDark.removeEventListener("change", resampleStatusBarFill)
  }, [])
}

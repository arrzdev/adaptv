/**
 * The pre-paint theme script — a pure string generator, with no React.
 *
 * Lifted out of `hooks/use-theme.ts` because adaptv's Vite plugin needs it at
 * BUILD time to emit the app shell, and a Node-side plugin must not pull in a
 * React hooks module (it imports `react` and, transitively, the Capacitor
 * native-theme accessor). Keeping the generator here makes the config-time and
 * runtime consumers share one implementation without sharing a dependency graph.
 */
//`.ts` on the specifier, deliberately: this module is loaded BOTH by the bundler
//and by Node — `src/vite/shell-emit.ts` imports it to generate the built shell,
//and Node's ESM resolver will not add an extension for it. The rest of `src/vite`
//already writes it this way; this is the first file outside it that has to.

import type { UiThemePreference } from "#adaptv/capabilities/native-theme"
import type { RouteTint } from "#adaptv/shell/route-tints.ts"
import {
  routePathToPattern,
  sortRouteTints,
} from "#adaptv/shell/route-tints.ts"

export const UI_THEME_STORAGE_KEY = "ui-theme-preference" as const
export const PREFERENCE_ATTR = "data-ui-theme"

/**
 * The one `<meta name="theme-color">` adaptv owns. Seeded by the script below, maintained by
 * `useSyncTheme`, and animated by `capabilities/theme-color.ts` — an id rather than a
 * `querySelector` so those three can never end up writing to different tags.
 */
export const THEME_COLOR_META_ID = "theme-color-class-override"

/**
 * Stamped on `<html>` by the script when a route's tint claims the pathname, with the tint in
 * {@link PREPAINT_TINT_VAR}; the critical CSS then paints `html` AND `body` in it, `!important`.
 *
 * The body is the reason. It does not exist when a head script runs, so it cannot be painted
 * inline, and the critical CSS paints it in the THEME colour over `html` — and the body is the
 * edge iOS 26 takes both bars from. An attribute rather than an injected `<style>`: a node the
 * script adds to `<head>` lands among the server-rendered ones and React's hydration of the
 * document mismatches on it, while `<html>` already carries `suppressHydrationWarning` for the
 * class and attribute this script writes. `useSyncTheme` removes both once it owns the paint.
 */
export const PREPAINT_TINT_ATTR = "data-adaptv-prepaint-tint"

/** The custom property carrying the colour for {@link PREPAINT_TINT_ATTR}. */
export const PREPAINT_TINT_VAR = "--adaptv-prepaint-tint"

export function getUiThemeInitScript({
  themeColorLight,
  themeColorDark,
  defaultThemePreference = "system",
  routeTints = [],
  base = "/",
}: {
  themeColorLight: string
  themeColorDark: string
  defaultThemePreference?: UiThemePreference
  /**
   * Routes that pin the chrome to a colour of their own, most specific first
   * (see {@link sortRouteTints}). The script matches `location.pathname` against
   * them and paints the winner instead of the theme colour — which is the whole
   * point of computing this at build time: a cold launch straight onto a tinted
   * route must never show the theme's colour for a frame first.
   */
  routeTints?: readonly RouteTint[]
  /** The app's base URL, stripped before matching so a subpath deploy still matches. */
  base?: string
}): string {
  const key = UI_THEME_STORAGE_KEY
  const attr = PREFERENCE_ATTR
  const overrideId = THEME_COLOR_META_ID
  const prepaintAttr = PREPAINT_TINT_ATTR
  const prepaintVar = PREPAINT_TINT_VAR
  const fallbackPreference = defaultThemePreference
  //`[pattern, colour]` pairs, already ordered and already compiled to regex
  //SOURCE — the script does no path arithmetic of its own, it just tries them in
  //order and takes the first hit. Everything that could be got wrong about
  //turning a route id into a URL is done at build time, where it is testable.
  const tints = sortRouteTints([...routeTints]).map(
    (t) => [routePathToPattern(t.path), t.tint] as const,
  )
  //`cs` (the color-scheme meta) is pinned to the RESOLVED theme: a single value when
  //the app forces light/dark so the *app* theme drives Chrome's WebAPK bar canvas (fix
  //for the Android standalone-PWA gutters tinting off the DEVICE theme), and only
  //`light dark` in "system" mode where following the OS is correct. Owned here, not as
  //a static head meta — mirrors how the theme-color meta is seeded.
  //`tn` resolves the CHROME colour: a route's own tint if one claims this
  //pathname, the theme's colour otherwise. Both outputs below take it — the meta
  //tag (Android/Chrome, iOS <= 18) and the html/body paint (iOS 26+, where the
  //tag is inert and WebKit reads the rendered edge pixels instead). Neither
  //covers the whole matrix; see `use-sync-theme.ts`.
  //`html` is painted inline, but `body` has not been parsed yet and the critical
  //CSS paints it the THEME colour over html. So a tint is also handed to the
  //critical CSS through `pa`/`pv` (see PREPAINT_TINT_ATTR) — only a tint, since
  //the theme colour is what the critical CSS paints already, and only one the
  //engine accepted: `r.style.backgroundColor` reads back empty after an invalid
  //colour, where `var()` of it would compute to transparent and, `!important`,
  //win over the theme rules on the first frame.
  return `(function(){var k=${JSON.stringify(key)},a=${JSON.stringify(attr)},i=${JSON.stringify(overrideId)},pa=${JSON.stringify(prepaintAttr)},pv=${JSON.stringify(prepaintVar)},l=${JSON.stringify(themeColorLight)},d=${JSON.stringify(themeColorDark)},df=${JSON.stringify(fallbackPreference)},tt=${JSON.stringify(tints)},bs=${JSON.stringify(base)},r=document.documentElement,p=null;try{p=localStorage.getItem(k)}catch(e){}if(p!=="light"&&p!=="dark"&&p!=="system"){p=r.getAttribute(a)}if(p!=="light"&&p!=="dark"&&p!=="system"){p=df}var v=p==="light"?"light":p==="dark"?"dark":(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");var shellBg=v==="dark"?d:l;var pn=location.pathname;if(bs&&bs!=="/"&&pn.indexOf(bs)===0){pn=pn.slice(bs.length-1)}var tn=shellBg;for(var j=0;j<tt.length;j++){if(new RegExp(tt[j][0]).test(pn)){tn=tt[j][1];break}}r.classList.remove("light","dark");r.classList.add(v);r.style.colorScheme=v;r.style.backgroundColor=tn;r.setAttribute(a,p);if(tn!==shellBg&&r.style.backgroundColor){r.style.setProperty(pv,tn);r.setAttribute(pa,"")}var m=document.getElementById(i);if(!m){m=document.createElement("meta");m.id=i;m.name="theme-color";document.head.appendChild(m)}m.content=tn;m.removeAttribute("media");var cs=document.querySelector('meta[name="color-scheme"]');if(!cs){cs=document.createElement("meta");cs.setAttribute("name","color-scheme");document.head.appendChild(cs)}cs.content=p==="system"?"light dark":v})();`
}

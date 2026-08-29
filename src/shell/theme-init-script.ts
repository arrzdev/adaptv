/**
 * The pre-paint theme script — a pure string generator, with no React.
 *
 * Lifted out of `hooks/use-theme.ts` because adaptv's Vite plugin needs it at
 * BUILD time to emit the app shell, and a Node-side plugin must not pull in a
 * React hooks module (it imports `react` and, transitively, the Capacitor
 * native-theme accessor). Keeping the generator here makes the config-time and
 * runtime consumers share one implementation without sharing a dependency graph.
 */
export type UiThemePreferenceValue = "light" | "dark" | "system"

export const UI_THEME_STORAGE_KEY = "ui-theme-preference" as const
export const PREFERENCE_ATTR = "data-ui-theme"

/**
 * The one `<meta name="theme-color">` adaptv owns. Seeded by the script below, maintained by
 * `useSyncTheme`, and animated by `capabilities/theme-color.ts` — an id rather than a
 * `querySelector` so those three can never end up writing to different tags.
 */
export const THEME_COLOR_META_ID = "theme-color-class-override"

export function getUiThemeInitScript({
  themeColorLight,
  themeColorDark,
  defaultThemePreference = "system",
}: {
  themeColorLight: string
  themeColorDark: string
  defaultThemePreference?: UiThemePreferenceValue
}): string {
  const key = UI_THEME_STORAGE_KEY
  const attr = PREFERENCE_ATTR
  const overrideId = THEME_COLOR_META_ID
  const fallbackPreference = defaultThemePreference
  //`cs` (the color-scheme meta) is pinned to the RESOLVED theme: a single value when
  //the app forces light/dark so the *app* theme drives Chrome's WebAPK bar canvas (fix
  //for the Android standalone-PWA gutters tinting off the DEVICE theme), and only
  //`light dark` in "system" mode where following the OS is correct. Owned here, not as
  //a static head meta — mirrors how the theme-color meta is seeded.
  return `(function(){var k=${JSON.stringify(key)},a=${JSON.stringify(attr)},i=${JSON.stringify(overrideId)},l=${JSON.stringify(themeColorLight)},d=${JSON.stringify(themeColorDark)},df=${JSON.stringify(fallbackPreference)},r=document.documentElement,p=null;try{p=localStorage.getItem(k)}catch(e){}if(p!=="light"&&p!=="dark"&&p!=="system"){p=r.getAttribute(a)}if(p!=="light"&&p!=="dark"&&p!=="system"){p=df}var v=p==="light"?"light":p==="dark"?"dark":(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");var shellBg=v==="dark"?d:l;r.classList.remove("light","dark");r.classList.add(v);r.style.colorScheme=v;r.style.backgroundColor=shellBg;r.setAttribute(a,p);var m=document.getElementById(i);if(!m){m=document.createElement("meta");m.id=i;m.name="theme-color";document.head.appendChild(m)}m.content=shellBg;m.removeAttribute("media");var cs=document.querySelector('meta[name="color-scheme"]');if(!cs){cs=document.createElement("meta");cs.setAttribute("name","color-scheme");document.head.appendChild(cs)}cs.content=p==="system"?"light dark":v})();`
}

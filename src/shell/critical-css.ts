/**
 * Inline critical CSS — painted before the app stylesheet loads so the launch never
 * flashes unpainted, and the splash policy resolves from the very first frame.
 *
 * Pure string builder (no React / vite deps) so it's unit-testable in isolation.
 *
 * - **Base background** (`html,body`) applies everywhere — plain anti-flash.
 * - **Overscan bleed** (`html::before`, `--viewport-cover-bleed` past every edge) is
 *   gated to **installed** contexts: it covers the overscan when a standalone PWA /
 *   native WebView's initial containing block paints small then expands on launch. A
 *   browser tab has no such resize, so it gets no bleed element.
 * - **Splash gate** (opinionated) — the custom React splash (`[data-adaptv-splash]`)
 *   shows when the app is INSTALLED (`data-adaptv-platform` `native` or `standalone`);
 *   a plain browser tab (`web`) serves the pages instantly with no splash, unless the
 *   app opts into `splashScreenInBrowser`. Gated off the pre-paint platform stamp, so
 *   the overlay never paints where it's suppressed — no hydration mismatch, no flash.
 */
export function getCriticalShellCss(
  themeColorLight: string,
  themeColorDark: string,
  splashScreenInBrowser: boolean,
): string {
  //base background — all contexts
  const base = `:root{--viewport-cover-bleed:5rem}html,body{background-color:${themeColorLight}}@media (prefers-color-scheme:dark){html,body{background-color:${themeColorDark}}}html.light,html.light body{background-color:${themeColorLight}}html.dark,html.dark body{background-color:${themeColorDark}}`
  //launch-overscan bleed — installed / standalone only
  const bleed = `@media (display-mode:standalone){html::before{content:"";position:fixed;inset:calc(-1*var(--viewport-cover-bleed));z-index:-1;background-color:${themeColorLight}}html.light::before{background-color:${themeColorLight}}html.dark::before{background-color:${themeColorDark}}}@media (display-mode:standalone) and (prefers-color-scheme:dark){html::before{background-color:${themeColorDark}}}`
  //same bleed for a native Capacitor build (reports display-mode:browser, so the
  //media query above misses it). Theme init always stamps html.light/.dark, so key
  //dark off the class.
  const nativeBleed = `html[data-adaptv-platform="native"]::before{content:"";position:fixed;inset:calc(-1*var(--viewport-cover-bleed));z-index:-1;background-color:${themeColorLight}}html[data-adaptv-platform="native"].dark::before{background-color:${themeColorDark}}`
  //splash gate — hide the custom splash in a browser tab unless the app opts in;
  //native + standalone always show it (the OS launch splash is a flat brand colour
  //that hands off to this overlay).
  const splashGate = splashScreenInBrowser
    ? ""
    : `html[data-adaptv-platform="web"] [data-adaptv-splash]{display:none!important}`
  return base + bleed + nativeBleed + splashGate
}

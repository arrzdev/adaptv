/**
 * The generated app shell. → `docs/design/rendering.md §3.1.2`, `docs/design/lifecycle.md §1.2`
 *
 * ## Why adaptv generates this rather than reusing Start's
 *
 * Measured against a real app: TanStack Start emits **no HTML at all** in this
 * configuration — no `_shell.html`, no `index.html` — even with
 * `spa: { enabled: true }`. So there is nothing to copy, and two features depend
 * on there being something:
 *
 * - **A `render: "spa"` deploy** needs a document to serve for every path.
 * - **The SSR service worker's precache fallback** binds to a shell URL; without
 *   the file, the offline path resolves to a 404 instead of booting React.
 *
 * ## Why *generated*, never captured
 *
 * The obvious shortcut — render one page at build time and save the HTML — is
 * wrong in a way that only shows up in production. A captured document is
 * whatever the server rendered *for whoever triggered the build*: their session,
 * their locale, their feature flags. It then gets precached and served to
 * everyone. Generating the shell makes user-agnosticism **structural** rather
 * than something a future contributor has to remember not to break.
 *
 * The shell's only job is to boot the client router at `location.pathname`. It
 * carries no route content by design.
 */

import {
  APP_ROOT_ID,
  getBootFallbackCss,
  getBootFallbackMarkup,
  getBootFallbackScript,
} from "#adaptv/shell/boot-fallback.ts"

export type AppShellOptions = {
  lang: string
  title: string
  /** Inlined, not linked — a round trip here happens before first paint. */
  criticalCss: string
  /** Pre-paint platform + theme stamp. Must run before the stylesheet. */
  headInitScript: string
  /**
   * Pre-paint script that reads the app's CSS custom properties, so it goes AFTER the
   * stylesheet link: a script behind a pending stylesheet waits for it. The launch-height
   * script reads `--adaptv-inset-top`; ahead of the stylesheet it would read 0, and an
   * iOS 18 reload (100vh 852 over innerHeight 793 under a 59pt inset, pinned in
   * `launch-viewport.test.ts`) would lower the height to 793, by the script's arithmetic
   * (not run in the shell). The server-rendered page gets the same wait from React
   * hoisting its stylesheets. After the modulepreload links too, so the parser has
   * reached them before it waits.
   */
  styledInitScript?: string
  stylesHref: string
  entryHref: string
  /**
   * The entry chunk's static import graph, as public hrefs. Declared up front
   * so the browser fetches them alongside the entry instead of discovering them
   * one level at a time when the entry has finished downloading. → `shell-emit.ts`
   */
  modulepreloadHrefs?: readonly string[]
  /** Extra head markup (manifest link, icons, meta) inserted verbatim. */
  headExtra?: string
  /**
   * The app's error component, prerendered to static HTML **once per boot code**
   * (the code is a prop, so an app can branch on it). Embedded hidden and revealed
   * by the watchdog if the bundle never boots — the one screen that has to survive
   * its own build being broken. Identical renders collapse to one copy. Omitted →
   * no fallback is emitted at all, so the shell is byte-identical to what it was
   * before. → `src/shell/boot-fallback.ts`
   */
  bootFallbackByCode?: Readonly<Record<string, string>>
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

/**
 * Render the shell document.
 *
 * Deterministic: the same options always produce byte-identical output. That
 * matters because the shell is precached — a shell that varied between builds
 * would churn its precache revision on every deploy and re-download for every
 * user, for no reason.
 */
export function renderAppShell(options: AppShellOptions): string {
  const fallback = options.bootFallbackByCode
  return [
    "<!DOCTYPE html>",
    `<html lang="${escapeHtml(options.lang)}">`,
    "<head>",
    '<meta charset="utf-8">',
    //`viewport-fit=cover` is not optional styling: Capacitor gates safe-area
    //inset reporting on the meta tag LITERALLY containing this string.
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    `<title>${escapeHtml(options.title)}</title>`,
    //init script first — the platform/theme stamp must land before first paint,
    //or the app:/web: variants and the splash policy resolve on the wrong frame
    `<script>${options.headInitScript}</script>`,
    //the boot watchdog goes in the HEAD, not the body: a script that fails to
    //LOAD dispatches its error event on the element, and a listener registered
    //after the fact never sees it. Here it is armed before anything else runs.
    ...(fallback ? [`<script>${getBootFallbackScript()}</script>`] : []),
    `<style>${options.criticalCss}${fallback ? getBootFallbackCss() : ""}</style>`,
    options.headExtra ?? "",
    `<link rel="stylesheet" href="${options.stylesHref}">`,
    ...(options.modulepreloadHrefs ?? []).map(
      (href) => `<link rel="modulepreload" href="${href}">`,
    ),
    ...(options.styledInitScript
      ? [`<script>${options.styledInitScript}</script>`]
      : []),
    "</head>",
    "<body>",
    //empty by design — this is the boot scaffolding, not a page
    `<div id="${APP_ROOT_ID}"></div>`,
    ...(fallback ? [getBootFallbackMarkup(fallback)] : []),
    `<script type="module" src="${options.entryHref}"></script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n")
}

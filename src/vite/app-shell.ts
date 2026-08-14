/**
 * The generated app shell. → `RENDERING.md §3.1.2`, `LIFECYCLE.md §1.2`
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

export type AppShellOptions = {
  lang: string
  title: string
  /** Inlined, not linked — a round trip here happens before first paint. */
  criticalCss: string
  /** Pre-paint platform + theme stamp. Must run before the stylesheet. */
  headInitScript: string
  stylesHref: string
  entryHref: string
  /** Extra head markup (manifest link, icons, meta) inserted verbatim. */
  headExtra?: string
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
    `<style>${options.criticalCss}</style>`,
    options.headExtra ?? "",
    `<link rel="stylesheet" href="${options.stylesHref}">`,
    "</head>",
    "<body>",
    //empty by design — this is the boot scaffolding, not a page
    '<div id="root"></div>',
    `<script type="module" src="${options.entryHref}"></script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n")
}

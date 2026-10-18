/*
 * The header policy for every response the site sends. Most pages are prerendered
 * and served from assets, which never reach the Worker: they get these headers from
 * the `_headers` file `staticHeaderRules` writes (`scripts/docs-markdown.ts`). What
 * the Worker renders itself (an unknown URL) gets them from `withSecurityHeaders` in
 * `src/server.ts`.
 *
 * HSTS without includeSubDomains or preload: other tudu.dev hosts are not all on
 * Workers. The CSP is report-only (console, no collector) until it runs clean.
 *
 * No `@/` imports: the build's config loader imports this file and cannot resolve them.
 */
const CSP = [
  "default-src 'self'",
  //the theme script runs inline before the first paint
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  //the site calls no API; the service worker fetches its own origin
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ")

export const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy-Report-Only": CSP,
} as const

//a public page: browsers revalidate every time, a shared cache may keep it a minute
export const CACHE_PUBLIC_HTML =
  "public, max-age=0, s-maxage=60, must-revalidate"
//a response that sets a cookie: no cache keeps it
export const CACHE_PRIVATE = "private, no-store"

//the prerendered pages: `/`, a top-level page (`/docs`, `/blog`, also `/llms.txt`
//and the like) and everything under /docs/ and /blog/. Never a pattern that matches
///assets/: Nitro appends `/assets/*` with `immutable`, and two Cache-Control
//values on one file are joined with a comma
const PAGE_PATTERNS = ["/", "/:page", "/docs/*", "/blog/*"]

/** The `_headers` rules for static assets: security headers on all, page caching on pages. */
export function staticHeaderRules() {
  const security = Object.entries(SECURITY_HEADERS)
    .map(([name, value]) => `  ${name}: ${value}\n`)
    .join("")
  const pages = PAGE_PATTERNS.map(
    (pattern) => `${pattern}\n  Cache-Control: ${CACHE_PUBLIC_HTML}\n`,
  ).join("")
  return `/*\n${security}${pages}`
}

/** The security headers on any Worker response, and the cache policy on pages and cookie responses. */
export function withSecurityHeaders(response: Response): Response {
  //copy instead of mutating: a fetched or streamed response can carry immutable headers
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SECURITY_HEADERS))
    headers.set(name, value)
  if (response.headers.has("Set-Cookie"))
    headers.set("Cache-Control", CACHE_PRIVATE)
  else if (response.headers.get("Content-Type")?.includes("text/html"))
    headers.set("Cache-Control", CACHE_PUBLIC_HTML)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

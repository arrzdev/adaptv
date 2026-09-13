/**
 * The public URL of a file in the client output, under the app's deploy base.
 *
 * Every URL adaptv writes for the browser (the shell's scripts and stylesheet,
 * the manifest and its icons, the worker's shell binding, the static host's SPA
 * rule) goes through here, because a root-absolute `/assets/…` is only right
 * while the app is served at `/`. A GitHub Pages project site lives at
 * `/<repo>/`, and there every such URL is a 404. → `docs/decisions/register.md` B1
 *
 * `base` is Vite's resolved `base` (or `import.meta.env.BASE_URL`, the same
 * value in the bundle). Vite keeps a trailing slash only when one was written,
 * so `"/app"` and `"/app/"` both arrive here and must both join to `/app/<file>`.
 */
export function publicPath(base: string, file: string): string {
  const prefix = base.endsWith("/") ? base : `${base}/`
  return `${prefix}${file.replace(/^\/+/, "")}`
}

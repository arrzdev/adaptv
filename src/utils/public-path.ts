/**
 * The public URL of a file in the client output, under the app's deploy base.
 *
 * Every URL adaptv writes for the browser (the shell's scripts and stylesheet,
 * the manifest and its icons, the worker's shell binding, the static host's SPA
 * rule) goes through here, because a root-absolute `/assets/…` is only right
 * while the app is served at `/`. A GitHub Pages project site lives at
 * `/<repo>/`, and there every such URL is a 404. → `docs/decisions/register.md` B1
 *
 * `base` is either Vite's resolved `config.base` or `import.meta.env.BASE_URL`,
 * and the two are NOT the same string. Vite gives `config.base` a trailing slash
 * always, but `BASE_URL` keeps the base as written, so `--base /app` reaches the
 * plugins as `"/app/"` and the bundle as `"/app"`. Both must join to
 * `/app/<file>`, which is why nothing in adaptv concatenates onto either one: a
 * base-relative URL is built here or it is built wrong.
 */
export function publicPath(base: string, file: string): string {
  const prefix = base.endsWith("/") ? base : `${base}/`
  return `${prefix}${file.replace(/^\/+/, "")}`
}

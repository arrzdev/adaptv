import { existsSync, readFileSync, statSync } from "node:fs"
import { createServer } from "node:http"
import path from "node:path"

/*
 * A GitHub Pages project site, reduced to the parts a subpath spa build
 * depends on. It is an emulation written from how Pages is documented to
 * behave, not a recording of github.io, and no run here was made against the
 * real host.
 *
 * What it does the way Pages does: the build output is mounted at `/<repo>/`; a
 * directory is answered by its `index.html`; a bare `/<repo>` is a 301 to
 * `/<repo>/` (emulated, though no spec walks it); every miss under the mount is
 * the site's own `404.html` with a real 404 status, which is the deep-link case
 * the suite exists for; and nothing outside the mount belongs to this app, so
 * it is a plain 404. `_redirects` and `_headers` are ignored, as Pages ignores
 * them, so the SPA rule adaptv emits cannot rescue a deep link here either.
 *
 * One neighbour shares the origin, because on `<user>.github.io` every project
 * site does: `/other/` is a second site, a page that registers its own worker
 * at `/other/sw.js`. It is not adaptv and not a build, just the smallest thing
 * that owns a registration outside the mount.
 *
 * What it does not do: no `Cache-Control: max-age=600`, ETag, Last-Modified or
 * compression, so nothing is ever served from the HTTP cache and a worker
 * update is not slowed the way a real Pages deploy can be; no trailing-slash
 * 301 for a subdirectory, no extensionless lookup of `<name>.html`, no Jekyll
 * (`.nojekyll` is emitted and unit-tested, but its effect is not exercised); no
 * HTTP to HTTPS redirect (localhost is a secure context, so the worker registers
 * as it would on https); every method is answered like a GET, with no HEAD,
 * Range or conditional handling; and a small MIME table. Case sensitivity is
 * only half emulated: the mount prefix is matched exactly, but files are looked
 * up on the local disk, which is case-insensitive on a default macOS volume
 * (Pages is case-sensitive; Linux CI is too).
 *
 * Deliberately not `vite preview --base`: preview answers a deep link with a 200
 * document of its own, which is exactly the forgiveness a static host does not
 * have.
 *
 * Usage: tsx subpath-host.ts <dir> <port> <mount>
 */

const NEIGHBOUR = "/other/"
const NEIGHBOUR_FILES: Record<string, [string, string]> = {
  [NEIGHBOUR]: [
    "text/html; charset=utf-8",
    `<!doctype html><title>other</title><h1>Another site</h1><script>navigator.serviceWorker.register("./sw.js")</script>`,
  ],
  [`${NEIGHBOUR}sw.js`]: [
    "text/javascript",
    `self.addEventListener("fetch", () => {})`,
  ],
}

const [dir, port, mount] = process.argv.slice(2)
if (!dir || !port || !mount?.startsWith("/") || !mount.endsWith("/")) {
  throw new Error("usage: subpath-host.ts <dir> <port> </mount/>")
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
}

function fileAt(pathname: string): string | null {
  const root = path.resolve(dir)
  const candidate = path.join(
    root,
    decodeURIComponent(pathname.slice(mount.length)),
  )
  if (!candidate.startsWith(root)) return null
  if (!existsSync(candidate)) return null
  if (statSync(candidate).isDirectory()) {
    const index = path.join(candidate, "index.html")
    return existsSync(index) ? index : null
  }
  return candidate
}

createServer((request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://host")
  if (`${pathname}/` === mount) {
    response.writeHead(301, { location: mount })
    response.end()
    return
  }
  const neighbour = NEIGHBOUR_FILES[pathname]
  if (neighbour && !pathname.startsWith(mount)) {
    response.writeHead(200, { "content-type": neighbour[0] })
    response.end(neighbour[1])
    return
  }
  if (!pathname.startsWith(mount)) {
    response.writeHead(404, { "content-type": "text/plain" })
    response.end("outside the site")
    return
  }
  const file = fileAt(pathname)
  if (file) {
    response.writeHead(200, {
      "content-type":
        CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
    })
    response.end(readFileSync(file))
    return
  }
  const notFound = path.join(dir, "404.html")
  response.writeHead(404, { "content-type": CONTENT_TYPES[".html"] })
  response.end(existsSync(notFound) ? readFileSync(notFound) : "not found")
}).listen(Number(port))

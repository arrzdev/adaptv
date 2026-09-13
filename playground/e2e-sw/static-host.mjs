import { existsSync, readFileSync, statSync } from "node:fs"
import { createServer } from "node:http"
import path from "node:path"

/*
 * A static host for the `spa` worker suite: the build directory, answered from
 * disk, the way Netlify and Cloudflare Pages serve the files adaptv emits.
 *
 * Not `vite preview`. The preview mounts Start's server handler, and that
 * handler renders a navigation whatever `render` the build was: a first visit
 * to `/` came back as a server-rendered document carrying the `$_TSR`
 * bootstrap, and `/sw-probe-redirect` as a server `307`. So every document the
 * suite fetched before a worker took over hydrated a server render, and the
 * static shell's boot (`client-entry.tsx`, the no-`$_TSR` branch) only ever ran
 * from the worker's precache. A static host has no server to render anything.
 *
 * The order, per request: a file that exists is served (a directory by its
 * `index.html`); otherwise the first `_redirects` rule that matches decides,
 * where `200` rewrites to the target's bytes and a `3xx` redirects to it;
 * otherwise `404.html` with a real 404. A file always shadows a rule, as both
 * hosts document. adaptv writes `/* /index.html 200`, so in practice every
 * unknown path is the shell with a 200, and the fallback after it is only
 * reached by a build that stopped emitting the rule.
 *
 * Everything is read from disk on every request, rules included, so
 * `update.spec`'s `deploy()` rebuild is served the moment it lands; while that
 * build has the directory emptied, a request is a 404 like any host mid-upload.
 * Nothing is compressed, and every response says `Cache-Control: no-cache` with
 * no validators, so the browser's HTTP cache never stands between a deploy and
 * the next fetch.
 *
 * What it does not do: the rest of the `_redirects` grammar (placeholders,
 * query or country conditions, a forced `200!`, a rule without a status), which
 * it refuses with a 500 rather than guess at; `_headers`; ETag, Last-Modified,
 * Range or conditional requests; pretty-URL lookups of `<name>.html`; and every
 * method other than HEAD is answered like a GET.
 *
 * Usage, from the app directory: node ../../e2e-sw/static-host.mjs <dir> <port>
 */

const [dir, portArg] = process.argv.slice(2)
const port = Number(portArg)
if (!dir || !port) throw new Error("usage: static-host.mjs <dir> <port>")
const root = path.resolve(dir)

//A wrong directory would otherwise answer every request with a 404, which
//Playwright reports only as a webServer that never came up.
if (!existsSync(path.join(root, "index.html"))) {
  console.error(
    `static-host: no index.html in ${root} — was the build spa?`,
  )
  process.exit(1)
}

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".pdf": "application/pdf",
}

/** The file a URL path names inside the build, or null. Never outside it. */
function fileAt(pathname) {
  const candidate = path.join(root, pathname)
  if (candidate !== root && !candidate.startsWith(root + path.sep))
    return null
  if (!existsSync(candidate)) return null
  if (statSync(candidate).isDirectory()) {
    const index = path.join(candidate, "index.html")
    return existsSync(index) ? index : null
  }
  return candidate
}

/** `_redirects`, read fresh: `[from, to, status]` per rule, in file order. */
function redirectRules() {
  const file = path.join(root, "_redirects")
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const fields = line.split(/\s+/)
      if (fields.length !== 3 || !/^\d{3}$/.test(fields[2])) {
        throw new Error(
          `static-host: unsupported _redirects rule "${line}"`,
        )
      }
      return [fields[0], fields[1], Number(fields[2])]
    })
}

function matches(from, pathname) {
  return from.endsWith("/*")
    ? pathname === from.slice(0, -2) ||
        pathname.startsWith(from.slice(0, -1))
    : pathname === from
}

function send(request, response, status, file) {
  const body = readFileSync(file)
  response.writeHead(status, {
    "content-type":
      CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
    "content-length": body.length,
    "cache-control": "no-cache",
  })
  response.end(request.method === "HEAD" ? undefined : body)
}

createServer((request, response) => {
  try {
    const { pathname: raw } = new URL(request.url ?? "/", "http://host")
    const pathname = decodeURIComponent(raw)

    const file = fileAt(pathname)
    if (file) return send(request, response, 200, file)

    for (const [from, to, status] of redirectRules()) {
      if (!matches(from, pathname)) continue
      if (status >= 300 && status < 400) {
        response.writeHead(status, {
          location: to,
          "cache-control": "no-cache",
        })
        return response.end()
      }
      const target = fileAt(to)
      if (target) return send(request, response, status, target)
      break
    }

    const notFound = fileAt("/404.html")
    if (notFound) return send(request, response, 404, notFound)
    response.writeHead(404, {
      "content-type": "text/plain; charset=utf-8",
    })
    response.end("not found")
  } catch (error) {
    console.error(error)
    response.writeHead(500, {
      "content-type": "text/plain; charset=utf-8",
    })
    response.end(String(error))
  }
})
  .on("error", (error) => {
    //a taken port must fail the webServer, not leave a caller waiting
    console.error(error)
    process.exit(1)
  })
  .listen(port, () => {
    console.log(`static-host: http://localhost:${port}/ serving ${root}`)
  })

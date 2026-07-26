import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

//serves the SPA build (dist/client) for the e2e run, falling back to the
//TanStack Start boot shell (_shell.html) for any unmatched route.

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, "..", "dist", "client")
const SHELL = join(ROOT, "_shell.html")
const PORT = Number(process.env.PORT ?? process.argv[2] ?? 7373)

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
}

function send(res, file) {
  const stream = createReadStream(file)
  stream.on("error", () => {
    if (!res.headersSent) res.writeHead(404)
    res.end("not found")
  })
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
  })
  stream.pipe(res)
}

createServer((req, res) => {
  const url = (req.url ?? "/").split("?")[0]
  const candidate = normalize(join(ROOT, decodeURIComponent(url)))
  if (!candidate.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden")
    return
  }
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    send(res, candidate)
    return
  }
  send(res, SHELL)
}).listen(PORT, () => {
  console.log(`e2e static server: http://localhost:${PORT}`)
})

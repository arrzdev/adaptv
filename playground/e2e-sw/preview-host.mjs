import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"

/*
 * `vite preview` for the worker suites, with one difference: nothing is
 * compressed per request.
 *
 * The preview server answers static files through `serveStatic` from
 * `srvx/static`, which Nitro's `startPreview` mounts. It pipes every file
 * through `createBrotliCompress()` at its default quality, 11, the slowest
 * setting, whenever the request's Accept-Encoding says `br`, and every
 * browser's does; a request that accepts gzip without br gets `createGzip()`
 * instead. Removing the header covers both. A fresh registration precaches the
 * whole build one file at a time, so every `bootControlled` waited seconds on
 * the server's CPU, and under a loaded machine one install outlasted
 * `bootControlled`'s 30 s wait. The time is the server compressing, which no
 * real host does on every request, so it is harness cost and not adaptv's.
 *
 * Everything the suites exist to prove stays real: the same build, the same
 * preview server and its SSR handler, the same bytes at every URL. Only the
 * transfer encoding of static files changes (no `Content-Encoding` or
 * `Vary: Accept-Encoding`, a `Content-Length` instead), and the worker stores
 * the decoded body either way.
 *
 * Why a header strip and not a flag: the handler has no option to turn it off.
 * Why not a proxy in front: a proxy needs a second port, and the configs'
 * whole port contract is one value per suite.
 *
 * Usage, from the app directory: pnpm exec node ../../e2e-sw/preview-host.mjs <port>
 */

const port = Number(process.argv[2])
if (!port) throw new Error("usage: preview-host.mjs <port>")

//The vite the APP resolves, not whichever copy sits nearest this file, so the
//server is configured exactly as `vite preview` in that directory would be.
const requireFromApp = createRequire(
  path.join(process.cwd(), "package.json"),
)
const { preview } = await import(
  pathToFileURL(requireFromApp.resolve("vite")).href
)

//The preview loads Nitro's server entry, whose `uncaughtException` handler
//only logs, so a rejection left to the runtime (a taken port, a bad config)
//would exit 0: a caller saw success, and Playwright could only say the
//server exited early, with no exit code.
let server
try {
  server = await preview({ preview: { port, strictPort: true } })
} catch (error) {
  console.error(error)
  process.exit(1)
}

//First in line, before connect sees the request. `headers` is the view that
//matters: srvx's `get()` reads Node's parsed `request.headers`, and only
//rebuilds from `rawHeaders` once something has walked the whole header list.
//`rawHeaders` is cleaned too so that rebuild cannot bring the header back.
server.httpServer.prependListener("request", (request) => {
  delete request.headers["accept-encoding"]
  const raw = request.rawHeaders
  for (let i = raw.length - 2; i >= 0; i -= 2) {
    if (raw[i].toLowerCase() === "accept-encoding") raw.splice(i, 2)
  }
})

server.printUrls()

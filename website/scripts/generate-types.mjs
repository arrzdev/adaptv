/**
 * Write what `tsc` needs before it can check the site, from a clean checkout.
 *
 * Two things are missing there. The site links the framework, whose `exports` point at
 * `dist/`, so `adaptv/*` resolves to nothing until it is built. And `.adaptv/` (the route
 * tree behind `#adaptv-route-tree` and the ambient `?adaptv-image` types) is written by
 * adaptv's Vite plugin, which only runs in `dev` and `build`. Without both, `typecheck`
 * fails on a fresh worktree with errors that are not about the code.
 *
 * Starting Vite's dev server in middleware mode and running the plugins' `buildStart` is
 * the part of `adaptv dev` that writes `.adaptv/`, without binding a port or building the
 * site. It runs every time, so a route added since the last run is in the tree.
 */
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createServer } from "vite"
import { ensureDist } from "../../scripts/ensure-dist.mjs"

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

if (!ensureDist(path.resolve(site, ".."))) process.exit(1)

const server = await createServer({
  root: site,
  logLevel: "error",
  server: { middlewareMode: true, ws: false },
})
await server.pluginContainer.buildStart({})
await server.close()
//the watchers adaptv's plugin opens would otherwise keep the process alive
process.exit(0)

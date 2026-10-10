import { readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { Plugin } from "vite"
import { isRunnableDevEnvironment } from "vite"
import { importsIn, packageOf } from "#adaptv/vite/engine-imports.ts"

/**
 * The server boundary, read from what the engine decided. → docs/design/server-boundary.md
 *
 * adaptv has no server side, on any target (L3, O3). `ban-server-apis.ts` refuses the
 * engine's server modules by import specifier, which is always one alias behind: a
 * server function made with a factory a package re-exports, or a server route whose
 * options come from another module, built clean. This module reads the verdicts
 * instead, so it catches them however they were written:
 *
 * - **Server functions:** the compiler rewrites each one, in the client environment,
 *   into a stub that imports `@tanstack/<framework>-start/client-rpc`. An app module
 *   that imports that specifier defines a server function, whatever it imported the
 *   factory from (§3.1).
 * - **The server's request:** a module of the server runtime in the client graph means
 *   the app reads the request (`getRequest`, cookies) through some path; Start's own
 *   guard refuses only the specifier, so a package that re-exports it ships the runtime
 *   to the client (§3.4).
 * - **Server routes:** the server build's router is what serves a request, so a route
 *   with `options.server` there is a server route, wherever its options were written
 *   (§3.3).
 *
 * `createMiddleware` leaves no mark of its own in the client (its `.server()` is
 * stripped and nothing is imported): a middleware runs only when a server function, a
 * server route or the server entry runs it, and each of those is refused here (§3.4).
 *
 * The report names files and routes the dev wrote and nothing of the engine, so the CLI
 * can show every line of it (`bin/lib/opacity.mjs`).
 */

const PLUGIN = "adaptv:server-boundary"

/** The import the compiler writes into a server function's client stub. */
const CLIENT_RPC = /^@tanstack\/[^/]+-start\/client-rpc$/

/** A module of the server runtime: in the client graph, the request is read somewhere. */
const SERVER_RUNTIME =
  /[/\\]node_modules[/\\]@tanstack[/\\](?:[^/\\]+-)?start-server-core[/\\]/

/** The router entry Start's server environment resolves. */
const ROUTER_ENTRY = "#tanstack-router-entry"

type RoutesManifest = Record<string, { filePath?: string }>

function routesManifest(): RoutesManifest {
  return (
    (globalThis as { TSS_ROUTES_MANIFEST?: RoutesManifest })
      .TSS_ROUTES_MANIFEST ?? {}
  )
}

const withoutQuery = (id: string) => id.split("?")[0] as string

/** One line of the report: where, what, and the routes that reach it. */
export type BoundaryHit = {
  file: string
  line: number
  what: string
  routes: string[]
}

export type BoundaryKind =
  | "server function"
  | "server request"
  | "server route"

const plural = (n: number, noun: string) =>
  `${n} ${noun}${n === 1 ? "" : "s"}`

/**
 * The refusal. The first line is the reason the CLI puts on its `✖`; one indented line
 * per hit, each a file and line from the app's root; then the way out.
 */
export function describeBoundary(
  hits: ReadonlyArray<BoundaryHit & { kind: BoundaryKind }>,
): string {
  const counts = new Map<BoundaryKind, number>()
  for (const hit of hits)
    counts.set(hit.kind, (counts.get(hit.kind) ?? 0) + 1)
  const reaches = [...counts]
    .map(([kind, n]) =>
      plural(n, kind === "server request" ? "server request read" : kind),
    )
    .join(" and ")
  const width = Math.max(...hits.map((h) => `${h.file}:${h.line}`.length))
  const rows = hits.map((hit) => {
    const at = `${hit.file}:${hit.line}`.padEnd(width)
    const from =
      hit.routes.length > 0
        ? `   reached from ${hit.routes.join(", ")}`
        : ""
    return `  ${at}   ${hit.what}${from}`
  })
  return [
    `this app has ${reaches}, and adaptv apps have no server side`,
    ...rows,
    "Move this logic to your API and call it over the network, or into a route 'loader'.",
  ].join("\n")
}

/** A route id as the dev reads it: the root route reaches every page. */
const routeLabel = (id: string) => (id === "__root__" ? "every route" : id)

/** 1-based line of the first match in a file, or 1. */
function lineOf(file: string, pattern: RegExp): number {
  let code: string
  try {
    code = readFileSync(file, "utf8")
  } catch {
    return 1
  }
  const at = code.search(pattern)
  return at === -1 ? 1 : code.slice(0, at).split("\n").length
}

/** The line of the import in `file` that names the package `dependency` lives in. */
function importLineOf(file: string, dependency: string): number {
  const name = packageOf(
    withoutQuery(dependency)
      .split(/[/\\]node_modules[/\\]/)
      .pop()
      ?.replaceAll("\\", "/") ?? "",
  )
  try {
    const code = readFileSync(file, "utf8")
    const found = importsIn(code, file).find(
      ({ source }) => name !== null && packageOf(source) === name,
    )
    if (found) return code.slice(0, found.start).split("\n").length
  } catch {}
  return 1
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * The checks over one module graph, whichever environment it is (a build's, or the
 * dev server's): from a module the engine marked, up to the app's files, and from those
 * up to the routes that reach them.
 */
export function boundaryGraph(
  appRoot: string,
  importersOf: (id: string) => Iterable<string>,
) {
  const appDir = `${path.resolve(appRoot)}${path.sep}`
  const isApp = (id: string) =>
    id.startsWith(appDir) &&
    !id.includes(`${path.sep}node_modules${path.sep}`) &&
    /\.[mc]?[jt]sx?$/.test(withoutQuery(id))
  const relative = (file: string) =>
    path.relative(appRoot, file).split(path.sep).join("/")

  const routeIdsByFile = () => {
    const byFile = new Map<string, string>()
    for (const [id, route] of Object.entries(routesManifest()))
      if (route.filePath)
        byFile.set(path.resolve(appRoot, route.filePath), id)
    return byFile
  }

  /** The app modules a module is, or is imported by first, with the module below each. */
  const appFilesOf = (id: string) => {
    const found = new Map<string, string>()
    const stack: Array<[string, string]> = [[id, id]]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const [current, below] = stack.pop() as [string, string]
      if (seen.has(current)) continue
      seen.add(current)
      if (isApp(current)) {
        const file = withoutQuery(current)
        if (!found.has(file)) found.set(file, below)
        continue
      }
      for (const importer of importersOf(current))
        stack.push([importer, current])
    }
    return found
  }

  /** The routes whose files import `file`, directly or through other app modules. */
  const routesOf = (file: string) => {
    const byFile = routeIdsByFile()
    const routes = new Set<string>()
    const stack = [file]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const current = stack.pop() as string
      const plain = withoutQuery(current)
      if (seen.has(current)) continue
      seen.add(current)
      const route = byFile.get(plain)
      if (route !== undefined) {
        routes.add(routeLabel(route))
        continue
      }
      for (const importer of importersOf(current)) stack.push(importer)
      //the file without its query is the same file: a route's split chunk is
      //`route.tsx?tsr-split=…`, imported by `route.tsx`
      if (current !== plain) stack.push(plain)
    }
    return [...routes].sort()
  }

  return {
    isApp,

    /** One hit per server function the compiler stubbed in, or below, `marked`. */
    serverFunctions(
      marked: string,
      names: ReadonlyArray<string>,
    ): BoundaryHit[] {
      const hits: BoundaryHit[] = []
      for (const [file, below] of appFilesOf(marked)) {
        const routes = routesOf(file)
        //a stub in a package the app installs is reported at the app's import of it
        if (below !== marked || !isApp(marked)) {
          hits.push({
            file: relative(file),
            line: importLineOf(file, below),
            what: "server function",
            routes,
          })
          continue
        }
        for (const name of names.length > 0 ? names : [""])
          hits.push({
            file: relative(file),
            line: name
              ? lineOf(
                  file,
                  new RegExp(
                    `\\b(?:const|let|var|function)\\s+${escapeRe(name)}\\b`,
                  ),
                )
              : 1,
            what: name || "server function",
            routes,
          })
      }
      return hits
    },

    /** One hit per app file the server runtime is reached from. */
    serverRequest(runtimeModules: Iterable<string>): BoundaryHit[] {
      const files = new Map<string, string>()
      for (const id of runtimeModules)
        for (const [file, below] of appFilesOf(id))
          if (!files.has(file)) files.set(file, below)
      return [...files].map(([file, below]) => ({
        file: relative(file),
        line: importLineOf(file, below),
        what: "server request",
        routes: routesOf(file),
      }))
    },

    /** One hit per route the server's router gives a `server` option. */
    serverRoutes(router: {
      routesById?: Record<string, { options?: { server?: unknown } }>
    }): BoundaryHit[] {
      const manifest = routesManifest()
      return Object.entries(router.routesById ?? {})
        .filter(([, route]) => route.options?.server !== undefined)
        .map(([id]) => {
          const filePath = manifest[id]?.filePath
          const file = filePath ? path.resolve(appRoot, filePath) : null
          return {
            file: file ? relative(file) : id,
            line: file
              ? lineOf(file, /\bcreate(?:File|Root)Route\s*\(/)
              : 1,
            what: routeLabel(id),
            routes: [],
          }
        })
    },
  }
}

const kinded = (kind: BoundaryKind, hits: BoundaryHit[]) =>
  hits.map((hit) => ({ ...hit, kind }))

/** The server-function names a client stub declares, from the compiler's output. */
export function stubNames(code: string): string[] {
  const names: string[] = []
  for (const match of code.matchAll(
    /(?:const|let|var)\s+([\w$]+)\s*=[^;\n]*?\bcreateClientRpc\(/g,
  ))
    names.push(match[1] as string)
  return names
}

/**
 * Two plugins. The first is `enforce: "pre"`, because Vite's own resolver claims every
 * bare specifier before a plugin at normal order is asked, and the compiler's
 * `client-rpc` import is one (measured, §3.1). The second reads the stub at normal
 * order, after the compiler (`enforce: "pre"`) wrote it and, in dev, before Vite's import
 * analysis resolves its imports (a hook at `order: "post"` runs after that).
 *
 * - In `vite dev` a server function is refused at once, in the module that defines it,
 *   and a document request is refused while the server's router has a server route.
 * - In a build the client environment collects, and fails once at its end with every
 *   server function and server request read; the server environment, once written,
 *   fails with every server route.
 */
export function adaptvServerBoundaryPlugin(appRoot: string): Plugin[] {
  //the client environment's: Start's builder shares one plugin instance across all
  const marked = new Set<string>()
  const names = new Map<string, string[]>()

  const pre: Plugin = {
    name: `${PLUGIN}:pre`,
    enforce: "pre",

    buildStart() {
      if (this.environment.name === "client") marked.clear()
    },

    resolveId(source, importer) {
      if (
        this.environment.name !== "client" ||
        !importer ||
        importer.startsWith("\0") ||
        !CLIENT_RPC.test(source)
      )
        return null
      if (this.environment.mode !== "dev") {
        marked.add(importer)
        return null
      }
      const graph = this.environment.moduleGraph
      const report = boundaryGraph(appRoot, (id) =>
        [...(graph.getModuleById(id)?.importers ?? [])].flatMap((m) =>
          m.id ? [m.id] : [],
        ),
      ).serverFunctions(importer, names.get(importer) ?? [])
      if (report.length === 0) return null
      this.error({
        message: describeBoundary(kinded("server function", report)),
        id: importer,
      })
    },
  }

  return [
    pre,
    {
      name: PLUGIN,

      transform(code, id) {
        if (
          this.environment.name !== "client" ||
          !code.includes("createClientRpc(")
        )
          return null
        names.set(id, stubNames(code))
        return null
      },

      buildEnd(error) {
        if (error || this.environment.name !== "client") return
        const graph = boundaryGraph(appRoot, (id) => {
          const info = this.getModuleInfo(id)
          return [
            ...(info?.importers ?? []),
            ...(info?.dynamicImporters ?? []),
          ]
        })
        const hits = [
          ...kinded(
            "server function",
            [...marked].flatMap((id) =>
              graph.serverFunctions(id, names.get(id) ?? []),
            ),
          ),
          ...kinded(
            "server request",
            graph.serverRequest(
              [...this.getModuleIds()].filter((id) =>
                SERVER_RUNTIME.test(id),
              ),
            ),
          ),
        ]
        if (hits.length > 0) this.error(describeBoundary(hits))
      },

      //after the server environment is written: its router is what Start serves from
      async writeBundle(options, bundle) {
        if (this.environment.name !== "ssr" || !options.dir) return
        const chunk = Object.values(bundle).find(
          (out) =>
            out.type === "chunk" && out.exports.includes("getRouter"),
        )
        if (!chunk) return
        //a bundle built for another runtime may not load in Node: the build still
        //fails, but says why in adaptv's words, not the import's
        let router: Parameters<
          ReturnType<typeof boundaryGraph>["serverRoutes"]
        >[0]
        try {
          const { getRouter } = await import(
            pathToFileURL(path.join(options.dir, chunk.fileName)).href
          )
          router = await getRouter()
        } catch (error) {
          this.error(
            `could not load the server router to check for server routes: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        const hits = boundaryGraph(appRoot, () => []).serverRoutes(router)
        if (hits.length > 0)
          this.error(describeBoundary(kinded("server route", hits)))
      },

      configureServer(server) {
        const ssr = server.environments.ssr
        if (!ssr || !isRunnableDevEnvironment(ssr)) return
        let pending: Promise<string | null> | undefined
        //any edit may add or remove a server route; the next page asks again
        server.watcher.on("all", () => {
          pending = undefined
        })
        const check = async () => {
          const { getRouter } = await ssr.runner.import(ROUTER_ENTRY)
          const hits = boundaryGraph(appRoot, () => []).serverRoutes(
            await getRouter(),
          )
          return hits.length > 0
            ? describeBoundary(kinded("server route", hits))
            : null
        }
        server.middlewares.use(async (req, _res, next) => {
          if (!req.headers.accept?.includes("text/html")) return next()
          pending ??= check()
          let report: string | null
          try {
            report = await pending
          } catch {
            //the router failed to load: the page request reports that, in its own words
            pending = undefined
            return next()
          }
          if (report === null) return next()
          next(Object.assign(new Error(report), { plugin: PLUGIN }))
        })
      },
    },
  ]
}

// @vitest-environment node
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { Plugin } from "vite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { adaptvBanServerApisPlugin } from "#adaptv/vite/ban-server-apis.ts"
import { adaptvEngineImportsPlugin } from "#adaptv/vite/engine-imports.ts"
import { adaptvServerBoundaryPlugin } from "#adaptv/vite/server-boundary.ts"

/*
 * The server boundary's detection spike. → docs/design/server-boundary.md §3
 *
 * One fixture app, built by the pinned Start plugin, with a probe that records what
 * each detection candidate reports: the compiler's own set of server functions, the
 * reachability of the client RPC runtime, and server routes. Then each fixture route
 * is built alone, by Start, through the three rules that run in `adaptv()`
 * (`ban-server-apis.ts`, `engine-imports.ts`, `server-boundary.ts`), and its expected
 * verdict is a test. The dev server gets the same two refusals.
 *
 * Start is used directly, not through `adaptv()`: the question is what Start exposes
 * to a Vite plugin, and the full plugin needs an app config this fixture does not
 * have. Start's own `spa` prerender is off for the same reason (it needs a document
 * shell); the measurements below are taken during the compile, which runs either way.
 */

const fixture = fileURLToPath(new URL("./fixture-app", import.meta.url))
const repoModules = path.join(process.cwd(), "node_modules")

//a client and a server build per route, eleven of them, while the gate runs every
//other suite
const BUILD_TIMEOUT = 300_000

let appRoot: string
const roots: string[] = []
afterAll(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/**
 * The fixture copied out, with its dependencies linked the way a hoisting install would.
 * `routes` keeps only those route files beside the root route.
 */
function stageApp(routes?: (file: string) => boolean): string {
  const root = mkdtempSync(path.join(tmpdir(), "adaptv-server-boundary-"))
  roots.push(root)
  cpSync(fixture, root, { recursive: true })
  if (routes) {
    const dir = path.join(root, "src/routes")
    for (const file of readdirSync(dir))
      if (file !== "__root.tsx" && !routes(`routes/${file}`))
        rmSync(path.join(dir, file))
  }
  mkdirSync(path.join(root, "node_modules/@tanstack"), { recursive: true })
  const link = (name: string, target: string) =>
    symlinkSync(target, path.join(root, "node_modules", name), "dir")
  for (const name of [
    "react",
    "react-dom",
    "@tanstack/react-router",
    "@tanstack/react-start",
  ])
    link(name, realpathSync(path.join(repoModules, name)))
  //hoisted next to the app, as npm and Yarn put it (#292's case)
  link(
    "@tanstack/start-client-core",
    path.join(
      realpathSync(path.join(repoModules, "@tanstack/react-start")),
      "../start-client-core",
    ),
  )
  //a package, so it is installed rather than linked: `node_modules` is what makes
  //both of today's rules treat it as a dependency
  cpSync(
    path.join(root, "deps/adaptv"),
    path.join(root, "node_modules/adaptv"),
    { recursive: true },
  )
  return root
}

/** An app module's path from the app's `src/`, without a query. */
function appModule(id: string | null | undefined): string | null {
  if (!id || id.includes(`${path.sep}node_modules${path.sep}`)) return null
  const at = id.indexOf(`${appRoot}${path.sep}src${path.sep}`)
  if (at === -1) return null
  return id.slice(at + appRoot.length + 5).split("?")[0] as string
}

const SERVER_FN_FILES = [
  "fns/adaptv-subpath.ts",
  "fns/client-core.ts",
  "fns/local-reexport.ts",
]

/** What the probe saw, per candidate. */
const seen = {
  //candidate 1: app modules the compiler rewrote into an RPC stub, per environment
  clientStubs: new Set<string>(),
  ssrProviders: new Set<string>(),
  resolverManifest: "",
  //candidate 2: app modules importing the RPC entry the compiler inserts, and every
  //app module the RPC runtime is reachable from through any import chain
  rpcEntryImporters: new Set<string>(),
  rpcReachableFrom: new Set<string>(),
  //candidate 3: the route tree as the client environment loads it
  clientRouteTree: "",
  //§3.4: a middleware, as the client environment compiles it
  clientMiddleware: "",
}

function probe(): Plugin[] {
  return [
    {
      //ahead of Vite's resolver, which claims every bare specifier before a
      //plugin at normal order is asked
      name: "probe:pre",
      enforce: "pre",
      resolveId(source, importer) {
        const file = appModule(importer)
        if (!file) return null
        if (
          this.environment.name === "client" &&
          source === "@tanstack/react-start/client-rpc"
        )
          seen.rpcEntryImporters.add(file)
        if (
          this.environment.name === "ssr" &&
          source === "@tanstack/react-start/server-rpc"
        )
          seen.ssrProviders.add(file)
        return null
      },
    },
    {
      name: "probe:post",
      transform(code, id) {
        const env = this.environment.name
        const file = appModule(id)
        if (env === "client" && file && code.includes("createClientRpc("))
          seen.clientStubs.add(file)
        if (
          env === "ssr" &&
          id.includes("tanstack-start-server-fn-resolver")
        )
          seen.resolverManifest = code
        if (env === "client" && id.endsWith("routeTree.gen.ts"))
          seen.clientRouteTree = code
        if (env === "client" && file === "fns/middleware.ts")
          seen.clientMiddleware = code
        return null
      },
      buildEnd() {
        if (this.environment.name !== "client") return
        const stack = [...this.getModuleIds()].filter((id) =>
          /[/\\]client-rpc[/\\]/.test(id),
        )
        const visited = new Set<string>()
        while (stack.length > 0) {
          const id = stack.pop() as string
          if (visited.has(id)) continue
          visited.add(id)
          for (const importer of this.getModuleInfo(id)?.importers ?? []) {
            const file = appModule(importer)
            if (file) seen.rpcReachableFrom.add(file)
            else stack.push(importer)
          }
        }
      },
    },
  ]
}

let ssrServerRoutes: Record<string, boolean>
let clientBundle: string

//the request-API routes are measured on their own (§3.4): Start refuses one of
//them, and the other adds the server runtime to the graph candidate 2 walks
const REQUEST_ROUTES = [
  "routes/request-api.tsx",
  "routes/adaptv-request.tsx",
]

beforeAll(async () => {
  appRoot = stageApp((file) => !REQUEST_ROUTES.includes(file))
  const { createBuilder } = await import("vite")
  const { tanstackStart } = await import(
    "@tanstack/react-start/plugin/vite"
  )
  const builder = await createBuilder({
    root: appRoot,
    configFile: false,
    logLevel: "silent",
    plugins: [...probe(), tanstackStart()],
  })
  await builder.buildApp()

  //candidate 3 at runtime: the server build's router, as Start evaluates it per request
  const serverAssets = path.join(appRoot, "dist/server/assets")
  const routerChunk = readdirSync(serverAssets).find((f) =>
    f.startsWith("router-"),
  )
  const { getRouter } = await import(
    pathToFileURL(path.join(serverAssets, routerChunk as string)).href
  )
  const router = getRouter() as {
    routesById: Record<string, { options?: { server?: unknown } }>
  }
  ssrServerRoutes = Object.fromEntries(
    Object.entries(router.routesById).map(([id, route]) => [
      id,
      route.options?.server !== undefined,
    ]),
  )
  const clientAssets = path.join(appRoot, "dist/client/assets")
  clientBundle = readdirSync(clientAssets)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(path.join(clientAssets, f), "utf8"))
    .join("\n")
}, BUILD_TIMEOUT)

describe("candidate 1: the compiler's own set of server functions", () => {
  it("rewrites every server function in the client environment, however it was imported", () => {
    expect([...seen.clientStubs].sort()).toEqual(SERVER_FN_FILES)
  })

  it("lists all of them in the server-function resolver module", () => {
    for (const name of [
      "viaAdaptvSubpath",
      "viaClientCore",
      "viaLocalReexport",
    ])
      expect(seen.resolverManifest).toContain(`functionName: '${name}_`)
  })

  it("misses, in the server environment, a factory re-exported by an externalized package", () => {
    //`adaptv/server-fn` is external to the server build, so the compiler cannot read
    //its binding there; the resolver lists it only because the client environment
    //found it. The client environment is the one to read.
    expect([...seen.ssrProviders].sort()).toEqual([
      "fns/client-core.ts",
      "fns/local-reexport.ts",
    ])
  })
})

describe("§3.4: `createMiddleware`", () => {
  it("leaves no mark in the client: its server half is stripped and nothing is imported", () => {
    expect(seen.clientMiddleware).toContain("createMiddleware()")
    expect(seen.clientMiddleware).not.toContain(".server(")
    expect(seen.clientMiddleware).not.toMatch(/-rpc["']/)
    expect([...seen.rpcEntryImporters]).not.toContain("fns/middleware.ts")
  })
})

describe("candidate 2: reachability of the client RPC runtime", () => {
  it("is imported directly by exactly the modules the compiler rewrote", () => {
    expect([...seen.rpcEntryImporters].sort()).toEqual(SERVER_FN_FILES)
  })

  it("is reachable through the engine's own index too, so a transitive walk over-reports", () => {
    //`lib/server.ts` only re-exports the factory, and `fns/middleware.ts` only makes a
    //middleware; both reach the runtime through `start-client-core`'s index, which
    //imports the fetcher
    expect([...seen.rpcReachableFrom].sort()).toEqual(
      [...SERVER_FN_FILES, "fns/middleware.ts", "lib/server.ts"].sort(),
    )
  })
})

describe("candidate 3: server routes", () => {
  it("are pruned from the client route tree only when the options literal has `server` alone", () => {
    expect(seen.clientRouteTree).not.toContain("literal-server-route")
    expect(seen.clientRouteTree).toContain("indirect-server-route")
    expect(seen.clientRouteTree).toContain("imported-server-route")
    expect(seen.clientRouteTree).toContain("spread-server-route")
  })

  it("keep their handlers in the client bundle when the options come from another module", () => {
    //the client code-splitter deletes `server` from a literal or a same-file `const`,
    //and leaves an imported object alone
    expect(clientBundle).toContain("from the server, imported")
  })

  it("map to their files through the routes manifest Start leaves on `globalThis`", () => {
    const manifest = (
      globalThis as {
        TSS_ROUTES_MANIFEST?: Record<string, { filePath?: string }>
      }
    ).TSS_ROUTES_MANIFEST
    expect(manifest?.["/imported-server-route"]?.filePath).toMatch(
      /routes[/\\]imported-server-route\.tsx$/,
    )
  })

  it("all carry `options.server` on the server build's router, and nothing else does", () => {
    expect(ssrServerRoutes).toEqual({
      __root__: false,
      "/": false,
      "/adaptv-subpath": false,
      "/client-core": false,
      "/local-reexport": false,
      "/middleware": false,
      "/literal-server-route": true,
      "/indirect-server-route": true,
      "/imported-server-route": true,
      "/spread-server-route": true,
    })
  })
})

/** Start alone, on the fixture with one route: what it does by itself. */
async function startAlone(route: string): Promise<{
  error: string | null
  clientModules: string[]
}> {
  const root = stageApp((file) => file === route)
  const clientModules: string[] = []
  const { createBuilder } = await import("vite")
  const { tanstackStart } = await import(
    "@tanstack/react-start/plugin/vite"
  )
  const builder = await createBuilder({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "probe:graph",
        buildEnd() {
          if (this.environment.name === "client")
            clientModules.push(...this.getModuleIds())
        },
      },
      tanstackStart(),
    ],
  })
  try {
    await builder.buildApp()
    return { error: null, clientModules }
  } catch (error) {
    return { error: String((error as Error).message), clientModules }
  }
}

let requestApi: Awaited<ReturnType<typeof startAlone>>
let adaptvRequest: Awaited<ReturnType<typeof startAlone>>

beforeAll(async () => {
  requestApi = await startAlone("routes/request-api.tsx")
  adaptvRequest = await startAlone("routes/adaptv-request.tsx")
}, BUILD_TIMEOUT)

describe("§3.4: the server's request (`getRequest`, cookies)", () => {
  it("is refused by Start itself in the client environment, by the specifier", () => {
    expect(requestApi.error).toMatch(/Import denied in client environment/)
  })

  it("builds clean through a package that re-exports it, and ships the server runtime to the client", () => {
    expect(adaptvRequest.error).toBeNull()
    expect(
      adaptvRequest.clientModules.some((id) =>
        /[/\\]start-server-core[/\\]/.test(id),
      ),
    ).toBe(true)
  })
})

/*
 * The rules, per fixture. Each fixture route is built alone, by Start, through the
 * three rules `adaptv()` runs (the specifier ban, the engine-import rule and the server
 * boundary), so a refusal is theirs and a pass went through the server build too.
 */

const RULE_TEXT =
  /server-only and cannot|missing from the app's package\.json|adaptv apps have no server side/

type Verdict = { refused: string | null; other: string | null }

/** The server boundary's report, out of the bundler's frame and stack around it. */
function report(message: string | null): string | null {
  if (message === null) return null
  const lines = message.split("\n").filter((line) => !/^\s+at /.test(line))
  const start = lines.findIndex((line) => line.includes("this app has"))
  if (start === -1) return message
  const end = lines.findIndex(
    (line, i) => i > start && line.startsWith("Move "),
  )
  return [
    (lines[start] as string).slice(
      (lines[start] as string).indexOf("this app has"),
    ),
    ...lines.slice(start + 1, end + 1),
  ].join("\n")
}

async function verdict(
  route: string,
  declares: string[] = [],
): Promise<Verdict> {
  const root = stageApp((file) => file === route)
  if (declares.length > 0) {
    const pkgPath = path.join(root, "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
    for (const name of declares) pkg.dependencies[name] = "*"
    writeFileSync(pkgPath, JSON.stringify(pkg))
  }
  const { createBuilder } = await import("vite")
  const { tanstackStart } = await import(
    "@tanstack/react-start/plugin/vite"
  )
  try {
    const builder = await createBuilder({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [
        adaptvBanServerApisPlugin(),
        adaptvEngineImportsPlugin(root),
        ...adaptvServerBoundaryPlugin(root),
        tanstackStart(),
      ],
    })
    await builder.buildApp()
    return { refused: null, other: null }
  } catch (error) {
    const message = String((error as Error).message)
    return RULE_TEXT.test(message)
      ? { refused: message, other: null }
      : { refused: null, other: message }
  }
}

const CASES = {
  control: ["routes/index.tsx"],
  adaptvSubpath: ["routes/adaptv-subpath.tsx"],
  clientCore: ["routes/client-core.tsx"],
  clientCoreDeclared: [
    "routes/client-core.tsx",
    ["@tanstack/start-client-core"],
  ],
  localReexport: ["routes/local-reexport.tsx"],
  middleware: ["routes/middleware.tsx"],
  requestApi: ["routes/request-api.tsx"],
  adaptvRequest: ["routes/adaptv-request.tsx"],
  literalServerRoute: ["routes/literal-server-route.tsx"],
  indirectServerRoute: ["routes/indirect-server-route.tsx"],
  spreadServerRoute: ["routes/spread-server-route.tsx"],
  importedServerRoute: ["routes/imported-server-route.tsx"],
} as const satisfies Record<string, readonly [string, string[]?]>

const rules = {} as Record<keyof typeof CASES, Verdict>

beforeAll(async () => {
  for (const [name, [route, declares]] of Object.entries(CASES))
    rules[name as keyof typeof CASES] = await verdict(route, [
      ...(declares ?? []),
    ])
}, BUILD_TIMEOUT)

describe("the rules, per fixture (expected: refused, except the control)", () => {
  it("fail no fixture for a reason of their own, so every verdict below is the rules'", () => {
    for (const [name, v] of Object.entries(rules))
      expect(v.other, name).toBeNull()
  })

  it("allow the control, a loader returning a field named `server`, through the client and the server build", () => {
    expect(rules.control.refused).toBeNull()
  })

  it("refuse `createServerFn` from an adaptv subpath: the compiler stubbed it, wherever the factory came from", () => {
    expect(report(rules.adaptvSubpath.refused)).toBe(
      [
        "this app has 1 server function, and adaptv apps have no server side",
        "  src/fns/adaptv-subpath.ts:3   viaAdaptvSubpath   reached from /adaptv-subpath",
        "Move this logic to your API and call it over the network, or into a route 'loader'.",
      ].join("\n"),
    )
  })

  it("refuse `createServerFn` from `@tanstack/start-client-core` when the app does not list it (the ban's package family, ahead of the engine-import rule)", () => {
    expect(rules.clientCore.refused).toMatch(
      /"@tanstack\/start-client-core" is server-only and cannot/,
    )
  })

  it("refuse `createServerFn` from `@tanstack/start-client-core` when the app lists it (the ban's package family)", () => {
    expect(rules.clientCoreDeclared.refused).toMatch(
      /"@tanstack\/start-client-core" is server-only and cannot/,
    )
  })

  it("refuse `createServerFn` through a local re-export (the re-exporting file imports the banned root)", () => {
    expect(rules.localReexport.refused).toMatch(/server-only and cannot/)
  })

  it("refuse `createMiddleware` imported from the banned root (the ban)", () => {
    expect(rules.middleware.refused).toMatch(/server-only and cannot/)
  })

  it("refuse the server's request imported from the banned subpath (the ban, ahead of Start's own refusal)", () => {
    expect(rules.requestApi.refused).toMatch(
      /"@tanstack\/react-start\/server" is server-only and cannot/,
    )
  })

  it("refuse the server's request through a package that re-exports it: the server runtime is in the client graph", () => {
    expect(report(rules.adaptvRequest.refused)).toBe(
      [
        "this app has 1 server request read, and adaptv apps have no server side",
        "  src/fns/adaptv-request.ts:1   server request   reached from /adaptv-request",
        "Move this logic to your API and call it over the network, or into a route 'loader'.",
      ].join("\n"),
    )
  })

  for (const [name, file, line] of [
    ["literalServerRoute", "literal-server-route", 4],
    ["indirectServerRoute", "indirect-server-route", 12],
    ["spreadServerRoute", "spread-server-route", 16],
    ["importedServerRoute", "imported-server-route", 5],
  ] as const)
    it(`refuse a server route from the server build's router: ${file}`, () => {
      expect(report(rules[name].refused)).toBe(
        [
          "this app has 1 server route, and adaptv apps have no server side",
          `  src/routes/${file}.tsx:${line}   /${file}`,
          "Move this logic to your API and call it over the network, or into a route 'loader'.",
        ].join("\n"),
      )
    })
})

/*
 * The dev server: a server function is refused when its module is requested, and a page
 * while the server's router has a server route.
 */

async function devServer(routes: (file: string) => boolean) {
  const root = stageApp(routes)
  const { createServer } = await import("vite")
  const { tanstackStart } = await import(
    "@tanstack/react-start/plugin/vite"
  )
  const server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1", ws: false },
    //no dependency scan: its rerun after a new import would make the request wait
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [...adaptvServerBoundaryPlugin(root), tanstackStart()],
  })
  await server.listen()
  return server
}

describe("in `vite dev`", () => {
  it(
    "refuses a server function in the module that defines it, with the route that loaded it",
    async () => {
      const server = await devServer(
        (file) => file === "routes/adaptv-subpath.tsx",
      )
      try {
        const client = server.environments.client
        await client.transformRequest("/src/routes/adaptv-subpath.tsx")
        await expect(
          client.transformRequest("/src/fns/adaptv-subpath.ts"),
        ).rejects.toThrow(
          /src\/fns\/adaptv-subpath\.ts:3 {3}viaAdaptvSubpath {3}reached from \/adaptv-subpath/,
        )
      } finally {
        await server.close()
      }
    },
    BUILD_TIMEOUT,
  )

  it(
    "refuses a page while the server's router has a server route, and serves one when it has none",
    async () => {
      for (const [route, refused] of [
        ["routes/imported-server-route.tsx", true],
        ["routes/index.tsx", false],
      ] as const) {
        const server = await devServer((file) => file === route)
        try {
          const address = server.httpServer?.address()
          const port =
            typeof address === "object" && address ? address.port : 0
          const response = await fetch(`http://127.0.0.1:${port}/`, {
            headers: { accept: "text/html" },
          })
          const body = await response.text()
          expect(
            body.includes("adaptv apps have no server side"),
            route,
          ).toBe(refused)
          if (refused) {
            expect(response.status).toBe(500)
            expect(body).toContain(
              "src/routes/imported-server-route.tsx:5",
            )
          }
        } finally {
          await server.close()
        }
      }
    },
    BUILD_TIMEOUT,
  )
})

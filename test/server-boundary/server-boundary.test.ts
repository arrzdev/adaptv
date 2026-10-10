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

/*
 * The server boundary's detection spike. → docs/roadmap/server-boundary.md §3
 *
 * One fixture app, built by the pinned Start plugin, with a probe that records what
 * each detection candidate reports: the compiler's own set of server functions, the
 * reachability of the client RPC runtime, and server routes. Then each fixture file
 * goes through the two rules that run today (`ban-server-apis.ts` and
 * `engine-imports.ts`), and its expected verdict is a test: `it` where today's rules
 * refuse it, `it.fails` with the reason where they do not. When the detection ships,
 * each `it.fails` becomes an `it`.
 *
 * Start is used directly, not through `adaptv()`: the question is what Start exposes
 * to a Vite plugin, and the full plugin needs an app config this fixture does not
 * have. Start's own `spa` prerender is off for the same reason (it needs a document
 * shell); the measurements below are taken during the compile, which runs either way.
 */

const fixture = fileURLToPath(new URL("./fixture-app", import.meta.url))
const repoModules = path.join(process.cwd(), "node_modules")

//a client and a server build of eight routes, while the gate runs every other suite
const BUILD_TIMEOUT = 180_000

let appRoot: string
const roots: string[] = []
afterAll(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/** The fixture copied out, with its dependencies linked the way a hoisting install would. */
function stageApp(): string {
  const root = mkdtempSync(path.join(tmpdir(), "adaptv-server-boundary-"))
  roots.push(root)
  cpSync(fixture, root, { recursive: true })
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

beforeAll(async () => {
  appRoot = stageApp()
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

describe("candidate 2: reachability of the client RPC runtime", () => {
  it("is imported directly by exactly the modules the compiler rewrote", () => {
    expect([...seen.rpcEntryImporters].sort()).toEqual(SERVER_FN_FILES)
  })

  it("is reachable through the engine's own index too, so a transitive walk over-reports", () => {
    //`lib/server.ts` only re-exports the factory; it reaches the runtime through
    //`start-client-core`'s index, which imports the fetcher
    expect([...seen.rpcReachableFrom].sort()).toEqual(
      [...SERVER_FN_FILES, "lib/server.ts"].sort(),
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
      "/literal-server-route": true,
      "/indirect-server-route": true,
      "/imported-server-route": true,
      "/spread-server-route": true,
    })
  })
})

/*
 * Today's coverage. Each fixture file is the entry of a plain client build with the
 * two rules that run today and nothing else, so a refusal is theirs.
 */

const RULE_TEXT =
  /server-only and cannot|missing from the app's package\.json/

type Verdict = { refused: string | null; other: string | null }

async function todaysVerdict(
  entry: string,
  declares: string[] = [],
): Promise<Verdict> {
  const root = stageApp()
  if (declares.length > 0) {
    const pkgPath = path.join(root, "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
    for (const name of declares) pkg.dependencies[name] = "*"
    writeFileSync(pkgPath, JSON.stringify(pkg))
  }
  const { build } = await import("vite")
  try {
    await build({
      root,
      configFile: false,
      logLevel: "silent",
      plugins: [
        adaptvBanServerApisPlugin(),
        adaptvEngineImportsPlugin(root),
      ],
      build: {
        write: false,
        rollupOptions: { input: path.join(root, "src", entry) },
      },
    })
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
  literalServerRoute: ["routes/literal-server-route.tsx"],
  indirectServerRoute: ["routes/indirect-server-route.tsx"],
  spreadServerRoute: ["routes/spread-server-route.tsx"],
  importedServerRoute: ["routes/imported-server-route.tsx"],
} as const satisfies Record<string, readonly [string, string[]?]>

const today = {} as Record<keyof typeof CASES, Verdict>

beforeAll(async () => {
  for (const [name, [entry, declares]] of Object.entries(CASES))
    today[name as keyof typeof CASES] = await todaysVerdict(entry, [
      ...(declares ?? []),
    ])
}, BUILD_TIMEOUT)

describe("today's rules, per fixture (expected: refused, except the control)", () => {
  it("fail no fixture for a reason of their own, so every verdict below is the rules'", () => {
    for (const verdict of Object.values(today))
      expect(verdict.other).toBeNull()
  })

  it("allow the control, a loader returning a field named `server`", () => {
    expect(today.control.refused).toBeNull()
  })

  it.fails(
    "refuse `createServerFn` from an adaptv subpath — they do not: the specifier is adaptv's own, and the re-export lives in `node_modules`, which both rules exempt",
    () => {
      expect(today.adaptvSubpath.refused).not.toBeNull()
    },
  )

  it("refuse `createServerFn` from `@tanstack/start-client-core` when the app does not list it (the engine-import rule)", () => {
    expect(today.clientCore.refused).toMatch(
      /missing from the app's package\.json/,
    )
  })

  it.fails(
    "refuse `createServerFn` from `@tanstack/start-client-core` when the app lists it — they do not: the ban names `@tanstack/react-start` and `/server` only (#292)",
    () => {
      expect(today.clientCoreDeclared.refused).not.toBeNull()
    },
  )

  it("refuse `createServerFn` through a local re-export (the re-exporting file imports the banned root)", () => {
    expect(today.localReexport.refused).toMatch(/server-only and cannot/)
  })

  it("refuse a server route whose options literal names `server`", () => {
    expect(today.literalServerRoute.refused).toMatch(
      /server-only and cannot/,
    )
  })

  it("refuse a server route whose options are a same-file `const` — by accident: the scan reads the first object literal after `createFileRoute`, which here is the options", () => {
    expect(today.indirectServerRoute.refused).toMatch(
      /server-only and cannot/,
    )
  })

  it.fails(
    "refuse a server route whose options are a same-file `const` behind another object literal — they do not: the scan stops at the first object literal, which has no `server` key",
    () => {
      expect(today.spreadServerRoute.refused).not.toBeNull()
    },
  )

  it.fails(
    "refuse a server route whose options are imported — they do not: the scan reads only the call's own object literal",
    () => {
      expect(today.importedServerRoute.refused).not.toBeNull()
    },
  )
})

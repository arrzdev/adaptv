// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import type { Server } from "node:http"
import { createServer as createHttpServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Logger, ViteDevServer } from "vite"
import { createServer } from "vite"
import { afterEach, describe, expect, it } from "vitest"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import {
  adaptvSwDevPlugin,
  DEV_SW_ENV,
  devServiceWorkerEnabled,
} from "#adaptv/vite/sw-dev.ts"
import { adaptvPwaRegisterPlugin } from "#adaptv/vite/virtuals.ts"

const original = process.env[DEV_SW_ENV]
const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  if (original === undefined) delete process.env[DEV_SW_ENV]
  else process.env[DEV_SW_ENV] = original
})

/** Load the register virtual module the way Vite would. */
function loadRegister(
  swEnabled: boolean,
  devSw: boolean,
  policy: "auto" | "prompt" = "auto",
): string {
  const plugin = adaptvPwaRegisterPlugin(swEnabled, devSw, policy)
  const load = plugin.load as (id: string) => string | null
  const id = "\0virtual:adaptv/pwa-register"
  const source = load.call({} as never, id)
  if (!source) throw new Error("virtual module did not load")
  return source
}

describe("devServiceWorkerEnabled", () => {
  it("is OFF unless the env var is deliberately set", () => {
    delete process.env[DEV_SW_ENV]
    expect(devServiceWorkerEnabled()).toBe(false)
  })

  it("treats an empty value and '0' as off, not as 'set'", () => {
    //`ADAPTV_DEV_SW=` in a .env file is how someone turns it OFF again; reading
    //it as truthy would leave dev serving a worker they thought they disabled.
    process.env[DEV_SW_ENV] = ""
    expect(devServiceWorkerEnabled()).toBe(false)
    process.env[DEV_SW_ENV] = "0"
    expect(devServiceWorkerEnabled()).toBe(false)
  })

  it("is on for any other value", () => {
    process.env[DEV_SW_ENV] = "1"
    expect(devServiceWorkerEnabled()).toBe(true)
  })
})

describe("the register module carries the dev decision", () => {
  it("ships DEV_SW_ENABLED=false by default, so dev stays SW-free", () => {
    //The shell branches on this to decide whether dev DESTROYS workers or
    //registers one. Defaulting it wrong means every dev session gets a worker.
    expect(loadRegister(true, false)).toContain(
      "export const DEV_SW_ENABLED = false",
    )
  })

  it("ships DEV_SW_ENABLED=true when the hatch is armed", () => {
    expect(loadRegister(true, true)).toContain(
      "export const DEV_SW_ENABLED = true",
    )
  })

  it("still exports registerSW on the native stub, armed or not", () => {
    //the shell imports both bindings unconditionally — a missing export is a
    //build error in the consumer's app, not in adaptv
    for (const dev of [false, true]) {
      const source = loadRegister(false, dev)
      expect(source).toContain("export function registerSW()")
      expect(source).toContain("export const DEV_SW_ENABLED")
    }
  })
})

describe("serviceWorkerUpdate is baked into the registration", () => {
  it("bakes the policy as a literal, never leaving the placeholder in", () => {
    //`__ADAPTV_SW_PROMPT__` surviving into the browser is a ReferenceError on the
    //first line of registration — no worker at all, on every page load.
    for (const policy of ["auto", "prompt"] as const) {
      const source = loadRegister(true, false, policy)
      expect(source).not.toContain("__ADAPTV_SW_PROMPT__")
      expect(source).toContain(`const PROMPT = ${policy === "prompt"}`)
    }
  })

  it("defaults to auto — the invisible cold-launch update", () => {
    expect(loadRegister(true, false)).toContain("const PROMPT = false")
  })

  it("only the prompt build hands the app a way to hold the update", () => {
    //Under `auto` there must be no callback path at all: an app calling
    //`useServiceWorkerUpdate()` should see `false` forever, not a banner it
    //cannot dismiss because the worker already activated underneath it.
    expect(loadRegister(true, false, "prompt")).toContain("onWaiting?.(")
    expect(loadRegister(true, false, "prompt")).toContain("updatefound")
  })
})

/*
 * The dev worker route, served by a real Vite dev server over real HTTP.
 * → `docs/design/rendering.md` §3 ("Dev is SW-free, and `ADAPTV_DEV_SW=1` is the
 * one way past it")
 *
 * The browser is the consumer here: it fetches `/sw.js`, evaluates what comes back
 * as a worker script, and registers or fails on the status. So the contract is
 * the response — status, headers and the bundled source — not which hooks ran.
 */

//a Vite server and an esbuild bundle per test; generous because the gate runs
//every suite in parallel
const SERVE_TIMEOUT = 30_000

function tempApp(files: Record<string, string>): string {
  const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-sw-dev-"))
  cleanups.push(() => rmSync(appRoot, { recursive: true, force: true }))
  for (const [rel, contents] of Object.entries(files)) {
    const file = path.join(appRoot, rel)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, contents)
  }
  return appRoot
}

function contextFor(
  appRoot: string,
  serviceWorkers: string[] | undefined,
): AdaptvContext {
  return {
    appRoot,
    target: "web",
    loaded: { config: { serviceWorkers } as never, watchFiles: [] },
  }
}

type Served = {
  get: (url: string) => Promise<Response>
  warnings: string[]
}

/** A dev server with only the sw-dev plugin, listening on an ephemeral port. */
async function serve(context: AdaptvContext): Promise<Served> {
  const warnings: string[] = []
  const logger: Logger = {
    info() {},
    warn: (msg) => void warnings.push(msg),
    warnOnce: (msg) => void warnings.push(msg),
    error() {},
    clearScreen() {},
    hasErrorLogged: () => false,
    hasWarned: false,
  }
  const vite: ViteDevServer = await createServer({
    configFile: false,
    root: context.appRoot,
    appType: "custom",
    customLogger: logger,
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    plugins: [adaptvSwDevPlugin(context)],
  })
  cleanups.push(() => vite.close())
  const http: Server = createHttpServer(vite.middlewares)
  await new Promise<void>((resolve) =>
    http.listen(0, "127.0.0.1", resolve),
  )
  cleanups.push(
    () => new Promise<void>((resolve) => http.close(() => resolve())),
  )
  const { port } = http.address() as AddressInfo
  return {
    get: (url) => fetch(`http://127.0.0.1:${port}${url}`),
    warnings,
  }
}

describe("the dev worker route", () => {
  it(
    "serves nothing at /sw.js unless the hatch is armed",
    async () => {
      //Dev is SW-free by default. A dev server that answered /sw.js anyway would
      //hand the shell a worker that serves a stale bundle into the next session.
      delete process.env[DEV_SW_ENV]
      const appRoot = tempApp({
        "src/sw/push.ts": "self.__probe = 'push'",
      })
      const { get, warnings } = await serve(
        contextFor(appRoot, ["./src/sw/push.ts"]),
      )
      const response = await get("/sw.js")
      expect(response.status).toBe(404)
      expect(await response.text()).not.toContain("__probe")
      expect(warnings).toEqual([])
    },
    SERVE_TIMEOUT,
  )

  it(
    "serves the app's modules as one uncached, self-activating classic script",
    async () => {
      process.env[DEV_SW_ENV] = "1"
      const appRoot = tempApp({
        "src/sw/push.ts":
          "import { tag } from './tag'\nconst kind: string = 'push'\n;(self as any).__push = tag + kind",
        "src/sw/tag.ts": "export const tag = 'app:'",
        "src/sw/sync.ts": "(self as any).__sync = 'sync'",
      })
      const { get } = await serve(
        contextFor(appRoot, ["./src/sw/push.ts", "./src/sw/sync.ts"]),
      )
      const response = await get("/sw.js")
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("text/javascript")
      //an edit must be one reload away, never parked in the HTTP cache
      expect(response.headers.get("cache-control")).toBe("no-store")
      const source = await response.text()
      //every listed module, TypeScript stripped and its own imports bundled in:
      //a worker script cannot resolve a bare `./tag` against the dev server
      expect(source).toContain("__push")
      expect(source).toContain("app:")
      expect(source).toContain("__sync")
      expect(source).not.toContain(": string")
      expect(source).not.toMatch(/^\s*import\s/m)
      //it takes over on the spot instead of waiting for the next launch
      expect(source).toContain("skipWaiting()")
      expect(source).toContain("clients.claim()")
      //and it evaluates as a classic worker script with the modules' effects
      const scope: Record<string, unknown> = { addEventListener() {} }
      new Function("self", source)(scope)
      expect(scope.__push).toBe("app:push")
      expect(scope.__sync).toBe("sync")
    },
    SERVE_TIMEOUT,
  )

  it(
    "answers the registration URL with a query string, and nothing else",
    async () => {
      process.env[DEV_SW_ENV] = "1"
      const appRoot = tempApp({
        "src/sw/push.ts": "self.__probe = 'push'",
      })
      const { get } = await serve(
        contextFor(appRoot, ["./src/sw/push.ts"]),
      )
      const withQuery = await get("/sw.js?v=2")
      expect(withQuery.status).toBe(200)
      expect(await withQuery.text()).toContain("__probe")
      //any other path falls through to Vite
      const other = await get("/sw.jsx")
      expect(other.headers.get("cache-control")).not.toBe("no-store")
      expect(await other.text()).not.toContain("__probe")
    },
    SERVE_TIMEOUT,
  )

  it(
    "rebundles per request, so an edit to a module shows up on the next fetch",
    async () => {
      process.env[DEV_SW_ENV] = "1"
      const appRoot = tempApp({
        "src/sw/push.ts": "self.__probe = 'first'",
      })
      const { get } = await serve(
        contextFor(appRoot, ["./src/sw/push.ts"]),
      )
      expect(await (await get("/sw.js")).text()).toContain("first")
      writeFileSync(
        path.join(appRoot, "src/sw/push.ts"),
        "self.__probe = 'second'",
      )
      const again = await (await get("/sw.js")).text()
      expect(again).toContain("second")
      expect(again).not.toContain("first")
    },
    SERVE_TIMEOUT,
  )

  it(
    "keeps a module whose package declares `sideEffects: false`",
    async () => {
      //A worker module is nothing BUT side effects, and a bare import is all the
      //bundle holds. Honouring the package's `sideEffects: false` would let the
      //bundler drop every import and serve a worker that does nothing, silently.
      process.env[DEV_SW_ENV] = "1"
      const appRoot = tempApp({
        "package.json": JSON.stringify({
          name: "app",
          sideEffects: false,
        }),
        "src/sw/push.ts": "self.__probe = 'push'",
      })
      const { get } = await serve(
        contextFor(appRoot, ["./src/sw/push.ts"]),
      )
      const response = await get("/sw.js")
      expect(response.status).toBe(200)
      expect(await response.text()).toContain("__probe")
    },
    SERVE_TIMEOUT,
  )

  it(
    "answers a missing module with a 500 naming it, and the server stays up",
    async () => {
      //A broken app worker must not take the dev server down: registration
      //fails, the page still loads, and the reason is in the network tab.
      process.env[DEV_SW_ENV] = "1"
      const appRoot = tempApp({
        "src/sw/push.ts": "self.__probe = 'push'",
      })
      const { get } = await serve(
        contextFor(appRoot, ["./src/sw/gone.ts"]),
      )
      const response = await get("/sw.js")
      expect(response.status).toBe(500)
      expect(response.headers.get("content-type")).toBe("text/javascript")
      const body = await response.text()
      expect(body).toContain("adaptv dev worker failed to build")
      expect(body).toContain(
        'serviceWorkers: \\"./src/sw/gone.ts\\" does not exist',
      )
      //the body is itself a script that runs and reports, not a syntax error
      const errors: unknown[] = []
      new Function("console", body)({
        error: (m: unknown) => errors.push(m),
      })
      expect(String(errors[0])).toContain("./src/sw/gone.ts")
      //and the next request is still answered
      expect((await get("/sw.js")).status).toBe(500)
    },
    SERVE_TIMEOUT,
  )

  it(
    "answers a module that does not compile with a 500 carrying the error",
    async () => {
      process.env[DEV_SW_ENV] = "1"
      const appRoot = tempApp({ "src/sw/push.ts": "self.__probe = (" })
      const { get } = await serve(
        contextFor(appRoot, ["./src/sw/push.ts"]),
      )
      const response = await get("/sw.js")
      expect(response.status).toBe(500)
      const body = await response.text()
      expect(body).toContain("console.error(")
      expect(body).toContain("push.ts")
    },
    SERVE_TIMEOUT,
  )

  for (const [label, modules] of [
    ["empty", []],
    ["absent", undefined],
  ] as const) {
    it(
      `says so when the hatch is armed but \`serviceWorkers\` is ${label}`,
      async () => {
        //the dev deliberately set the flag; a silent 404 would read as the flag
        //not working, when the thing that is empty is the config
        process.env[DEV_SW_ENV] = "1"
        const appRoot = tempApp({})
        const { get, warnings } = await serve(
          contextFor(appRoot, modules as string[] | undefined),
        )
        expect(warnings).toHaveLength(1)
        expect(warnings[0]).toContain(DEV_SW_ENV)
        expect(warnings[0]).toContain("serviceWorkers: []")
        expect((await get("/sw.js")).status).toBe(404)
      },
      SERVE_TIMEOUT,
    )
  }

  it("is a dev-server plugin only, never part of a build", () => {
    //the built worker is sw-build's; a build that also carried this would have
    //nothing to serve it from
    const plugin = adaptvSwDevPlugin(contextFor("/app", ["./sw.ts"]))
    expect(plugin.apply).toBe("serve")
  })
})

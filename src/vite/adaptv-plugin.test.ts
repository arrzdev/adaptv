// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import type { ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import type {
  Connect,
  Plugin,
  PluginOption,
  ResolvedConfig,
  ViteDevServer,
} from "vite"
import { afterEach, describe, expect, it, vi } from "vitest"
import { adaptv } from "#adaptv/vite/adaptv-plugin.ts"

/*
 * What `adaptv()` decides before any hook runs: which lineage the build is, what
 * it hands the route/SSR engine, and the three small plugins it defines inline.
 * `static-host.test.ts` covers the lineage-specific emitters; this file covers
 * the factory's own choices, each of which fails silently when it is wrong — a
 * client entry nothing hydrates, a route tree nobody imports, a dev server that
 * keeps serving the config it started with.
 */

//The engine's own factory, unchanged, with its arguments recorded: the options
//adaptv passes are the contract under test, and they are not observable from
//the plugin objects the engine returns.
vi.mock("@tanstack/react-start/plugin/vite", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@tanstack/react-start/plugin/vite")
    >()
  return { ...real, tanstackStart: vi.fn(real.tanstackStart) }
})

type StartOptions = {
  spa?: { enabled: boolean }
  client: { entry: string }
  server?: { entry: string }
  router: Record<string, unknown> & { entry?: string }
}

//The factory writes these for the route generator, and two more steer it. Every
//test restores them, so no suite later in the worker inherits a temp dir's paths.
const ENV_KEYS = [
  "ADAPTV_ROUTER_PKG",
  "ADAPTV_START_PKG",
  "TSR_TMP_DIR",
  "ADAPTV_ROOT_ROUTE_FILE",
  "ADAPTV_TARGET",
  "ADAPTV_DEV_NATIVE",
]
const savedEnv = ENV_KEYS.map((key) => [key, process.env[key]] as const)

const roots: string[] = []
afterEach(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
  vi.mocked(tanstackStart).mockClear()
  vi.restoreAllMocks()
})

/** A throwaway app whose `adaptv.config.ts` is `config` over a minimal valid one. */
function app(config: Record<string, unknown> = {}, files: string[] = []) {
  const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-plugin-"))
  roots.push(appRoot)
  writeConfig(appRoot, config)
  for (const file of files) {
    mkdirSync(path.dirname(path.join(appRoot, file)), { recursive: true })
    writeFileSync(path.join(appRoot, file), "export {}\n")
  }
  return appRoot
}

function writeConfig(appRoot: string, config: Record<string, unknown>) {
  const full = {
    name: "Probe",
    description: "fixture",
    themeColor: { light: "#ffffff", dark: "#000000" },
    styles: "./src/styles/main.css",
    router: {},
    render: "spa",
    ...config,
  }
  writeFileSync(
    path.join(appRoot, "adaptv.config.ts"),
    `export default ${JSON.stringify(full)}\n`,
  )
}

async function plugins(
  appRoot: string,
  options: Parameters<typeof adaptv>[0] = {},
): Promise<Plugin[]> {
  return flatten(await adaptv({ appRoot, ...options }))
}

function flatten(options: PluginOption[]): Plugin[] {
  const out: Plugin[] = []
  for (const option of options) {
    if (!option) continue
    if (Array.isArray(option)) out.push(...flatten(option))
    else if (typeof option === "object" && "name" in option)
      out.push(option as Plugin)
  }
  return out
}

function named(list: Plugin[], name: string): Plugin {
  const plugin = list.find((p) => p.name === name)
  if (!plugin) throw new Error(`no plugin named ${name}`)
  return plugin
}

/** The options the last `adaptv()` call handed the engine. */
function startOptions(): StartOptions {
  const calls = vi.mocked(tanstackStart).mock.calls
  expect(calls).toHaveLength(1)
  return calls[0][0] as unknown as StartOptions
}

/** A Start entry is resolved against `<appRoot>/src`; where does it land? */
const fromSrc = (appRoot: string, entry: string) =>
  path.resolve(appRoot, "src", entry)

const PACKAGE_SRC = path.resolve(import.meta.dirname, "..")

describe("adaptv() — what the route/SSR engine is configured with", () => {
  it("points an un-ejected app at adaptv's own entries and its generated tree", async () => {
    const appRoot = app()
    await plugins(appRoot)
    const options = startOptions()

    expect(options.spa).toEqual({ enabled: true })
    //both entries are package modules, reached by a path relative to the app's src/
    expect(fromSrc(appRoot, options.client.entry)).toBe(
      path.join(PACKAGE_SRC, "routes/client-entry.tsx"),
    )
    expect(fromSrc(appRoot, options.router.entry as string)).toBe(
      path.join(PACKAGE_SRC, "routes/router-entry.tsx"),
    )
    //the route tree always lands in .adaptv/, never next to the app's routes
    expect(
      fromSrc(appRoot, options.router.generatedRouteTree as string),
    ).toBe(path.join(appRoot, ".adaptv/routeTree.gen.ts"))
    expect(options.router.tmpDir).toBe(
      path.join(appRoot, ".adaptv/tmp/router"),
    )
    expect(options.router.routesDirectory).toBe("./routing")
    expect(options.router.virtualRouteConfig).toBe(
      "./src/routing/config.ts",
    )
    expect(options.server).toBeUndefined()
  })

  it("hands the app's own entries over once it ejects them", async () => {
    //Writing src/client.tsx or src/router.tsx is the documented eject; ignoring either file
    //would build green and run adaptv's entry instead of the one the dev wrote.
    const appRoot = app(
      {
        router: {
          serverEntry: "./server",
          routesDirectory: "./pages",
          routerConfig: "./src/pages/config.ts",
        },
      },
      ["src/client.tsx", "src/router.tsx"],
    )
    await plugins(appRoot)
    const options = startOptions()

    expect(options.client).toEqual({ entry: "./client" })
    expect(options.router.entry).toBeUndefined()
    expect(options.server).toEqual({ entry: "./server" })
    expect(options.router.routesDirectory).toBe("./pages")
    expect(options.router.virtualRouteConfig).toBe("./src/pages/config.ts")
  })

  it("server-renders an ssr app, and forces a client SPA when the native dev server asks", async () => {
    //`adaptv dev ios|android` sets ADAPTV_DEV_NATIVE: the bundle goes into a WebView, which
    //cannot hydrate a server render. Without the override it would load a blank document.
    const appRoot = app({ render: "ssr" })
    await plugins(appRoot, { target: "web" })
    expect(startOptions().spa).toBeUndefined()

    vi.mocked(tanstackStart).mockClear()
    process.env.ADAPTV_DEV_NATIVE = "1"
    await plugins(appRoot, { target: "web" })
    expect(startOptions().spa).toEqual({ enabled: true })
  })
})

describe("adaptv() — which lineage a build is", () => {
  it("reads ADAPTV_TARGET when no target is passed, and an explicit target wins", async () => {
    //`ADAPTV_TARGET=capacitor vite build` is documented to work. Read wrong, a native bundle
    //ships `_redirects` and `404.html` inside the app.
    const appRoot = app()
    process.env.ADAPTV_TARGET = "capacitor"

    const fromEnv = (await plugins(appRoot)).map((p) => p.name)
    expect(fromEnv).toContain("adaptv:native-bundle")
    expect(fromEnv).not.toContain("adaptv:static-host")

    const explicit = (await plugins(appRoot, { target: "web" })).map(
      (p) => p.name,
    )
    expect(explicit).toContain("adaptv:static-host")
    expect(explicit).not.toContain("adaptv:native-bundle")
  })

  it("stamps the iOS privacy manifest on a capacitor build and names it app-relative", async () => {
    const appRoot = app({}, [".adaptv/ios/App/placeholder"])
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    await plugins(appRoot, { target: "capacitor" })

    const manifest = path.join(
      appRoot,
      ".adaptv/ios/App/App/PrivacyInfo.xcprivacy",
    )
    expect(existsSync(manifest)).toBe(true)
    //relative: an absolute path is the dev's home directory in a log they may paste
    expect(log).toHaveBeenCalledWith(
      "[adaptv] wrote .adaptv/ios/App/App/PrivacyInfo.xcprivacy",
    )
  })

  it("stamps no privacy manifest on a web build, even with an iOS project on disk", async () => {
    const appRoot = app({}, [".adaptv/ios/App/placeholder"])
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    await plugins(appRoot, { target: "web" })

    expect(
      existsSync(
        path.join(appRoot, ".adaptv/ios/App/App/PrivacyInfo.xcprivacy"),
      ),
    ).toBe(false)
    expect(log).not.toHaveBeenCalled()
  })
})

describe("adaptv() — the plugins it defines inline", () => {
  it("resolves #adaptv-route-tree to the app's generated tree, and nothing else", async () => {
    const appRoot = app()
    const alias = named(await plugins(appRoot), "adaptv:route-tree-alias")
    //`pre`, or a later resolver claims the specifier first
    expect(alias.enforce).toBe("pre")
    // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
    const resolveId = alias.resolveId as any
    expect(resolveId("#adaptv-route-tree")).toBe(
      path.join(appRoot, ".adaptv/routeTree.gen.ts"),
    )
    expect(resolveId("#adaptv/router")).toBeNull()
    expect(resolveId("./routeTree.gen")).toBeNull()
  })

  it("lets the dev server read adaptv's own package, alongside what Vite allowed", async () => {
    //A linked adaptv lives outside the app root, and a sandboxed dev server 404s its entries:
    //SSR HTML with dead buttons while `vite build` passes.
    const fsAllow = named(await plugins(app()), "adaptv:fs-allow")
    const allow = ["/the/app/workspace"]
    // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
    ;(fsAllow.configResolved as any)({
      server: { fs: { allow } },
    } as unknown as ResolvedConfig)

    expect(allow).toHaveLength(2)
    expect(allow[0]).toBe("/the/app/workspace")
    const packageJson = JSON.parse(
      readFileSync(path.join(allow[1], "package.json"), "utf8"),
    )
    expect(packageJson.name).toBe("@arrzdev/adaptv")
  })

  it("re-loads an edited adaptv.config.ts, re-stamps, and full-reloads the page", async () => {
    const appRoot = app()
    const list = await plugins(appRoot)
    const configPath = path.join(appRoot, "adaptv.config.ts")

    const watched: string[] = []
    const listeners: Array<(file: string) => void> = []
    const send = vi.fn()
    let manifestMiddleware: Connect.NextHandleFunction | undefined
    const server = {
      watcher: {
        add: (files: string[]) => watched.push(...files),
        on: (event: string, fn: (file: string) => void) => {
          if (event === "change") listeners.push(fn)
        },
      },
      ws: { send },
      middlewares: {
        use: (fn: Connect.NextHandleFunction) => {
          manifestMiddleware = fn
        },
      },
    } as unknown as ViteDevServer
    for (const name of ["adaptv:config-watcher", "adaptv:manifest"]) {
      // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
      ;(named(list, name).configureServer as any)(server)
    }

    const servedName = () => {
      let body = ""
      manifestMiddleware?.(
        { url: "/manifest.json" } as Connect.IncomingMessage,
        {
          setHeader: () => {},
          end: (text: string) => {
            body = text
          },
        } as unknown as ServerResponse,
        () => {},
      )
      return JSON.parse(body).name
    }

    expect(watched).toContain(configPath)
    expect(servedName()).toBe("Probe")

    //an unrelated file is not the config: nothing reloads
    for (const fn of listeners) fn(path.join(appRoot, "src/app.tsx"))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(send).not.toHaveBeenCalled()

    writeConfig(appRoot, { name: "Renamed" })
    rmSync(path.join(appRoot, ".gitignore"), { force: true })
    for (const fn of listeners) fn(configPath)
    await vi.waitFor(() => expect(send).toHaveBeenCalled(), {
      timeout: 5_000,
    })

    expect(send).toHaveBeenCalledWith({ type: "full-reload" })
    //the config every plugin reads is the new one…
    expect(servedName()).toBe("Renamed")
    //…and the generated wiring was stamped again from it
    expect(
      readFileSync(path.join(appRoot, ".gitignore"), "utf8"),
    ).toContain(".adaptv")
  })
})
